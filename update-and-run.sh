#!/bin/bash
# Update Read to Me from GitHub and start the floating pill.
# Usage (from anywhere):
#   ~/Main-github/update-and-run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
DESKTOP_DIR="$REPO_DIR/desktop"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "Couldn't find desktop/ next to this script."
  echo "Expected: $DESKTOP_DIR"
  exit 1
fi

cd "$REPO_DIR"
BRANCH="$(git branch --show-current)"
echo "→ Updating Read to Me (${BRANCH:-detached})…"
git fetch origin
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  git pull --ff-only
else
  echo "No upstream for this clone. Using the files already on disk."
fi

echo "→ Installing dependencies…"
cd "$DESKTOP_DIR"
npm install

echo "→ Checking API names (preload / main / renderer must match)…"
npm run check-api

echo "→ Starting the floating pill…"
echo "  (Quit later with Ctrl+C in this Terminal window)"
npm start
