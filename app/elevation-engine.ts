import { boardDimensions, boardToGeo, type BoardPoint, type GeoPoint } from "./map-geometry.ts";

export const ELEVATION_COLUMNS = 10;
export const ELEVATION_ROWS = 8;
export const ELEVATION_SAMPLE_COUNT = ELEVATION_COLUMNS * ELEVATION_ROWS;
export const ELEVATION_LEVEL_INTERVAL_METERS = 4;

export type ElevationGrid = {
  columns: number;
  rows: number;
  widthMeters: number;
  heightMeters: number;
  boardCols: number;
  boardRows: number;
  values: number[];
  minimum: number;
  maximum: number;
  datum: number;
  interval: number;
  source: "USGS 3DEP" | "USGS NED 10m via OpenTopoData" | "AWS Terrain Tiles" | "Copernicus DEM GLO-90";
  resolutionMeters: number;
};

export function elevationSampleLocations(center: GeoPoint, bearing: number, boardCols = 1, boardRows = 1) {
  const dimensions = boardDimensions(boardCols, boardRows);
  return Array.from({ length: ELEVATION_ROWS }, (_, row) =>
    Array.from({ length: ELEVATION_COLUMNS }, (_, column) => {
      const boardPoint = {
        x: -dimensions.widthMeters / 2 + (column / (ELEVATION_COLUMNS - 1)) * dimensions.widthMeters,
        y: -dimensions.heightMeters / 2 + (row / (ELEVATION_ROWS - 1)) * dimensions.heightMeters,
      };
      return { boardPoint, geoPoint: boardToGeo(boardPoint, center, bearing) };
    }),
  ).flat();
}

export function createElevationGrid(
  values: number[],
  source: ElevationGrid["source"] = "Copernicus DEM GLO-90",
  resolutionMeters = 90,
  boardCols = 1,
  boardRows = 1,
): ElevationGrid | null {
  if (values.length !== ELEVATION_SAMPLE_COUNT || values.some((value) => !Number.isFinite(value))) return null;
  const dimensions = boardDimensions(boardCols, boardRows);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return {
    columns: ELEVATION_COLUMNS,
    rows: ELEVATION_ROWS,
    widthMeters: dimensions.widthMeters,
    heightMeters: dimensions.heightMeters,
    boardCols: dimensions.boardCols,
    boardRows: dimensions.boardRows,
    values,
    minimum,
    maximum,
    datum: minimum,
    interval: ELEVATION_LEVEL_INTERVAL_METERS,
    source,
    resolutionMeters,
  };
}

function clamped(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function elevationAtPoint(grid: ElevationGrid, point: BoardPoint) {
  const columnPosition = clamped((point.x / grid.widthMeters + 0.5) * (grid.columns - 1), 0, grid.columns - 1);
  const rowPosition = clamped((point.y / grid.heightMeters + 0.5) * (grid.rows - 1), 0, grid.rows - 1);
  const column0 = Math.floor(columnPosition);
  const row0 = Math.floor(rowPosition);
  const column1 = Math.min(grid.columns - 1, column0 + 1);
  const row1 = Math.min(grid.rows - 1, row0 + 1);
  const columnBlend = columnPosition - column0;
  const rowBlend = rowPosition - row0;
  const value00 = grid.values[row0 * grid.columns + column0];
  const value10 = grid.values[row0 * grid.columns + column1];
  const value01 = grid.values[row1 * grid.columns + column0];
  const value11 = grid.values[row1 * grid.columns + column1];
  const top = value00 + (value10 - value00) * columnBlend;
  const bottom = value01 + (value11 - value01) * columnBlend;
  return top + (bottom - top) * rowBlend;
}

export function elevationLevel(grid: ElevationGrid, elevation: number) {
  return clamped(Math.floor((elevation - grid.datum) / grid.interval), 0, 3);
}

export function levelAtPoint(grid: ElevationGrid, point: BoardPoint) {
  return elevationLevel(grid, elevationAtPoint(grid, point));
}

export function elevationThresholds(grid: ElevationGrid) {
  return [1, 2, 3]
    .map((level) => ({ level, elevation: grid.datum + level * grid.interval }))
    .filter(({ elevation }) => elevation <= grid.maximum);
}

export function elevationGridPoint(grid: ElevationGrid, row: number, column: number): BoardPoint {
  return {
    x: -grid.widthMeters / 2 + (column / (grid.columns - 1)) * grid.widthMeters,
    y: -grid.heightMeters / 2 + (row / (grid.rows - 1)) * grid.heightMeters,
  };
}
