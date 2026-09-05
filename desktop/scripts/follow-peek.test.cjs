const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scrollFraction } = require("../lib/follow-peek.cjs");

function ramp(height, offset) {
  return Array.from({ length: height }, (_, y) => (y + offset) % 40);
}

describe("scrollFraction", () => {
  it("ignores a one-row blink on an otherwise still profile", () => {
    const base = Array(48).fill(8);
    const blink = base.slice();
    blink[10] = 220;
    assert.ok(scrollFraction(base, blink) < 0.1);
  });

  it("reports a real vertical shift", () => {
    const a = ramp(48, 0);
    const b = ramp(48, 16);
    const frac = scrollFraction(a, b);
    assert.ok(frac >= 0.2, `shift fraction ${frac}`);
  });
});
