#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

OUT=build/resonode-lab
mkdir -p "$OUT"

F="-vec -fun -dfs -vs 32 -nvi -ct 0"
I="-I . -I dsp -I effects/home/faust -I tools/chain-render"

faust $F -lang cpp -cn ResonodeDsp $I effects/home/faust/resonode_synth.dsp -o "$OUT/resonode_gen.cpp"

wc -l "$OUT"/resonode_gen.cpp
