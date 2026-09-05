/**
 * Pick the desktopCapturer source that matches the frontmost app.
 * Electron source.name is the window title, which often does not include
 * the process name (Terminal tabs are "zsh", not "Terminal").
 */

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[—–−]/g, "-")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value) {
  return normalizeTitle(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function titlesOverlap(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(titleTokens(left));
  const rightTokens = titleTokens(right);
  if (!rightTokens.length || !leftTokens.size) return false;
  let hit = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) hit += 1;
  }
  return hit >= Math.min(2, rightTokens.length) && hit / rightTokens.length >= 0.5;
}

function scoreWindowCandidate(win, focus, appWindowTitles = []) {
  const name = win.name || "";
  let score = 0;

  if (focus?.title && titlesOverlap(name, focus.title)) score += 200;
  for (const title of appWindowTitles) {
    if (titlesOverlap(name, title)) {
      score += 180;
      break;
    }
  }

  if (focus?.app) {
    const app = focus.app.toLowerCase();
    const lower = name.toLowerCase();
    if (lower.includes(app) || app.includes(lower)) score += 80;
    const readingApp =
      /preview|acrobat|adobe/.test(app) || /\.pdf\b/.test(app);
    if (readingApp && /\.pdf\b/.test(lower)) score += 40;
    if (!readingApp && /\.pdf\b/.test(lower) && !titlesOverlap(name, focus.title)) {
      score -= 60;
    }
    return score;
  }

  if (/\.pdf\b/.test(name)) score += 50;
  if (/preview/i.test(name)) score += 30;
  return score;
}

function pickSource(sources, focus, appWindowTitles = []) {
  if (!sources?.length) return null;
  const ranked = [...sources].sort(
    (a, b) =>
      scoreWindowCandidate(b, focus, appWindowTitles) -
      scoreWindowCandidate(a, focus, appWindowTitles),
  );
  return ranked[0];
}

module.exports = {
  normalizeTitle,
  titlesOverlap,
  scoreWindowCandidate,
  pickSource,
};
