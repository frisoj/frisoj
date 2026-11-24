#!/usr/bin/env bash
# Builds the Roblox place file from the source tree with Rojo.
# Usage: tools/build.sh   ->  build/CrystalSmashers.rbxlx
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
rojo build default.project.json -o build/CrystalSmashers.rbxlx
echo "Built build/CrystalSmashers.rbxlx"
