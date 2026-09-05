#!/usr/bin/env bash
# Discard npm lockfile dirt, switch this clone to main, then launch.
# Usage (Mac Terminal, from an old Cursor branch):
#   bash ~/Main-github/switch-to-main.sh
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ ! -d .git ]]; then
  echo "Couldn't find a git clone at ${SCRIPT_DIR}"
  exit 1
fi

# npm install rewrites this file. It is safe to throw away; install runs again.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git checkout HEAD -- desktop/package-lock.json 2>/dev/null || true
fi

echo "-> Switching to main..."
git fetch origin main
if ! git checkout main; then
  echo
  echo "Checkout is still blocked by other local edits."
  echo "Keep them:"
  echo "  git stash -u && git checkout main && git pull --ff-only"
  echo
  echo "Or drop them and take GitHub's main:"
  echo "  git fetch origin && git checkout -f main && git reset --hard origin/main"
  echo
  exit 1
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  git pull --ff-only
else
  git merge --ff-only origin/main
fi

exec bash "${SCRIPT_DIR}/update-and-run.sh"
