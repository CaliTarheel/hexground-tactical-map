import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTerrariumElevation,
  terrariumPixelFor,
  terrariumResolutionMeters,
} from "../app/terrain-tiles.ts";

test("Terrarium RGB pixels decode to metre elevations", () => {
  assert.equal(decodeTerrariumElevation(128, 0, 0), 0);
  assert.equal(decodeTerrariumElevation(128, 100, 128), 100.5);
});

test("Hamilton Hall resolves to a stable high-resolution terrain tile", () => {
  const pixel = terrariumPixelFor({ lat: 35.91163, lon: -79.04876 });
  assert.equal(pixel.tileX, 9188);
  assert.equal(pixel.tileY, 12877);
  assert.ok(pixel.pixelX >= 0 && pixel.pixelX < 256);
  assert.ok(pixel.pixelY >= 0 && pixel.pixelY < 256);
  assert.ok(terrariumResolutionMeters(35.91163) > 3);
  assert.ok(terrariumResolutionMeters(35.91163) < 4);
});
