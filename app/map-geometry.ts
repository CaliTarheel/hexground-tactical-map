export const BOARD_COLUMNS = 14;
export const BOARD_ROWS = 8;
export const METERS_PER_HEX = 50;
export const HEX_HEIGHT_METERS = METERS_PER_HEX;
export const HEX_WIDTH_METERS = (2 * HEX_HEIGHT_METERS) / Math.sqrt(3);
export const HEX_COLUMN_STEP_METERS = HEX_WIDTH_METERS * 0.75;
export const HEX_COLUMN_OFFSET_METERS = HEX_HEIGHT_METERS * 0.5;
export const BOARD_WIDTH_METERS = HEX_WIDTH_METERS + (BOARD_COLUMNS - 1) * HEX_COLUMN_STEP_METERS;
export const BOARD_HEIGHT_METERS = HEX_HEIGHT_METERS * (BOARD_ROWS + 0.5);
export const BOARD_ASPECT_RATIO = BOARD_WIDTH_METERS / BOARD_HEIGHT_METERS;
const METERS_PER_LATITUDE_DEGREE = 111_195;

export type BoardPoint = { x: number; y: number };
export type GeoPoint = { lat: number; lon: number };

export function hexLayout(row: number, col: number) {
  const leftMeters = col * HEX_COLUMN_STEP_METERS;
  const topMeters = row * HEX_HEIGHT_METERS + (col % 2 ? HEX_COLUMN_OFFSET_METERS : 0);
  return {
    leftMeters,
    topMeters,
    leftPercent: (leftMeters / BOARD_WIDTH_METERS) * 100,
    topPercent: (topMeters / BOARD_HEIGHT_METERS) * 100,
    widthPercent: (HEX_WIDTH_METERS / BOARD_WIDTH_METERS) * 100,
    heightPercent: (HEX_HEIGHT_METERS / BOARD_HEIGHT_METERS) * 100,
  };
}

export function hexCenterMeters(row: number, col: number): BoardPoint {
  const layout = hexLayout(row, col);
  return {
    x: layout.leftMeters + HEX_WIDTH_METERS / 2 - BOARD_WIDTH_METERS / 2,
    y: layout.topMeters + HEX_HEIGHT_METERS / 2 - BOARD_HEIGHT_METERS / 2,
  };
}

export function hexPolygonMeters(row: number, col: number): BoardPoint[] {
  const layout = hexLayout(row, col);
  const vertices = [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ];
  return vertices.map(([x, y]) => ({
    x: layout.leftMeters + HEX_WIDTH_METERS * x - BOARD_WIDTH_METERS / 2,
    y: layout.topMeters + HEX_HEIGHT_METERS * y - BOARD_HEIGHT_METERS / 2,
  }));
}

export function boardToGeo(point: BoardPoint, center: GeoPoint, bearing: number): GeoPoint {
  const radians = (bearing * Math.PI) / 180;
  const eastMeters = point.x * Math.cos(radians) - point.y * Math.sin(radians);
  const northMeters = -point.x * Math.sin(radians) - point.y * Math.cos(radians);
  const metersPerLonDegree = METERS_PER_LATITUDE_DEGREE * Math.cos((center.lat * Math.PI) / 180);
  return {
    lat: center.lat + northMeters / METERS_PER_LATITUDE_DEGREE,
    lon: center.lon + eastMeters / metersPerLonDegree,
  };
}

export function geoToBoard(point: GeoPoint, center: GeoPoint, bearing: number): BoardPoint {
  const metersPerLonDegree = METERS_PER_LATITUDE_DEGREE * Math.cos((center.lat * Math.PI) / 180);
  const eastMeters = (point.lon - center.lon) * metersPerLonDegree;
  const northMeters = (point.lat - center.lat) * METERS_PER_LATITUDE_DEGREE;
  const radians = (bearing * Math.PI) / 180;
  return {
    x: eastMeters * Math.cos(radians) - northMeters * Math.sin(radians),
    y: -eastMeters * Math.sin(radians) - northMeters * Math.cos(radians),
  };
}

export function boardCorners(center: GeoPoint, bearing: number): GeoPoint[] {
  return [
    { x: -BOARD_WIDTH_METERS / 2, y: -BOARD_HEIGHT_METERS / 2 },
    { x: BOARD_WIDTH_METERS / 2, y: -BOARD_HEIGHT_METERS / 2 },
    { x: BOARD_WIDTH_METERS / 2, y: BOARD_HEIGHT_METERS / 2 },
    { x: -BOARD_WIDTH_METERS / 2, y: BOARD_HEIGHT_METERS / 2 },
  ].map((point) => boardToGeo(point, center, bearing));
}
