#!/usr/bin/env node
/**
 * Fails if preload / main / renderer / tts drift away from api-contract.json.
 *
 *   cd desktop && npm run check-api
 *
 * Rule: never rename a bridge symbol in only one file. Update the contract
 * and every consumer in the same change.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "api-contract.json"), "utf8"),
);

const errors = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assertIncludes(label, haystack, needle) {
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
  // Also handle multi-arg forms broken across lines already covered by [^)]*
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

const preloadSrc = read("preload.cjs");
const mainSrc = read("main.cjs");
const ttsSrc = read("lib/tts.cjs");
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
  assertIncludes("main tts import list", mainSrc, name);
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
for (const name of ["speakLive", "speakStream", "stop"]) {
  assertIncludes(`pill.js uses speech.${name}`, pillSrc, `speech.${name}`);
}
for (const cb of contract.speechCreateCallbacks) {
  assertIncludes("speech.js create callback param", speechSrc, cb);
}
for (const cb of contract.pillSpeechCallbacks) {
  assertIncludes("pill.js create callback", pillSrc, cb);
}

assertIncludes("pill.js live engine", pillSrc, `"${contract.engines.liveMac}"`);
assertIncludes("tts.js live engine", ttsSrc, `"${contract.engines.liveMac}"`);

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
