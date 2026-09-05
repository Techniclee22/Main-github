#!/usr/bin/env bash
# Checkout the column/focus-fix branch, then update and launch.
# Usage:
#   bash ~/Main-github/update-and-run-focus.sh
#
# If an older copy died with "unbound variable" on line 17, do not rerun it.
# That file never fetched this fix. In Terminal:
#   cd ~/Main-github
#   git fetch origin
#   git checkout cursor/fix-columns-and-focus-b940
#   git pull --ff-only
#   bash ./update-and-run.sh

# Mac Terminal is zsh. Unquoted BRANCH glued to a Unicode ellipsis is a
# different parameter under set -u. Always continue in bash.
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="cursor/fix-columns-and-focus-b940"
LAUNCH="${SCRIPT_DIR}/update-and-run.sh"

if [[ ! -x "${LAUNCH}" && ! -f "${LAUNCH}" ]]; then
  echo "Couldn't find update-and-run.sh next to this script."
  exit 1
fi
chmod +x "${LAUNCH}" 2>/dev/null || true

cd "${SCRIPT_DIR}"
echo "-> Switching to ${BRANCH}..."
git fetch origin "${BRANCH}"
if ! git checkout "${BRANCH}"; then
  echo
  echo "Could not check out ${BRANCH}."
  echo "Stash or commit local edits, then run this script again."
  exit 1
fi
if ! git merge --ff-only "origin/${BRANCH}"; then
  echo
  echo "Checked out ${BRANCH} but could not fast-forward from origin."
  echo "Stash or commit local edits, then run: bash ./update-and-run.sh"
  exit 1
fi

exec bash "${LAUNCH}"
