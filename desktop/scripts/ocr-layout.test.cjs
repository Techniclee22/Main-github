const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeForSpeech,
  textFromOcrPage,
  clusterColumns,
  isReadableWord,
} = require("../lib/ocr-layout.cjs");

function word(text, x0, y0, x1, y1, confidence = 90) {
  return {
    text,
    confidence,
    bbox: { x0, y0, x1, y1 },
  };
}

function twoColumnPage() {
  const words = [];
  for (let row = 0; row < 20; row += 1) {
    const y = 40 + row * 30;
    words.push(word(`LeftA${row}`, 40, y, 120, y + 18));
    words.push(word(`LeftB${row}`, 130, y, 210, y + 18));
    words.push(word(`RightA${row}`, 560, y, 640, y + 18));
    words.push(word(`RightB${row}`, 650, y, 730, y + 18));
  }
  return words;
}

/** Inner edges sit in the page-center band — the occupancy gate treated this as one column. */
function denseTwoColumnPage() {
  const words = [];
  for (let row = 0; row < 24; row += 1) {
    const y = 30 + row * 22;
    for (const x of [50, 150, 260, 370]) {
      words.push(word("Leftside", x, y, x + 90, y + 16));
    }
    for (const x of [540, 650, 760, 870]) {
      words.push(word("Rightside", x, y, x + 90, y + 16));
    }
  }
  return words;
}

function denseFullWidthPage() {
  const words = [];
  for (let row = 0; row < 16; row += 1) {
    const y = 40 + row * 22;
    for (let i = 0; i < 12; i += 1) {
      const x = 40 + i * 75;
      words.push(word(`W${row}x${i}`, x, y, x + 70, y + 16));
    }
  }
  return words;
}

describe("sanitizeForSpeech", () => {
  it("keeps curly apostrophes as ASCII contractions", () => {
    const sanitized = sanitizeForSpeech("don\u2019t can\u2019t it\u2019s");
    assert.match(sanitized, /don't/);
    assert.match(sanitized, /can't/);
    assert.match(sanitized, /it's/);
    assert.doesNotMatch(sanitized, /don t/);
  });
});

describe("clusterColumns", () => {
  it("splits a synthetic two-column page left then right", () => {
    const words = twoColumnPage();
    const clustered = clusterColumns(words, 1000);
    assert.equal(clustered.length, 2);
  });

  it("keeps a single left-side column together", () => {
    const words = [];
    for (let row = 0; row < 12; row += 1) {
      const y = 40 + row * 24;
      words.push(word(`Only${row}`, 40, y, 180, y + 16));
    }
    const clustered = clusterColumns(words, 1000);
    assert.equal(clustered.length, 1);
  });

  it("keeps packed full-width prose as one column", () => {
    const clustered = clusterColumns(denseFullWidthPage(), 1000);
    assert.equal(clustered.length, 1);
  });

  it("splits a two-column page whose inner edges sit near center", () => {
    const clustered = clusterColumns(denseTwoColumnPage(), 1000);
    assert.equal(clustered.length, 2);
    assert.ok(clustered[0].every((item) => item.text === "Leftside"));
    assert.ok(clustered[1].every((item) => item.text === "Rightside"));
  });
});

describe("textFromOcrPage", () => {
  it("reads left column before right column", () => {
    const words = twoColumnPage();
    const result = textFromOcrPage(
      { words, width: 0, height: 0, text: "" },
      { width: 1000, height: 800 },
    );
    assert.equal(result.columns, 2);
    const leftIdx = result.text.search(/LeftA0/);
    const rightIdx = result.text.search(/RightA0/);
    assert.ok(leftIdx >= 0, `missing LeftA0 in: ${result.text.slice(0, 120)}`);
    assert.ok(rightIdx >= 0, `missing RightA0 in: ${result.text.slice(0, 120)}`);
    assert.ok(leftIdx < rightIdx, `left=${leftIdx} right=${rightIdx}`);
    assert.ok(result.words.length > 0);
    assert.equal(result.words[0].column, 0);
    const rightWord = result.words.find((item) => item.text.startsWith("Right"));
    assert.ok(rightWord);
    assert.equal(rightWord.column, 1);
    assert.ok(rightWord.bbox.x0 > 500);
  });

  it("reads dense two-column left column before right", () => {
    const result = textFromOcrPage(
      { words: denseTwoColumnPage(), width: 0, height: 0, text: "" },
      { width: 1000, height: 800 },
    );
    assert.equal(result.columns, 2);
    const leftIdx = result.text.indexOf("Leftside");
    const rightIdx = result.text.indexOf("Rightside");
    assert.ok(leftIdx >= 0);
    assert.ok(rightIdx >= 0);
    assert.ok(leftIdx < rightIdx);
  });
});

describe("isReadableWord", () => {
  it("drops ornamental glyphs and low-confidence tokens", () => {
    assert.equal(isReadableWord(word("Hello", 0, 0, 40, 12)), true);
    assert.equal(isReadableWord(word("{}", 0, 0, 20, 12)), false);
    assert.equal(isReadableWord(word("Hi", 0, 0, 20, 12, 20)), false);
    assert.equal(isReadableWord(word("|", 0, 0, 8, 12)), false);
  });
});
