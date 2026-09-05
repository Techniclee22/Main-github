#!/usr/bin/env bash
# Pull the Kokoro live-TTS branch and start the pill (for Mac retests while we iterate).
# Usage:
#   bash ~/Main-github/update-and-run-kokoro.sh

if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

BRANCH="cursor/kokoro-live-tts-f8bd"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${SCRIPT_DIR}"
DESKTOP_DIR="${REPO_DIR}/desktop"

if [[ ! -d "${DESKTOP_DIR}" ]]; then
  echo "Couldn't find desktop/ next to this script."
  echo "Expected: ${DESKTOP_DIR}"
  exit 1
fi

cd "${REPO_DIR}"
echo "-> Updating Read to Me (${BRANCH})..."
git fetch origin
if ! git checkout "${BRANCH}"; then
  echo
  echo "Could not check out ${BRANCH}."
  echo "If local edits are in the way:"
  echo "  git stash -u && git checkout ${BRANCH}"
  echo
  exit 1
fi
if ! git pull --ff-only origin "${BRANCH}"; then
  echo
  echo "Could not fast-forward ${BRANCH}."
  echo "Local edits are in the way (npm install can rewrite desktop/package-lock.json)."
  echo
  echo "If you have work you want to keep:"
  echo "  git stash -u && git pull --ff-only origin ${BRANCH}"
  echo
  echo "If you just want the latest from GitHub on this branch:"
  echo "  git fetch origin && git reset --hard origin/${BRANCH}"
  echo
  exit 1
fi

echo "-> Installing dependencies..."
cd "${DESKTOP_DIR}"
npm install

echo "-> Checking API names (preload / main / renderer must match)..."
npm run check-api

echo "-> Starting the floating pill..."
echo "  (Quit later with Ctrl+C in this Terminal window)"
npm start
