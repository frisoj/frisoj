#!/usr/bin/env sh
# Bouwt RideASkyWhale.rbxl: eerst de scripts met Rojo, dan de map met Lune.
# Nodig: rojo en lune (zie rokit.toml).
set -e
cd "$(dirname "$0")"
mkdir -p build
rojo build default.project.json -o build/scripts.rbxl
lune run tools/build-place build/scripts.rbxl RideASkyWhale.rbxl
