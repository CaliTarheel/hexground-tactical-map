const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function buildQuery(lat: number, lon: number) {
  return `[out:json][timeout:25];(
    way["building"](around:480,${lat},${lon});
    way["highway"](around:480,${lat},${lon});
    way["natural"="wood"](around:480,${lat},${lon});
    way["landuse"~"forest|grass|meadow|recreation_ground"](around:480,${lat},${lon});
    way["leisure"~"garden|park"](around:480,${lat},${lon});
    node["natural"="tree"](around:480,${lat},${lon});
  );out geom;`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const query = buildQuery(lat, lon);
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
