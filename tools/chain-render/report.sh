#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

OUTDIR=out/chain-render
JSON="$OUTDIR/metrics.jsonl"
rm -f "$JSON"

CORPUS="piano_mid_C4 marimba_mid_C5B5 vocal_female_vibrato cello_low_sulC_A2"
PLAIN="none bitcrush lfx lfx_nobc"
CHAIN="faust faust_bp faust_clean full full_bp"

for c in $CORPUS; do
  IN="test-audio-corpus/instruments/$c.wav"
  for m in $PLAIN; do
    python3 tools/chain-render/analyze_chain.py --in "$IN" --out "$OUTDIR/$c.$m.wav" --label "$c / $m" --json "$JSON"
  done
  for m in $CHAIN; do
    for t in master cue; do
      python3 tools/chain-render/analyze_chain.py --in "$IN" --out "$OUTDIR/$c.$m.$t.wav" --label "$c / $m / $t" --json "$JSON"
    done
  done
done

IN="test-audio-corpus/instruments/piano_mid_C4.wav"
for m in flanger tremolo phaser distortion vinyl flutter; do
  python3 tools/chain-render/analyze_chain.py --in "$IN" --out "$OUTDIR/piano_mid_C4.$m.wav" --label "piano_mid_C4 / $m" --json "$JSON"
done

for m in $PLAIN; do
  python3 tools/chain-render/analyze_chain.py --in "$IN" --out "$OUTDIR/piano_mid_C4.$m.offgrid.wav" --label "piano_mid_C4 / $m / offgrid" --json "$JSON"
done
