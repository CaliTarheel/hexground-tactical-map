import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_COLUMNS,
  BOARD_HEIGHT_METERS,
  BOARD_ROWS,
  BOARD_WIDTH_METERS,
  HEX_HEIGHT_METERS,
  HEX_WIDTH_METERS,
  boardDimensions,
  boardCorners,
  boardHexAddress,
  boardSeamSegments,
  hexLayout,
  hexPolygonMeters,
} from "../app/map-geometry.ts";

const center = { lat: 35.91163, lon: -79.04876 };

function distanceMeters(a, b) {
  const radius = 6_371_000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

test("the geographic board footprint stays fixed at every bearing", () => {
  for (const bearing of [0, 37, 90, 154, 270]) {
    const corners = boardCorners(center, bearing);
    assert.ok(Math.abs(distanceMeters(corners[0], corners[1]) - BOARD_WIDTH_METERS) < 3);
    assert.ok(Math.abs(distanceMeters(corners[1], corners[2]) - BOARD_HEIGHT_METERS) < 3);
  }
});

test("the board uses regular flat-top hexes", () => {
  const layout = hexLayout(0, 0);
  assert.ok(Math.abs(layout.widthPercent * BOARD_WIDTH_METERS / 100 - HEX_WIDTH_METERS) < 1e-9);
  assert.ok(Math.abs(layout.heightPercent * BOARD_HEIGHT_METERS / 100 - HEX_HEIGHT_METERS) < 1e-9);
  assert.equal(BOARD_COLUMNS * BOARD_ROWS, 112);
});

test("every neighboring pair shares exactly one complete edge", () => {
  const edges = (row, col) => {
    const polygon = hexPolygonMeters(row, col);
    return new Set(polygon.map((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      const a = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
      const b = `${next.x.toFixed(6)},${next.y.toFixed(6)}`;
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    }));
  };
  const shared = (a, b) => [...a].filter((edge) => b.has(edge)).length;

  for (let col = 0; col < BOARD_COLUMNS; col += 1) {
    for (let row = 0; row < BOARD_ROWS - 1; row += 1) {
      assert.equal(shared(edges(row, col), edges(row + 1, col)), 1);
    }
  }
  for (let col = 0; col < BOARD_COLUMNS - 1; col += 1) {
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      assert.equal(shared(edges(row, col), edges(row, col + 1)), 1);
    }
  }
});

test("multi-board layouts preserve native boards inside one continuous footprint", () => {
  const dimensions = boardDimensions(4, 3);
  assert.equal(dimensions.boardCount, 12);
  assert.equal(dimensions.columns, BOARD_COLUMNS * 4);
  assert.equal(dimensions.rows, BOARD_ROWS * 3);
  assert.equal(dimensions.widthMeters, BOARD_WIDTH_METERS * 4);
  assert.equal(dimensions.heightMeters, BOARD_HEIGHT_METERS * 3);
  assert.equal(boardSeamSegments(4, 3).length, 5);
  assert.equal(boardHexAddress(0, 0, 4, 3), "1-1 A1");
  assert.equal(boardHexAddress(BOARD_ROWS, BOARD_COLUMNS, 4, 3), "2-2 A1");

  const corners = boardCorners(center, 37, 4, 3);
  assert.ok(Math.abs(distanceMeters(corners[0], corners[1]) - BOARD_WIDTH_METERS * 4) < 12);
  assert.ok(Math.abs(distanceMeters(corners[1], corners[2]) - BOARD_HEIGHT_METERS * 3) < 12);
});
