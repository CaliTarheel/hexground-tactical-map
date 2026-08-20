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
export const MAX_BOARD_LAYOUT = 4;
const METERS_PER_LATITUDE_DEGREE = 111_195;

export type BoardPoint = { x: number; y: number };
export type GeoPoint = { lat: number; lon: number };
export type BoardLayout = { boardCols: number; boardRows: number };

export function clampBoardCount(value: number) {
  return Math.max(1, Math.min(MAX_BOARD_LAYOUT, Math.round(value || 1)));
}

export function boardDimensions(boardCols = 1, boardRows = 1) {
  const cols = clampBoardCount(boardCols);
  const rows = clampBoardCount(boardRows);
  const widthMeters = BOARD_WIDTH_METERS * cols;
  const heightMeters = BOARD_HEIGHT_METERS * rows;
  return {
    boardCols: cols,
    boardRows: rows,
    boardCount: cols * rows,
    columns: BOARD_COLUMNS * cols,
    rows: BOARD_ROWS * rows,
    widthMeters,
    heightMeters,
    aspectRatio: widthMeters / heightMeters,
  };
}

export function hexLayout(row: number, col: number, boardCols = 1, boardRows = 1) {
  const dimensions = boardDimensions(boardCols, boardRows);
  const boardColumn = Math.floor(col / BOARD_COLUMNS);
  const boardRow = Math.floor(row / BOARD_ROWS);
  const localColumn = col % BOARD_COLUMNS;
  const localRow = row % BOARD_ROWS;
  const leftMeters = boardColumn * BOARD_WIDTH_METERS + localColumn * HEX_COLUMN_STEP_METERS;
  const topMeters = boardRow * BOARD_HEIGHT_METERS + localRow * HEX_HEIGHT_METERS + (localColumn % 2 ? HEX_COLUMN_OFFSET_METERS : 0);
  return {
    leftMeters,
    topMeters,
    leftPercent: (leftMeters / dimensions.widthMeters) * 100,
    topPercent: (topMeters / dimensions.heightMeters) * 100,
    widthPercent: (HEX_WIDTH_METERS / dimensions.widthMeters) * 100,
    heightPercent: (HEX_HEIGHT_METERS / dimensions.heightMeters) * 100,
  };
}

export function hexCenterMeters(row: number, col: number, boardCols = 1, boardRows = 1): BoardPoint {
  const dimensions = boardDimensions(boardCols, boardRows);
  const layout = hexLayout(row, col, boardCols, boardRows);
  return {
    x: layout.leftMeters + HEX_WIDTH_METERS / 2 - dimensions.widthMeters / 2,
    y: layout.topMeters + HEX_HEIGHT_METERS / 2 - dimensions.heightMeters / 2,
  };
}

export function hexPolygonMeters(row: number, col: number, boardCols = 1, boardRows = 1): BoardPoint[] {
  const dimensions = boardDimensions(boardCols, boardRows);
  const layout = hexLayout(row, col, boardCols, boardRows);
  const vertices = [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ];
  return vertices.map(([x, y]) => ({
    x: layout.leftMeters + HEX_WIDTH_METERS * x - dimensions.widthMeters / 2,
    y: layout.topMeters + HEX_HEIGHT_METERS * y - dimensions.heightMeters / 2,
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

export function boardCorners(center: GeoPoint, bearing: number, boardCols = 1, boardRows = 1): GeoPoint[] {
  const dimensions = boardDimensions(boardCols, boardRows);
  return [
    { x: -dimensions.widthMeters / 2, y: -dimensions.heightMeters / 2 },
    { x: dimensions.widthMeters / 2, y: -dimensions.heightMeters / 2 },
    { x: dimensions.widthMeters / 2, y: dimensions.heightMeters / 2 },
    { x: -dimensions.widthMeters / 2, y: dimensions.heightMeters / 2 },
  ].map((point) => boardToGeo(point, center, bearing));
}

export function boardSeamSegments(boardCols = 1, boardRows = 1) {
  const dimensions = boardDimensions(boardCols, boardRows);
  const segments: Array<[BoardPoint, BoardPoint]> = [];
  for (let col = 1; col < dimensions.boardCols; col += 1) {
    const x = -dimensions.widthMeters / 2 + BOARD_WIDTH_METERS * col;
    segments.push([{ x, y: -dimensions.heightMeters / 2 }, { x, y: dimensions.heightMeters / 2 }]);
  }
  for (let row = 1; row < dimensions.boardRows; row += 1) {
    const y = -dimensions.heightMeters / 2 + BOARD_HEIGHT_METERS * row;
    segments.push([{ x: -dimensions.widthMeters / 2, y }, { x: dimensions.widthMeters / 2, y }]);
  }
  return segments;
}

export function boardHexAddress(row: number, col: number, boardCols = 1, boardRows = 1) {
  const dimensions = boardDimensions(boardCols, boardRows);
  const boardColumn = Math.floor(col / BOARD_COLUMNS);
  const boardRow = Math.floor(row / BOARD_ROWS);
  const localColumn = col % BOARD_COLUMNS;
  const localRow = row % BOARD_ROWS;
  const local = `${String.fromCharCode(65 + localColumn)}${localRow + 1}`;
  return dimensions.boardCount === 1 ? local : `${boardRow + 1}-${boardColumn + 1} ${local}`;
}
