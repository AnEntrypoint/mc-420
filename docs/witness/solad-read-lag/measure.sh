#!/usr/bin/env bash
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
DSP=${1:-/tmp/dsp_cli_lat}
TAG=${2:-base}
OUTDIR=${3:-$(mktemp -d)}
mkdir -p "$OUTDIR"
CORPUS="$ROOT/test-audio-corpus/instruments"
RESULTS="$ROOT/docs/witness/solad-read-lag/results-$TAG.csv"
mkdir -p "$ROOT/docs/witness/solad-read-lag"
echo "file,semis,gapMin,gapMean,gapMax,measured,effRate,splices,emergency,clamped,peakStep,rms,glitches" > "$RESULTS"
for f in "$CORPUS"/*.wav; do
  name=$(basename "$f" .wav)
  for s in 0 7 -5; do
    w="$OUTDIR/$name.$s.wav"
    line=$("$DSP" --solad "in=$f" "out=$w" "semis=$s" normrms=0.21 2>/dev/null | awk -F, '/^solad,/{print}')
    if [ -z "$line" ]; then echo "$name,$s,ERROR" >> "$RESULTS"; continue; fi
    gmin=$(echo "$line"  | awk -F, '{print $13}' | cut -d= -f2)
    gmean=$(echo "$line" | awk -F, '{print $14}' | cut -d= -f2)
    gmax=$(echo "$line"  | awk -F, '{print $15}' | cut -d= -f2)
    meas=$(echo "$line"  | awk -F, '{print $6}'  | cut -d= -f2)
    eff=$(echo "$line"   | awk -F, '{print $12}' | cut -d= -f2)
    spl=$(echo "$line"   | awk -F, '{print $9}'  | cut -d= -f2)
    emg=$(echo "$line"   | awk -F, '{print $10}' | cut -d= -f2)
    clm=$(echo "$line"   | awk -F, '{print $11}' | cut -d= -f2)
    pst=$(echo "$line"   | awk -F, '{print $18}' | cut -d= -f2)
    rms=$(echo "$line"   | awk -F, '{print $19}' | cut -d= -f2)
    gl=$("$DSP" --glitch-check "$w" threshold=0.25 minGapMs=5 2>/dev/null | awk -F'glitches=' '/glitches=/{print $2}' | awk '{print $1}' | head -1)
    [ -z "$gl" ] && gl=0
    echo "$name,$s,$gmin,$gmean,$gmax,$meas,$eff,$spl,$emg,$clm,$pst,$rms,$gl" >> "$RESULTS"
  done
done
echo "wrote $RESULTS"
