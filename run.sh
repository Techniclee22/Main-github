#!/bin/bash
# Start Read to Me without updating (faster day-to-day launch).
# Usage:
#   ~/Main-github/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/desktop"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "Couldn't find desktop/ next to this script."
  exit 1
fi

cd "$DESKTOP_DIR"
echo "→ Checking API names…"
npm run check-api

echo "→ Starting the floating pill…"
echo "  (Quit later with Ctrl+C in this Terminal window)"
npm start
