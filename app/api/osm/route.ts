const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function buildQuery(lat: number, lon: number, radius: number) {
  return `[out:json][timeout:25];(
    way["building"](around:${radius},${lat},${lon});
    way["highway"](around:${radius},${lat},${lon});
    way["natural"="wood"](around:${radius},${lat},${lon});
    way["landuse"~"forest|grass|meadow|recreation_ground"](around:${radius},${lat},${lon});
    way["leisure"~"garden|park"](around:${radius},${lat},${lon});
    node["natural"="tree"](around:${radius},${lat},${lon});
  );out geom;`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = Math.max(480, Math.min(2500, Math.round(Number(url.searchParams.get("radius")) || 480)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const query = buildQuery(lat, lon, radius);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Hexground/1.0 OpenStreetMap tactical map prototype",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      return new Response(await response.text(), {
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        },
      });
    } catch {
      // Try the next public Overpass instance.
    }
  }

  return Response.json({ error: "OpenStreetMap geometry is temporarily unavailable" }, { status: 502 });
}
