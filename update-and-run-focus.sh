#!/bin/bash
# Checkout the column/focus-fix branch, then update and launch.
# Usage:
#   ~/Main-github/update-and-run-focus.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="cursor/fix-columns-and-focus-b940"
LAUNCH="${SCRIPT_DIR}/update-and-run.sh"

if [[ ! -x "${LAUNCH}" ]]; then
  echo "Couldn't find update-and-run.sh next to this script."
  exit 1
fi

cd "${SCRIPT_DIR}"
echo "-> Switching to ${BRANCH}..."
git fetch origin "${BRANCH}"
if ! git checkout "${BRANCH}"; then
  echo
  echo "Could not check out ${BRANCH}."
  echo "Stash or commit local edits, then run this script again."
  exit 1
fi

exec "${LAUNCH}"
