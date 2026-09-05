const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { shouldInvertBgra, invertBgra, meanLuma } = require("../lib/ocr-image.cjs");

function solid(luma, pixels = 20) {
  const buf = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    buf[i * 4] = luma;
    buf[i * 4 + 1] = luma;
    buf[i * 4 + 2] = luma;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe("shouldInvertBgra", () => {
  it("inverts a dark terminal-like frame and leaves a light page", () => {
    assert.equal(shouldInvertBgra(solid(20)), true);
    assert.equal(shouldInvertBgra(solid(240)), false);
  });

  it("flips dark pixels to light", () => {
    const inverted = invertBgra(solid(10, 2));
    assert.ok(meanLuma(inverted) > 200);
  });
});
