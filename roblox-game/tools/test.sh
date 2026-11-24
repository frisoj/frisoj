#!/usr/bin/env bash
# Runs the headless test-suite with Lune (https://github.com/lune-org/lune).
# Usage: tools/test.sh [filter ...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec lune run "$ROOT/tests/run.luau" "$@"
