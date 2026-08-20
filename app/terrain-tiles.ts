import type { GeoPoint } from "./map-geometry";

export const TERRARIUM_ZOOM = 15;
const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

export type TerrariumPixel = {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
};

export function terrariumPixelFor(point: GeoPoint, zoom = TERRARIUM_ZOOM): TerrariumPixel {
  const scale = 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  const latitudeRadians = latitude * Math.PI / 180;
  const x = ((point.lon + 180) / 360) * scale;
  const y = (1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return {
    tileX,
    tileY,
    pixelX: Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((x - tileX) * TILE_SIZE))),
    pixelY: Math.max(0, Math.min(TILE_SIZE - 1, Math.floor((y - tileY) * TILE_SIZE))),
  };
}

export function decodeTerrariumElevation(red: number, green: number, blue: number) {
  return red * 256 + green + blue / 256 - 32_768;
}

export function terrariumResolutionMeters(latitude: number, zoom = TERRARIUM_ZOOM) {
  return Math.cos(latitude * Math.PI / 180) * EARTH_CIRCUMFERENCE_METERS / (TILE_SIZE * 2 ** zoom);
}

export async function loadTerrariumElevations(points: GeoPoint[], signal?: AbortSignal) {
  const samples = points.map((point) => ({ point, pixel: terrariumPixelFor(point) }));
  const tileKeys = [...new Set(samples.map(({ pixel }) => `${pixel.tileX}/${pixel.tileY}`))];
  const tilePixels = new Map<string, Uint8ClampedArray>();

  await Promise.all(tileKeys.map(async (key) => {
    const [tileX, tileY] = key.split("/").map(Number);
    const response = await fetch(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRARIUM_ZOOM}/${tileX}/${tileY}.png`,
      { signal },
    );
    if (!response.ok) throw new Error(`Terrain tile returned ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Terrain tile canvas unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    tilePixels.set(key, context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
  }));

  const elevations = samples.map(({ pixel }) => {
    const data = tilePixels.get(`${pixel.tileX}/${pixel.tileY}`);
    if (!data) throw new Error("Terrain tile missing");
    const offset = (pixel.pixelY * TILE_SIZE + pixel.pixelX) * 4;
    const elevation = decodeTerrariumElevation(data[offset], data[offset + 1], data[offset + 2]);
    if (!Number.isFinite(elevation) || elevation <= -32_768) throw new Error("Terrain sample unavailable");
    return elevation;
  });

  const averageLatitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  return {
    elevations,
    source: "AWS Terrain Tiles" as const,
    resolutionMeters: terrariumResolutionMeters(averageLatitude),
  };
}
