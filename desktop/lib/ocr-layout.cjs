/**
 * Rebuild reading order from Tesseract word boxes.
 * Two-column pages (handbooks, magazines) are read left column
 * top-to-bottom, then right column — not straight across.
 */

function wordCenterX(word) {
  return (word.bbox.x0 + word.bbox.x1) / 2;
}

/**
 * Find a vertical gutter by looking for the emptiest x-band
 * between dense left/right word clusters.
 */
function findGutterSplit(words, pageWidth) {
  if (words.length < 24) return null;

  const bins = 48;
  const counts = new Array(bins).fill(0);
  for (const word of words) {
    const c = wordCenterX(word);
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((c / pageWidth) * bins)));
    counts[idx] += 1;
  }

  // Ignore outer margins; look for a quiet band in the middle 50%.
  const start = Math.floor(bins * 0.25);
  const end = Math.ceil(bins * 0.75);
  let bestIdx = -1;
  let bestScore = Infinity;

  for (let i = start; i < end; i += 1) {
    const window =
      counts[i - 1] + counts[i] + counts[Math.min(bins - 1, i + 1)];
    // Prefer a true gap: low local count and high density on both sides.
    const leftDense = counts.slice(0, i).reduce((a, b) => a + b, 0);
    const rightDense = counts.slice(i + 1).reduce((a, b) => a + b, 0);
    if (leftDense < 10 || rightDense < 10) continue;
    const score = window - Math.min(leftDense, rightDense) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;
  // Require the quiet band to actually be quiet relative to page density.
  const quiet =
    counts[bestIdx - 1] + counts[bestIdx] + counts[Math.min(bins - 1, bestIdx + 1)];
  const avg = words.length / bins;
  if (quiet > avg * 1.2) return null;

  return ((bestIdx + 0.5) / bins) * pageWidth;
}

function clusterColumns(words, pageWidth) {
  if (!words.length) return [words];

  const split = findGutterSplit(words, pageWidth) ?? pageWidth / 2;
  const gutter = pageWidth * 0.045;

  const left = [];
  const right = [];
  const middle = [];

  for (const word of words) {
    const c = wordCenterX(word);
    if (c < split - gutter) left.push(word);
    else if (c > split + gutter) right.push(word);
    else middle.push(word);
  }

  // Only treat as two columns when both sides have real content.
  if (left.length >= 10 && right.length >= 10) {
    for (const word of middle) {
      const c = wordCenterX(word);
      if (c < split) left.push(word);
      else right.push(word);
    }
    return [left, right];
  }

  return [words];
}

function sortReadingOrder(words) {
  return [...words].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    const lineThreshold = Math.max(
      10,
      (a.bbox.y1 - a.bbox.y0 + (b.bbox.y1 - b.bbox.y0)) / 2,
    );
    if (Math.abs(ay - by) > lineThreshold * 0.7) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });
}

function wordsToText(words) {
  if (!words.length) return "";
  const ordered = sortReadingOrder(words);
  const lines = [];
  let current = [];
  let lastY = null;

  for (const word of ordered) {
    const text = (word.text || "").trim();
    if (!text) continue;
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    const lineHeight = Math.max(12, word.bbox.y1 - word.bbox.y0);
    if (lastY != null && Math.abs(y - lastY) > lineHeight * 0.75) {
      lines.push(current.join(" "));
      current = [];
    }
    current.push(text);
    lastY = y;
  }
  if (current.length) lines.push(current.join(" "));
  return lines.join("\n").trim();
}

/**
 * @param {import('tesseract.js').Page} page
 */
function textFromOcrPage(page) {
  const words = (page.words || []).filter((w) => (w.text || "").trim());
  if (words.length < 8) {
    return {
      text: (page.text || "").trim(),
      columns: 1,
    };
  }

  const pageWidth = Math.max(
    page.width || 0,
    ...words.map((w) => w.bbox.x1),
  );

  const columns = clusterColumns(words, pageWidth);
  const parts = columns.map((col) => wordsToText(col)).filter(Boolean);
  return {
    text: parts.join("\n\n"),
    columns: columns.length,
  };
}

module.exports = { textFromOcrPage, clusterColumns, wordsToText, findGutterSplit };
