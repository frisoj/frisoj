#!/usr/bin/env sh
# Bouwt StealASlime.rbxl: eerst de scripts met Rojo, dan de wereld met Lune.
# Nodig: rojo en lune (zie rokit.toml of tools/install-tools.sh).
set -e
cd "$(dirname "$0")"
mkdir -p build
rojo build default.project.json -o build/scripts.rbxl
lune run tools/build-place build/scripts.rbxl StealASlime.rbxl
