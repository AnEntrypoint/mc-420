#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

OUT=build/resonode-lab
mkdir -p "$OUT"

if [ ! -f "$OUT/resonode_gen.cpp" ]; then
    sh tools/resonode-lab/gen.sh
fi

g++ -O2 -std=c++17 -I tools/chain-render -I "$OUT" -I . \
    tools/resonode-lab/render.cpp -o "$OUT/render" -lm

echo "built $OUT/render"
