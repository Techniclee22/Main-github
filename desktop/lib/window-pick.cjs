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

function isReadingApp(app) {
  return /preview|acrobat|adobe|skim/i.test(String(app || ""));
}

function isTerminalApp(app) {
  return /^(terminal|iterm2?|alacritty|kitty|warp|ghostty|console)$/i.test(
    String(app || "").trim(),
  );
}

function belongsToFocus(win, focus, appWindowTitles = []) {
  if (!focus?.app) return true;
  const name = win.name || "";
  if (focus.title && titlesOverlap(name, focus.title)) return true;
  for (const title of appWindowTitles) {
    if (titlesOverlap(name, title)) return true;
  }
  const app = normalizeTitle(focus.app);
  const lower = normalizeTitle(name);
  if (app && lower === app) return true;
  if (app.length >= 4 && lower.includes(app)) return true;
  if (isTerminalApp(focus.app) && /\b(zsh|bash|fish|sh|nu)\b/i.test(name)) {
    return true;
  }
  return false;
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
    const app = normalizeTitle(focus.app);
    const lower = normalizeTitle(name);
    if (app && (lower === app || (app.length >= 4 && lower.includes(app)))) {
      score += 80;
    }
    if (isReadingApp(focus.app) && /\.pdf\b/.test(lower)) score += 40;
    return score;
  }

  if (/\.pdf\b/.test(name)) score += 50;
  if (/preview/i.test(name)) score += 30;
  return score;
}

function pickSource(sources, focus, appWindowTitles = []) {
  if (!sources?.length) return null;
  const pool = focus?.app
    ? sources.filter((win) => belongsToFocus(win, focus, appWindowTitles))
    : sources;
  if (!pool.length) return null;
  const ranked = [...pool].sort(
    (a, b) =>
      scoreWindowCandidate(b, focus, appWindowTitles) -
      scoreWindowCandidate(a, focus, appWindowTitles),
  );
  return ranked[0];
}

module.exports = {
  normalizeTitle,
  titlesOverlap,
  belongsToFocus,
  isReadingApp,
  pickSource,
  scoreWindowCandidate,
};
