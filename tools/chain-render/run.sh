#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

BIN=build/chain-render/chain_render
OUTDIR=out/chain-render
CORPUS="piano_mid_C4 marimba_mid_C5B5 vocal_female_vibrato cello_low_sulC_A2"
PLAIN="none bitcrush lfx lfx_nobc"
CHAIN="faust faust_bp faust_clean full full_bp"

mkdir -p "$OUTDIR"

for c in $CORPUS; do
  IN="test-audio-corpus/instruments/$c.wav"
  for m in $PLAIN; do
    "$BIN" in="$IN" out="$OUTDIR/$c.$m.wav" mode="$m" tap=master block=64 warmup=48000
  done
  for m in $CHAIN; do
    for t in master cue; do
      "$BIN" in="$IN" out="$OUTDIR/$c.$m.$t.wav" mode="$m" tap=$t block=64 warmup=48000
    done
  done
done

IN="test-audio-corpus/instruments/piano_mid_C4.wav"
for m in flanger tremolo phaser distortion vinyl flutter; do
  "$BIN" in="$IN" out="$OUTDIR/piano_mid_C4.$m.wav" mode="$m" tap=master block=64 warmup=48000
done

for m in $PLAIN; do
  "$BIN" in="$IN" out="$OUTDIR/piano_mid_C4.$m.offgrid.wav" mode="$m" tap=master block=64 warmup=48000 gain=1.0001
done

"$BIN" in="$IN" out=/dev/null mode=full tap=master dump=1
