#!/bin/sh
S=$(dirname "$0")
v=$1
for f in /config/workspace/mc-420/test-audio-corpus/instruments/*.wav; do
  b=$(basename "$f" .wav)
  "$S/out/drv_$v" "$f" > "$S/out/trace_${v}_${b}.txt" 2>/dev/null || echo "FAIL $v $b"
done
for hz in 220 440 1000 1500 2093 3000; do
  "$S/out/drv_$v" sine:$hz 3 > "$S/out/trace_${v}_sine_${hz}.txt"
done
echo "done $v"
