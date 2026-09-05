/**
 * Rebuild reading order from Tesseract word boxes.
 * Two-column pages are read left column top→bottom, then right.
 * Decorative headers and low-confidence OCR junk are dropped first.
 */

function wordCenterX(word) {
  return (word.bbox.x0 + word.bbox.x1) / 2;
}

function wordCenterY(word) {
  return (word.bbox.y0 + word.bbox.y1) / 2;
}

function letterRatio(text) {
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / Math.max(1, text.length);
}

function isReadableWord(word) {
  const text = (word.text || "").trim();
  if (!text) return false;
  if (text.length === 1 && !/[A-Za-z0-9]/.test(text)) return false;
  if (letterRatio(text) < 0.5) return false;
  if (typeof word.confidence === "number" && word.confidence < 50) return false;
  // Ornamental / symbol garbage from chapter art.
  if (/^[\W\d_|\\/~^=<>{}[\]()]+$/.test(text)) return false;
  if (/[{}|\\~^=]/.test(text) && letterRatio(text) < 0.7) return false;
  return true;
}

/**
 * Drop the decorative top band when it's noisier than the body text.
 */
function dropNoisyHeader(words, pageHeight) {
  if (words.length < 20 || !pageHeight) return words;

  const cutY = pageHeight * 0.2;
  const header = words.filter((w) => wordCenterY(w) < cutY);
  const body = words.filter((w) => wordCenterY(w) >= cutY);
  if (body.length < 16) return words;

  const headerAvg =
    header.reduce((sum, w) => sum + (w.confidence ?? 70), 0) /
    Math.max(1, header.length);
  const bodyAvg =
    body.reduce((sum, w) => sum + (w.confidence ?? 70), 0) /
    Math.max(1, body.length);
  const headerLetter =
    header.reduce((sum, w) => sum + letterRatio(w.text || ""), 0) /
    Math.max(1, header.length);

  if (header.length && (headerAvg + 6 < bodyAvg || headerLetter < 0.65)) {
    return body;
  }
  return words;
}

function findGutterSplit(words, pageWidth) {
  if (words.length < 20 || pageWidth <= 0) return null;

  const bins = 64;
  const counts = new Array(bins).fill(0);
  for (const word of words) {
    const idx = Math.min(
      bins - 1,
      Math.max(0, Math.floor((wordCenterX(word) / pageWidth) * bins)),
    );
    counts[idx] += 1;
  }

  const start = Math.floor(bins * 0.28);
  const end = Math.ceil(bins * 0.72);
  let bestIdx = -1;
  let bestScore = Infinity;

  for (let i = start; i < end; i += 1) {
    const quiet =
      counts[i - 1] + counts[i] + counts[Math.min(bins - 1, i + 1)];
    const leftDense = counts.slice(0, i).reduce((a, b) => a + b, 0);
    const rightDense = counts.slice(i + 1).reduce((a, b) => a + b, 0);
    if (leftDense < 12 || rightDense < 12) continue;
    const balance =
      Math.abs(leftDense - rightDense) / (leftDense + rightDense);
    const score = quiet * 3 + balance * 18;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;
  const quiet =
    counts[bestIdx - 1] +
    counts[bestIdx] +
    counts[Math.min(bins - 1, bestIdx + 1)];
  const avg = words.length / bins;
  // Mistborn pages sometimes have art in the gutter — allow a bit of noise.
  if (quiet > avg * 2.4) return null;

  return ((bestIdx + 0.5) / bins) * pageWidth;
}

function clusterColumns(words, pageWidth) {
  if (!words.length) return [words];

  let split = findGutterSplit(words, pageWidth);
  if (split == null) {
    // Force a mid-page split when both halves look like real columns.
    const mid = pageWidth / 2;
    const left = words.filter((w) => wordCenterX(w) < mid);
    const right = words.filter((w) => wordCenterX(w) >= mid);
    if (left.length >= 18 && right.length >= 18) return [left, right];
    return [words];
  }

  const gutter = pageWidth * 0.03;
  const left = [];
  const right = [];
  const middle = [];

  for (const word of words) {
    const c = wordCenterX(word);
    if (c < split - gutter) left.push(word);
    else if (c > split + gutter) right.push(word);
    else middle.push(word);
  }

  if (left.length >= 12 && right.length >= 12) {
    for (const word of middle) {
      if (wordCenterX(word) < split) left.push(word);
      else right.push(word);
    }
    return [left, right];
  }

  return [words];
}

function sortReadingOrder(words) {
  return [...words].sort((a, b) => {
    const ay = wordCenterY(a);
    const by = wordCenterY(b);
    const lineThreshold = Math.max(
      10,
      (a.bbox.y1 - a.bbox.y0 + (b.bbox.y1 - b.bbox.y0)) / 2,
    );
    if (Math.abs(ay - by) > lineThreshold * 0.65) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });
}

function lineLooksLikeJunk(line) {
  const text = line.trim();
  if (!text) return true;
  if (letterRatio(text) < 0.58) return true;
  const tokens = text.split(/\s+/);
  // Keep normal English words even when a "line" is a single short token
  // (can happen before reflow when word boxes are vertically sparse).
  if (tokens.length === 1 && /^[A-Za-z][A-Za-z'-]*$/.test(tokens[0])) {
    return false;
  }
  if (tokens.length <= 2 && text.length < 14 && !/^[A-Z][a-z]{2,}/.test(text)) {
    return true;
  }
  if (/[{}|\\~^=]{2,}/.test(text)) return true;
  if (/\bCHAPTER\s*\d+/i.test(text) && tokens.length <= 6) return true;
  // Short all-caps fragments from decorative headers.
  if (tokens.length <= 3 && text === text.toUpperCase() && text.length < 18) {
    return true;
  }
  return false;
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
    const y = wordCenterY(word);
    const lineHeight = Math.max(12, word.bbox.y1 - word.bbox.y0);
    if (lastY != null && Math.abs(y - lastY) > lineHeight * 0.7) {
      lines.push(current.join(" "));
      current = [];
    }
    current.push(text);
    lastY = y;
  }
  if (current.length) lines.push(current.join(" "));

  return lines
    .filter((line) => !lineLooksLikeJunk(line))
    .join("\n")
    .trim();
}

/**
 * Join wrapped visual lines into continuous prose for speech.
 * `say` pauses on every newline, so line breaks must not survive into TTS.
 */
function reflowColumnProse(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";

  let prose = lines[0];
  for (let i = 1; i < lines.length; i += 1) {
    if (prose.endsWith("-")) {
      prose = `${prose.slice(0, -1)}${lines[i]}`;
    } else {
      prose = `${prose} ${lines[i]}`;
    }
  }
  return prose.replace(/\s+/g, " ").trim();
}

function sanitizeForSpeech(text) {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/[^\w\s.,;:'"!?()\-\n]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

/**
 * Drop leading decorative / OCR-garbage lines until real prose begins.
 */
function trimLeadingJunk(text) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    const words = line.split(/\s+/).filter(Boolean);
    const looksLikeProse =
      words.length >= 5 &&
      letterRatio(line) >= 0.7 &&
      /[a-z]/.test(line) &&
      !lineLooksLikeJunk(line);
    if (looksLikeProse) break;
    start += 1;
  }
  // If we never found prose, keep original (better than empty).
  if (start >= lines.length) return text;
  return lines.slice(start).join("\n").trim();
}

/**
 * @param {import('tesseract.js').Page} page
 */
function textFromOcrPage(page) {
  const pageWidth = Math.max(
    page.width || 0,
    ...(page.words || []).map((w) => w.bbox?.x1 || 0),
    1,
  );
  const pageHeight = Math.max(
    page.height || 0,
    ...(page.words || []).map((w) => w.bbox?.y1 || 0),
    1,
  );

  let words = (page.words || []).filter((word) => {
    if (!isReadableWord(word)) return false;
    const box = word.bbox;
    if (!box) return false;
    // Drop broken tess boxes — they also correlate with the C++ "Invalid box" spam.
    if (!(box.x1 > box.x0) || !(box.y1 > box.y0)) return false;
    if (box.x0 < -2 || box.y0 < -2) return false;
    if (box.x1 > pageWidth + 4 || box.y1 > pageHeight + 4) return false;
    return true;
  });
  words = dropNoisyHeader(words, pageHeight);

  if (words.length < 8) {
    return {
      text: sanitizeForSpeech(trimLeadingJunk((page.text || "").trim())),
      columns: 1,
    };
  }

  const columns = clusterColumns(words, pageWidth);
  // Continuous prose per column (no visual line breaks), space between columns.
  const parts = columns
    .map((col) => reflowColumnProse(wordsToText(col)))
    .filter(Boolean);
  return {
    text: sanitizeForSpeech(trimLeadingJunk(parts.join(" "))),
    columns: columns.length,
  };
}

module.exports = {
  textFromOcrPage,
  clusterColumns,
  wordsToText,
  findGutterSplit,
  isReadableWord,
  sanitizeForSpeech,
};
