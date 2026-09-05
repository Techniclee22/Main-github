const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { reflowForSpeech, chunkText } = require("../lib/tts.cjs");

describe("reflowForSpeech", () => {
  it("turns curly quotes into ASCII and keeps contractions", () => {
    const reflowed = reflowForSpeech(`She said \u201Cdon\u2019t\u201D go.`);
    assert.match(reflowed, /don't/);
    assert.match(reflowed, /"/);
  });

  it("joins wrapped lines and glued hyphen breaks", () => {
    const reflowed = reflowForSpeech("This is a wrapped\nline with an exam-\nple.");
    assert.equal(reflowed, "This is a wrapped line with an example.");
  });

  it("does not insert newlines that would pause say", () => {
    const reflowed = reflowForSpeech("One line.\nTwo line.");
    assert.doesNotMatch(reflowed, /\n/);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("   \n"), []);
  });

  it("keeps short text as a single chunk", () => {
    assert.deepEqual(chunkText("Hello there."), ["Hello there."]);
  });

  it("cuts the first chunk near the opening budget", () => {
    const sentence = "This is a complete sentence used for chunking. ";
    const text = sentence.repeat(20);
    const chunks = chunkText(text, 380, 220);
    assert.ok(chunks.length > 1);
    assert.ok(chunks[0].length <= 230, `first chunk ${chunks[0].length}`);
    assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), reflowForSpeech(text));
  });
});
