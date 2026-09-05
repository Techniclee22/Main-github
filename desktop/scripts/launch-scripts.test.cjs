const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/** zsh + set -u treats `$BRANCH…` as a different parameter than BRANCH. */
const UNQUOTED_THEN_ELLIPSIS = /\$[A-Za-z_][A-Za-z0-9_]*\u2026/;

const repoRoot = path.join(__dirname, "..", "..");
const launchScripts = [
  "update-and-run.sh",
  "update-and-run-focus.sh",
  "run.sh",
  "switch-to-main.sh",
];

describe("launch scripts", () => {
  it("detects $BRANCH… as the zsh unbound-variable pattern", () => {
    assert.equal(
      UNQUOTED_THEN_ELLIPSIS.test('echo "-> Switching to $BRANCH\u2026"'),
      true,
    );
    assert.equal(
      UNQUOTED_THEN_ELLIPSIS.test('echo "-> Switching to ${BRANCH}..."'),
      false,
    );
  });

  for (const rel of launchScripts) {
    it(`${rel} does not use $VAR followed by an ellipsis`, () => {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      const code = src
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      assert.equal(UNQUOTED_THEN_ELLIPSIS.test(code), false);
    });

    it(`${rel} re-execs under bash`, () => {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      assert.match(src, /BASH_VERSION/);
      if (rel === "update-and-run.sh") {
        assert.match(src, /\$\{BRANCH\}/);
      }
      if (rel === "update-and-run-focus.sh") {
        assert.match(src, /update-and-run\.sh/);
        assert.doesNotMatch(src, /fix-columns-and-focus/);
      }
      if (rel === "switch-to-main.sh") {
        assert.match(src, /package-lock\.json/);
        assert.match(src, /checkout main/);
      }
    });
  }
});
