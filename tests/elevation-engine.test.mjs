import assert from "node:assert/strict";
import test from "node:test";
import {
  ELEVATION_COLUMNS,
  ELEVATION_ROWS,
  ELEVATION_SAMPLE_COUNT,
  createElevationGrid,
  elevationAtPoint,
  elevationSampleLocations,
  levelAtPoint,
} from "../app/elevation-engine.ts";

const center = { lat: 35.91163, lon: -79.04876 };

test("the elevation request samples the complete fixed board", () => {
  for (const bearing of [0, 37, 90, 270]) {
    const samples = elevationSampleLocations(center, bearing);
    assert.equal(samples.length, ELEVATION_SAMPLE_COUNT);
    assert.ok(samples.every(({ geoPoint }) => Number.isFinite(geoPoint.lat) && Number.isFinite(geoPoint.lon)));
    assert.notDeepEqual(samples[0].geoPoint, samples.at(-1).geoPoint);
  }
});

test("the terrain surface interpolates height and assigns four-metre LnL levels", () => {
  const values = Array.from({ length: ELEVATION_ROWS }, (_, row) =>
    Array.from({ length: ELEVATION_COLUMNS }, (_, column) => 100 + column + row * 2),
  ).flat();
  const grid = createElevationGrid(values);
  assert.ok(grid);
  assert.equal(grid.minimum, 100);
  assert.equal(grid.maximum, 123);
  assert.equal(grid.source, "Copernicus DEM GLO-90");
  assert.equal(grid.resolutionMeters, 90);
  assert.ok(Math.abs(elevationAtPoint(grid, { x: 0, y: 0 }) - 111.5) < 1e-9);
  assert.equal(levelAtPoint(grid, { x: 0, y: 0 }), 2);
  assert.equal(levelAtPoint(grid, { x: -10_000, y: -10_000 }), 0);
  assert.equal(levelAtPoint(grid, { x: 10_000, y: 10_000 }), 3);
});

test("incomplete elevation responses are rejected instead of fabricating relief", () => {
  assert.equal(createElevationGrid([100, 101, 102]), null);
});
