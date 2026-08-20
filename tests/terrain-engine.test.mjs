import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  hexCenterMeters,
  hexPolygonMeters,
} from "../app/map-geometry.ts";
import { projectOsmFeatures, terrainFromFeatures } from "../app/terrain-engine.ts";

const center = { lat: 35.91163, lon: -79.04876 };
const layers = { buildings: true, roads: true, trees: true, elevation: true };

test("Hamilton Hall uses restrained, connected real-world terrain", async () => {
  const source = JSON.parse(await readFile(new URL("../public/data/hamilton-hall-osm.json", import.meta.url), "utf8"));
  const features = projectOsmFeatures(source.elements, center, 0);
  const hexes = Array.from({ length: BOARD_ROWS }, (_, row) =>
    Array.from({ length: BOARD_COLUMNS }, (_, col) => ({
      row,
      col,
      center: hexCenterMeters(row, col),
      ...terrainFromFeatures(hexCenterMeters(row, col), hexPolygonMeters(row, col), features, 2, layers),
    })),
  ).flat();

  const counts = Object.fromEntries(
    ["lawn", "woods", "building", "road", "path", "hill", "garden"].map((terrain) => [
      terrain,
      hexes.filter((hex) => hex.terrain === terrain).length,
    ]),
  );
  const routes = hexes.filter((hex) => hex.terrain === "road" || hex.terrain === "path");
  const connectedRoutes = routes.filter((hex) => routes.some((other) =>
    other !== hex && Math.hypot(other.center.x - hex.center.x, other.center.y - hex.center.y) < 78
  ));

  assert.equal(hexes.length, 112);
  assert.ok(counts.building >= 4 && counts.building <= 45, `unexpected building coverage: ${counts.building}`);
  assert.ok(routes.length >= 8, `too few routed hexes: ${routes.length}`);
  assert.ok(counts.lawn + counts.woods >= 20, `open and wooded terrain was overrun: ${counts.lawn + counts.woods}`);
  assert.ok(connectedRoutes.length / routes.length >= 0.7, `route continuity too low: ${connectedRoutes.length}/${routes.length}`);
  assert.ok(hexes.every((hex) => Number.isFinite(hex.routeAngle)));
});

test("rotation keeps a complete standard board without fabricated terrain", async () => {
  const source = JSON.parse(await readFile(new URL("../public/data/hamilton-hall-osm.json", import.meta.url), "utf8"));
  for (const bearing of [0, 15, 45, 90, 154, 270]) {
    const features = projectOsmFeatures(source.elements, center, bearing);
    const terrains = Array.from({ length: BOARD_ROWS }, (_, row) =>
      Array.from({ length: BOARD_COLUMNS }, (_, col) =>
        terrainFromFeatures(hexCenterMeters(row, col), hexPolygonMeters(row, col), features, 2, layers).terrain
      ),
    ).flat();
    assert.equal(terrains.length, 112);
    assert.ok(terrains.filter((terrain) => terrain === "building").length <= 45);
  }
});
