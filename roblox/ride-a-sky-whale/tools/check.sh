#!/usr/bin/env sh
# Controleert alle code: Roblox-typecheck en de logica-tests. Stopt bij de eerste fout.
set -e
cd "$(dirname "$0")/.."
DEFS="${LUAU_DEFS:-.tools/globalTypes.None.d.luau}"
rojo sourcemap default.project.json -o sourcemap.json
OUT=$(luau-lsp analyze --sourcemap=sourcemap.json --definitions="$DEFS" --platform=roblox src/ 2>&1 | grep -v '^\[' || true)
if [ -n "$OUT" ]; then
	echo "$OUT"
	echo "Typecheck: FOUTEN gevonden"
	exit 1
fi
echo "Typecheck: geen fouten"
for t in tools/tests/*.test.luau; do
	lune run "$t" "$PWD"
done
