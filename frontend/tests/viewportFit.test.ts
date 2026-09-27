import assert from "node:assert/strict";
import test from "node:test";
import { getViewportFit } from "../src/utils/viewportFit.ts";

test("large viewport preserves natural size without upscaling", () => {
  assert.deepEqual(getViewportFit(2400, 1600, 1800, 1000), { scale: 1, fallback: false });
});

test("width and height each constrain the same uniform scale", () => {
  assert.equal(getViewportFit(1264, 1000, 1800, 800).scale, 1264 / 1800);
  assert.equal(getViewportFit(1904, 651, 1800, 1100).scale, 651 / 1100);
});

test("representative desktop budgets fit the complete board in both dimensions", () => {
  for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
    for (const boardHeight of [1015, 1100, 1500]) {
      const availableWidth = width - 16;
      const availableHeight = height - 70;
      const { scale, fallback } = getViewportFit(availableWidth, availableHeight, 1800, boardHeight);
      assert.equal(fallback, false);
      assert.ok(scale <= 1);
      assert.ok(1800 * scale <= availableWidth + 0.001);
      assert.ok(boardHeight * scale <= availableHeight + 0.001);
    }
  }
});

test("small windows preserve a minimum scale and permit inner scrolling", () => {
  assert.deepEqual(getViewportFit(800, 450, 1800, 1100), { scale: 0.65, fallback: true });
  assert.deepEqual(getViewportFit(1000, 550, 900, 500), { scale: 1, fallback: true });
});

test("fallback boundary uses actual remaining width and height", () => {
  assert.equal(getViewportFit(1100, 560, 1800, 1000).fallback, false);
  assert.equal(getViewportFit(1099, 560, 1800, 1000).fallback, true);
  assert.equal(getViewportFit(1100, 559, 1800, 1000).fallback, true);
});

test("unmeasured or invalid dimensions do not produce invalid transforms", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.deepEqual(getViewportFit(value, 700, 1800, 1000), { scale: 1, fallback: false });
    assert.deepEqual(getViewportFit(1200, 700, 1800, value), { scale: 1, fallback: false });
  }
});
