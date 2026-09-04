#!/bin/bash
# Update Read to Me from GitHub and start the floating pill.
# Usage (from anywhere):
#   ~/Main-github/update-and-run.sh

set -euo pipefail

BRANCH="cursor/read-to-me-app-bbd6"

# Find this script's repo (works no matter where you run it from).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
DESKTOP_DIR="$REPO_DIR/desktop"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "Couldn't find desktop/ next to this script."
  echo "Expected: $DESKTOP_DIR"
  exit 1
fi

echo "→ Updating Read to Me ($BRANCH)…"
cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "→ Installing dependencies…"
cd "$DESKTOP_DIR"
npm install

echo "→ Starting the floating pill…"
echo "  (Quit later with Ctrl+C in this Terminal window)"
npm start
