#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function assertIncludes(errors, label, haystack, needle) {
  if (!haystack.includes(needle)) {
    errors.push(`${label}: missing \`${needle}\``);
  }
}

function extractInvokePairs(preloadSrc) {
  const pairs = {};
  const re =
    /(\w+)\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(preloadSrc)) !== null) {
    pairs[match[1]] = match[2];
  }
  return pairs;
}

function extractHandlers(mainSrc) {
  const handlers = new Set();
  const re = /ipcMain\.handle\(\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(mainSrc)) !== null) handlers.add(match[1]);
  return handlers;
}

function extractExports(moduleSrc) {
  const block = moduleSrc.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return new Set();
  return new Set(
    block[1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(line)),
  );
}

function extractDomIds(htmlSrc) {
  return new Set([...htmlSrc.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}

function extractGetElementIds(jsSrc) {
  return new Set(
    [...jsSrc.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
  );
}

function extractReadToMeCalls(...sources) {
  const names = new Set();
  for (const src of sources) {
    for (const match of src.matchAll(/readToMe\.(\w+)/g)) names.add(match[1]);
  }
  return names;
}

function matchingDelim(src, openIndex, openCh, closeCh) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escape = false;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") escape = true;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") escape = true;
      else if (ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`") inTemplate = true;
    else if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractNamedFunction(src, name) {
  const re = new RegExp(String.raw`(?:async\s+)?function\s+${name}\s*\(`);
  const match = re.exec(src);
  if (!match) return null;
  const start = match.index;
  const openParen = match.index + match[0].length - 1;
  const closeParen = matchingDelim(src, openParen, "(", ")");
  if (closeParen < 0) return null;
  const braceStart = src.indexOf("{", closeParen);
  if (braceStart < 0) return null;
  const braceEnd = matchingDelim(src, braceStart, "{", "}");
  if (braceEnd < 0) return null;
  return src.slice(start, braceEnd + 1);
}

function readResultNeedles(key) {
  switch (key) {
    case "text":
      return ["text: text", 'text: ""'];
    case "title":
      return ["title: source.name"];
    case "columns":
      return ["columns: columns"];
    case "id":
      return ["id: source.id"];
    case "words":
      return ["words: words"];
    default:
      return [`${key}:`];
  }
}

function missingReadResultKeys(sourceSrc, keys) {
  const body = extractNamedFunction(sourceSrc, "readWindowSource");
  if (!body) {
    return keys.map((key) => `${key} (missing readWindowSource)`);
  }
  const missing = [];
  for (const key of keys) {
    for (const needle of readResultNeedles(key)) {
      if (!body.includes(needle)) missing.push(`${key} (${needle})`);
    }
  }
  return missing;
}

/**
 * @param {Record<string, string>} [overrides] source text by repo-relative path
 */
function collectContractErrors(overrides = {}) {
  const read = (rel) => overrides[rel] ?? fs.readFileSync(path.join(root, rel), "utf8");
  const contract = JSON.parse(read("api-contract.json"));
  const errors = [];
  const preloadSrc = read("preload.cjs");
  const mainSrc = read("main.cjs");
  const ttsSrc = read("lib/tts.cjs");
  const kokoroLiveSrc = read("lib/kokoro-live.cjs");
  const kokoroWorkerSrc = read("lib/kokoro-worker.cjs");
  const pillSrc = read("renderer/pill.js");
  const speechSrc = read("renderer/speech.js");
  const htmlSrc = read("renderer/pill.html");

  const preloadPairs = extractInvokePairs(preloadSrc);
  for (const [api, channel] of Object.entries(contract.readToMe)) {
    if (preloadPairs[api] !== channel) {
      errors.push(
        `preload: expected ${api} -> "${channel}", got ${
          preloadPairs[api] ? `${api} -> "${preloadPairs[api]}"` : "missing"
        }`,
      );
    }
  }
  for (const api of Object.keys(preloadPairs)) {
    if (!contract.readToMe[api]) {
      errors.push(`preload: extra API \`${api}\` not in api-contract.json`);
    }
  }

  const handlers = extractHandlers(mainSrc);
  for (const channel of Object.values(contract.readToMe)) {
    if (!handlers.has(channel)) {
      errors.push(`main: missing ipcMain handler "${channel}"`);
    }
  }

  const rendererCalls = extractReadToMeCalls(pillSrc, speechSrc);
  for (const name of rendererCalls) {
    if (!contract.readToMe[name]) {
      errors.push(
        `renderer: calls readToMe.${name} which is not in api-contract.json`,
      );
    }
  }

  const ttsExports = extractExports(ttsSrc);
  for (const name of contract.ttsExports) {
    if (!ttsExports.has(name)) errors.push(`tts: missing export \`${name}\``);
  }
  for (const name of contract.mainTtsImports) {
    assertIncludes(errors, "main tts import list", mainSrc, name);
    if (!ttsExports.has(name)) {
      errors.push(`main imports tts.${name} but tts does not export it`);
    }
  }

  for (const name of contract.speechPublicMethods) {
    const methodRe = new RegExp(
      `(?:async\\s+${name}\\s*\\(|\\b${name}\\s*\\(|get\\s+${name}\\s*\\()`,
    );
    if (!methodRe.test(speechSrc)) {
      errors.push(`speech.js: missing public method \`${name}\``);
    }
  }
  for (const name of ["speakLive", "prefetchLive", "speakStream", "stop"]) {
    assertIncludes(
      errors,
      `pill.js uses speech.${name}`,
      pillSrc,
      `speech.${name}`,
    );
  }
  for (const cb of contract.speechCreateCallbacks) {
    assertIncludes(errors, "speech.js create callback param", speechSrc, cb);
  }
  for (const cb of contract.pillSpeechCallbacks) {
    assertIncludes(errors, "pill.js create callback", pillSrc, cb);
  }

  assertIncludes(errors, "pill.js calls speech.speakLive", pillSrc, "speech.speakLive");
  for (const [key, engine] of Object.entries(contract.engines)) {
    assertIncludes(
      errors,
      `engine ${key} in tts.cjs or kokoro-live.cjs`,
      `${ttsSrc}\n${kokoroLiveSrc}`,
      `"${engine}"`,
    );
  }
  for (const engine of [contract.engines.liveMac, contract.engines.liveKokoro]) {
    if (new RegExp(`["']${engine}["']`).test(speechSrc)) {
      errors.push(
        `speech.js names engine "${engine}"; report result.engine from main instead`,
      );
    }
  }
  const kokoroRequire = /require(?:\.resolve)?\(\s*["']kokoro-js["']/;
  for (const [label, src] of [
    ["lib/tts.cjs", ttsSrc],
    ["lib/kokoro-live.cjs", kokoroLiveSrc],
  ]) {
    if (kokoroRequire.test(src)) {
      errors.push(`${label} requires kokoro-js; only lib/kokoro-worker.cjs may`);
    }
  }
  if (!kokoroRequire.test(kokoroWorkerSrc)) {
    errors.push("lib/kokoro-worker.cjs: missing the lazy require of kokoro-js");
  }

  const readBody = extractNamedFunction(mainSrc, "readWindowSource");
  if (!readBody) {
    errors.push("main.cjs: missing function readWindowSource");
  } else {
    for (const miss of missingReadResultKeys(
      mainSrc,
      contract.readResultKeys || [],
    )) {
      errors.push(`readWindowSource return: missing ${miss}`);
    }
  }

  const htmlIds = extractDomIds(htmlSrc);
  const pillIds = extractGetElementIds(pillSrc);
  for (const id of contract.pillDomIds) {
    if (!htmlIds.has(id)) errors.push(`pill.html: missing id="${id}"`);
    if (!pillIds.has(id)) {
      errors.push(`pill.js: missing getElementById("${id}")`);
    }
  }
  for (const id of pillIds) {
    if (!htmlIds.has(id)) {
      errors.push(`pill.js looks up #${id} but pill.html has no such id`);
    }
  }

  return errors;
}

function runCheck() {
  const errors = collectContractErrors();
  if (errors.length) {
    console.error("API contract check FAILED:\n");
    for (const error of errors) console.error(`  • ${error}`);
    console.error(
      "\nFix: change desktop/api-contract.json and every consumer in the same commit.",
    );
    console.error(
      "Never rename speakLive / planSpeech / DOM ids / IPC channels in only one file.\n",
    );
    process.exit(1);
  }

  console.log("API contract check passed.");
}

module.exports = {
  extractNamedFunction,
  missingReadResultKeys,
  readResultNeedles,
  collectContractErrors,
};

if (require.main === module) {
  runCheck();
}
