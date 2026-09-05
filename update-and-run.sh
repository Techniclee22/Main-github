#!/usr/bin/env bash
# Fetch this clone's current branch, install desktop deps, start the pill.
# Usage:
#   bash ~/Main-github/update-and-run.sh

if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${SCRIPT_DIR}"
DESKTOP_DIR="${REPO_DIR}/desktop"

if [[ ! -d "${DESKTOP_DIR}" ]]; then
  echo "Couldn't find desktop/ next to this script."
  echo "Expected: ${DESKTOP_DIR}"
  exit 1
fi

cd "${REPO_DIR}"
# npm install rewrites the lockfile. Throw that dirt away before git pull/checkout.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  if ! git diff --quiet -- desktop/package-lock.json 2>/dev/null \
    || ! git diff --cached --quiet -- desktop/package-lock.json 2>/dev/null; then
    echo "-> Discarding local desktop/package-lock.json (npm install rewrites it)"
    git checkout HEAD -- desktop/package-lock.json || true
  fi
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "${BRANCH}" || "${BRANCH}" == "HEAD" ]]; then
  BRANCH="detached"
fi
echo "-> Updating Read to Me (${BRANCH})..."
git fetch origin
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  if ! git pull --ff-only; then
    echo
    echo "Could not fast-forward this clone."
    echo "Local edits are in the way (npm install can rewrite desktop/package-lock.json)."
    echo
    echo "If you have work you want to keep:"
    echo "  git stash -u && git pull --ff-only"
    echo
    echo "If you just want the latest from GitHub on this branch:"
    echo "  git fetch origin && git reset --hard origin/${BRANCH}"
    echo
    echo "If this clone is still on an old Cursor branch, switch to main:"
    echo "  bash ./switch-to-main.sh"
    echo
    echo "Or by hand (the lockfile line unblocks git checkout):"
    echo "  git checkout HEAD -- desktop/package-lock.json"
    echo "  git fetch origin && git checkout main && git pull --ff-only"
    echo
    exit 1
  fi
else
  echo "No upstream for this clone. Using the files already on disk."
fi

echo "-> Installing dependencies..."
cd "${DESKTOP_DIR}"
npm install

echo "-> Checking API names (preload / main / renderer must match)..."
npm run check-api

echo "-> Starting the floating pill..."
echo "  (Quit later with Ctrl+C in this Terminal window)"
npm start
