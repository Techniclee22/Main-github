#!/usr/bin/env bash
# Same as update-and-run.sh. Kept so old Terminal history still launches.
# Usage:
#   bash ~/Main-github/update-and-run-focus.sh
if [ -z "${BASH_VERSION-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "${SCRIPT_DIR}/update-and-run.sh"
