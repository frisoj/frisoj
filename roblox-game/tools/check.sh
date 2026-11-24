#!/usr/bin/env bash
# Type-checks every script in src/ against the Roblox API definitions.
# Needs an external checker (set RBX_CHECKER to a script that takes the project dir), e.g. a luau-lsp wrapper.
# Usage: tools/check.sh [extra checker args]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECKER="${RBX_CHECKER:-/tmp/claude-0/-home-user-frisoj/37c3947b-7a80-5bec-a475-c70f6d6d9905/scratchpad/tools/bin/check-luau.sh}"
if [ ! -x "$CHECKER" ]; then
  echo "CHECKER NOT INSTALLED (looked for $CHECKER) - type check skipped" >&2
  exit 3
fi
exec "$CHECKER" "$ROOT" "$@"
