const ELEVATION_ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const USGS_ENDPOINT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const OPEN_TOPO_DATA_ENDPOINT = "https://api.opentopodata.org/v1/ned10m";
const MAX_COORDINATES = 100;

type Coordinate = { lat: number; lon: number };

function validCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== "object") return false;
  const coordinate = value as Coordinate;
  return Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lon) &&
    Math.abs(coordinate.lat) <= 90 && Math.abs(coordinate.lon) <= 180;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { coordinates?: unknown[] };
    const coordinates = body.coordinates ?? [];
    if (coordinates.length === 0 || coordinates.length > MAX_COORDINATES || !coordinates.every(validCoordinate)) {
      return Response.json({ error: "Expected 1 to 100 valid coordinates" }, { status: 400 });
    }

    const geometry = JSON.stringify({
      points: coordinates.map((coordinate) => [coordinate.lon, coordinate.lat]),
      spatialReference: { wkid: 4326 },
    });
    const usgsBody = new URLSearchParams({
      f: "json",
      geometryType: "esriGeometryMultipoint",
      geometry,
      returnFirstValueOnly: "true",
      interpolation: "RSP_BilinearInterpolation",
    });
    try {
      const usgsResponse = await fetch(USGS_ENDPOINT, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Hexground/1.0 tactical terrain mapper",
        },
        body: usgsBody,
        signal: AbortSignal.timeout(15_000),
      });
      if (usgsResponse.ok) {
        const payload = await usgsResponse.json() as {
          samples?: Array<{ locationId?: number; value?: string; resolution?: number }>;
        };
        const samples = [...(payload.samples ?? [])].sort((a, b) => (a.locationId ?? 0) - (b.locationId ?? 0));
        const elevations = samples.map((sample) => Number(sample.value));
        if (elevations.length === coordinates.length && elevations.every(Number.isFinite)) {
          const resolutionDegrees = Math.max(...samples.map((sample) => sample.resolution ?? 0));
          return Response.json({
            elevations,
            source: "USGS 3DEP",
            resolutionMeters: resolutionDegrees > 0 ? resolutionDegrees * 111_195 : 10,
          }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
        }
      }
    } catch {
      // Try the public 10 m NED surface below.
    }

    try {
      const locations = coordinates
        .map((coordinate) => `${coordinate.lat.toFixed(7)},${coordinate.lon.toFixed(7)}`)
        .join("|");
      const openTopoResponse = await fetch(
        `${OPEN_TOPO_DATA_ENDPOINT}?locations=${encodeURIComponent(locations)}&interpolation=bilinear`,
        {
          headers: { "Accept": "application/json", "User-Agent": "Hexground/1.0 tactical terrain mapper" },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (openTopoResponse.ok) {
        const payload = await openTopoResponse.json() as {
          status?: string;
          results?: Array<{ elevation?: number | null }>;
        };
        const elevations = (payload.results ?? []).map((result) => result.elevation);
        if (
          payload.status === "OK" &&
          elevations.length === coordinates.length &&
          elevations.every((value): value is number => Number.isFinite(value))
        ) {
          return Response.json({
            elevations,
            source: "USGS NED 10m via OpenTopoData",
            resolutionMeters: 10,
          }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
        }
      }
    } catch {
      // Fall back to the worldwide Copernicus surface below.
    }

    const latitude = coordinates.map((coordinate) => coordinate.lat.toFixed(7)).join(",");
    const longitude = coordinates.map((coordinate) => coordinate.lon.toFixed(7)).join(",");
    const response = await fetch(`${ELEVATION_ENDPOINT}?latitude=${latitude}&longitude=${longitude}`, {
      headers: { "Accept": "application/json", "User-Agent": "Hexground/1.0 tactical terrain mapper" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Elevation provider returned ${response.status}`);
    const payload = await response.json() as { elevation?: unknown[] };
    const elevations = payload.elevation ?? [];
    if (elevations.length !== coordinates.length || elevations.some((value) => !Number.isFinite(value))) {
      throw new Error("Elevation provider returned an incomplete surface");
    }
    return Response.json({ elevations, source: "Copernicus DEM GLO-90", resolutionMeters: 90 }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    });
  } catch {
    return Response.json({ error: "Elevation data is temporarily unavailable" }, { status: 502 });
  }
}
