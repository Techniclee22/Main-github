#!/usr/bin/env node
/**
 * Prove apostrophe normalization + two-column reading order.
 */
const assert = require("assert");
const {
  sanitizeForSpeech,
  textFromOcrPage,
  clusterColumns,
} = require("../lib/ocr-layout.cjs");
const { reflowForSpeech } = require("../lib/tts.cjs");

function word(text, x0, y0, x1, y1) {
  return {
    text,
    confidence: 90,
    bbox: { x0, y0, x1, y1 },
  };
}

// --- Fix 1: curly apostrophes survive as ASCII contractions ---
const curly = "don\u2019t can\u2019t it\u2019s";
const sanitized = sanitizeForSpeech(curly);
assert.ok(sanitized.includes("don't"), `expected don't in: ${sanitized}`);
assert.ok(sanitized.includes("can't"), `expected can't in: ${sanitized}`);
assert.ok(sanitized.includes("it's"), `expected it's in: ${sanitized}`);
assert.ok(!sanitized.includes("don t"), `stripped apostrophe: ${sanitized}`);

const reflowed = reflowForSpeech(`She said \u201Cdon\u2019t\u201D go.`);
assert.ok(reflowed.includes("don't"), `reflow missed don't: ${reflowed}`);
assert.ok(reflowed.includes('"'), `reflow missed ASCII quotes: ${reflowed}`);

console.log("ok apostrophes:", sanitized);

// --- Fix 2: synthetic two-column page ---
const pageWidth = 1000;
const pageHeight = 800;
const words = [];
for (let row = 0; row < 20; row += 1) {
  const y = 40 + row * 30;
  words.push(word(`LeftA${row}`, 40, y, 120, y + 18));
  words.push(word(`LeftB${row}`, 130, y, 210, y + 18));
  words.push(word(`RightA${row}`, 560, y, 640, y + 18));
  words.push(word(`RightB${row}`, 650, y, 730, y + 18));
}

const clustered = clusterColumns(words, pageWidth);
assert.strictEqual(clustered.length, 2, `expected 2 columns, got ${clustered.length}`);

const result = textFromOcrPage(
  { words, width: 0, height: 0, text: "" },
  { width: pageWidth, height: pageHeight },
);
assert.strictEqual(result.columns, 2, `columns=${result.columns}`);

const leftIdx = result.text.search(/LeftA0/);
const rightIdx = result.text.search(/RightA0/);
assert.ok(leftIdx >= 0, `missing LeftA0 in: ${result.text.slice(0, 120)}`);
assert.ok(rightIdx >= 0, `missing RightA0 in: ${result.text.slice(0, 120)}`);
assert.ok(
  leftIdx < rightIdx,
  `Left* must precede Right* (left=${leftIdx}, right=${rightIdx})`,
);

console.log("ok columns:", result.columns, "order Left→Right");
console.log("all checks passed");
