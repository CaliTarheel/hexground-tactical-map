import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("credits the creator and links the public source", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Stephen G\. Rider/);
  assert.match(page, /mailto:rider\.sg@gmail\.com/);
  assert.match(page, /github\.com\/CaliTarheel\/hexground-tactical-map/);
  assert.match(page, /MIT licensed/);
});
