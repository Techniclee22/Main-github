const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  collectContractErrors,
  extractNamedFunction,
  missingReadResultKeys,
} = require("./check-api-contract.cjs");

const KEYS = ["text", "title", "columns", "id", "words"];

const OCR_FALSE_POSITIVE = `
function ocrPng() {
  return worker.recognize(png, {}, { text: true, blocks: true, debug: true });
}
`;

describe("extractNamedFunction", () => {
  it("does not swallow a later function's braces", () => {
    const src = `
async function readWindowSource(source) {
  return { text: text };
}
function after() {
  return { blocks: true };
}
`;
    const body = extractNamedFunction(src, "readWindowSource");
    assert.ok(body);
    assert.match(body, /text: text/);
    assert.doesNotMatch(body, /blocks: true/);
    assert.doesNotMatch(body, /function after/);
  });

  it("skips destructured parameters before the function body", () => {
    const src = `
async function readWindowSource(source, { softEmpty = false } = {}) {
  return { text: text, title: source.name };
}
`;
    const body = extractNamedFunction(src, "readWindowSource");
    assert.ok(body);
    assert.match(body, /text: text/);
    assert.match(body, /softEmpty/);
  });
});

describe("missingReadResultKeys", () => {
  it("ignores text: true outside readWindowSource", () => {
    const src = `
${OCR_FALSE_POSITIVE}
async function readWindowSource(source) {
  return {
    title: source.name,
    columns: columns,
    id: source.id,
    words: words,
  };
}
`;
    assert.ok(src.includes("text: true"));
    const missing = missingReadResultKeys(src, KEYS);
    assert.ok(
      missing.some((item) => item.startsWith("text")),
      `expected text to be missing, got ${missing.join(", ")}`,
    );
  });

  it("passes when the function returns the explicit keys", () => {
    const src = `
${OCR_FALSE_POSITIVE}
async function readWindowSource(source) {
  if (!text) {
    return {
      text: "",
      title: source.name,
      columns: columns,
      id: source.id,
      empty: true,
      words: words,
    };
  }
  return {
    text: text,
    title: source.name,
    columns: columns,
    id: source.id,
    words: words,
  };
}
`;
    assert.deepEqual(missingReadResultKeys(src, KEYS), []);
  });

  it("fails if the success return drops text: text", () => {
    const src = `
async function readWindowSource(source) {
  if (!text) {
    return {
      text: "",
      title: source.name,
      columns: columns,
      id: source.id,
      words: words,
    };
  }
  return {
    title: source.name,
    columns: columns,
    id: source.id,
    words: words,
  };
}
`;
    const missing = missingReadResultKeys(src, KEYS);
    assert.deepEqual(missing, ['text (text: text)']);
  });
});

describe("collectContractErrors engine rules", () => {
  const real = (rel) =>
    fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const errorsWith = (rel, edit) =>
    collectContractErrors({ [rel]: edit(real(rel)) });

  it("passes on the checked-in tree", () => {
    assert.deepEqual(collectContractErrors(), []);
  });

  it("rejects a quoted live engine literal in speech.js", () => {
    for (const engine of ["macos-say-live", "kokoro-live"]) {
      const errors = errorsWith(
        "renderer/speech.js",
        (src) => `${src}\nconst fallbackEngine = '${engine}';\n`,
      );
      assert.ok(
        errors.some((e) => e.includes(`speech.js names engine "${engine}"`)),
        `expected speech.js error for ${engine}, got ${errors.join(" | ")}`,
      );
    }
  });

  it("keeps kokoro-js out of tts.cjs and kokoro-live.cjs, in either require form", () => {
    const tts = errorsWith("lib/tts.cjs", (src) => `${src}\nrequire("kokoro-js");\n`);
    assert.ok(tts.some((e) => e.startsWith("lib/tts.cjs requires kokoro-js")), tts.join(" | "));

    const live = errorsWith(
      "lib/kokoro-live.cjs",
      (src) => `${src}\nrequire.resolve('kokoro-js');\n`,
    );
    assert.ok(
      live.some((e) => e.startsWith("lib/kokoro-live.cjs requires kokoro-js")),
      live.join(" | "),
    );
  });

  it("requires the worker to be the file that loads kokoro-js", () => {
    const errors = errorsWith("lib/kokoro-worker.cjs", (src) => {
      const stripped = src.replace(/kokoro-js/g, "some-other-module");
      assert.notEqual(stripped, src, "fixture must remove the real require");
      return stripped;
    });
    assert.ok(
      errors.includes("lib/kokoro-worker.cjs: missing the lazy require of kokoro-js"),
      errors.join(" | "),
    );
  });

  it("requires every contract engine string to live in tts.cjs or kokoro-live.cjs", () => {
    const errors = errorsWith("api-contract.json", (src) => {
      const contract = JSON.parse(src);
      contract.engines.liveTest = "test-engine";
      return JSON.stringify(contract);
    });
    assert.deepEqual(errors, [
      'engine liveTest in tts.cjs or kokoro-live.cjs: missing `"test-engine"`',
    ]);
  });
});

describe("main.cjs readWindowSource", () => {
  const mainSrc = fs.readFileSync(
    path.join(__dirname, "..", "main.cjs"),
    "utf8",
  );

  it("keeps payload keys inside the function, not in ocrPng", () => {
    const body = extractNamedFunction(mainSrc, "readWindowSource");
    assert.ok(body, "readWindowSource must exist");
    assert.doesNotMatch(body, /blocks: true/);
    assert.doesNotMatch(body, /text: true/);
    assert.match(mainSrc, /text: true/);
    assert.deepEqual(missingReadResultKeys(mainSrc, KEYS), []);
  });
});
