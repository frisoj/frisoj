#!/usr/bin/env sh
# Installeert Rojo, Lune, luau-lsp en de Roblox-typedefinities in .tools/ (Linux x86_64).
set -e
cd "$(dirname "$0")/.."
ROJO=7.7.1
LUNE=0.10.5
LSP=1.70.1
mkdir -p .tools
cd .tools
curl -sSfL -o rojo.zip "https://github.com/rojo-rbx/rojo/releases/download/v$ROJO/rojo-$ROJO-linux-x86_64.zip"
curl -sSfL -o lune.zip "https://github.com/lune-org/lune/releases/download/v$LUNE/lune-$LUNE-linux-x86_64.zip"
curl -sSfL -o lsp.zip "https://github.com/JohnnyMorganz/luau-lsp/releases/download/$LSP/luau-lsp-linux-x86_64.zip"
for z in rojo.zip lune.zip lsp.zip; do unzip -o -q "$z"; rm "$z"; done
curl -sSfL -o globalTypes.None.d.luau "https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/$LSP/scripts/globalTypes.None.d.luau"
chmod +x rojo lune luau-lsp
if [ -n "$GITHUB_PATH" ]; then echo "$PWD" >> "$GITHUB_PATH"; fi
echo "Tools staan in $PWD"
