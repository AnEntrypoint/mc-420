#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

BIN=build/chain-render/chain_render
OUT=build/parity
MAN="$OUT/manifest.tsv"
mkdir -p "$OUT"
: > "$MAN"

if [ ! -f test-audio-corpus/instruments/piano_mid_C4.wav ]; then
  python3 tools/chain-render/make_corpus.py test-audio-corpus/instruments
fi

IN=test-audio-corpus/instruments/piano_mid_C4.wav

GATE="set=fx/dubgate/amt:0.9 set=fx/dubgate/pattern:1.0 set=fx/dubgate/clockphase:0.1"
LFOV="set=fx/dublfo/depth:0.9 set=fx/dublfo/rate:0.8 set=fx/dublfo/shape:0.5 set=fx/dublfo/target:0.0"
LFOF="set=fx/dublfo/depth:0.9 set=fx/dublfo/rate:0.8 set=fx/dublfo/shape:0.5 set=fx/dublfo/target:1.0"

render() {
  tag="$1"
  tap="$2"
  shift 2
  "$BIN" in="$IN" out="$OUT/$tag.$tap.wav" mode=faust tap=$tap block=64 warmup=48000 "$@"
}

row() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7" >> "$MAN"
}

for t in record inputfx cue; do
  render neutral "$t"
done

for p in gate lfo_vol lfo_filter; do
  case "$p" in
    gate) ARGS="$GATE" ;;
    lfo_vol) ARGS="$LFOV" ;;
    lfo_filter) ARGS="$LFOF" ;;
  esac
  for t in record inputfx cue; do
    render "$p" "$t" $ARGS
  done
  row parity "$p.record_vs_inputfx" "$p" "$OUT/$p.record.wav" "$OUT/$p.inputfx.wav" le -120
  row parity "$p.record_vs_cue" "$p" "$OUT/$p.record.wav" "$OUT/$p.cue.wav" le -120
  row parity "$p.inputfx_vs_cue" "$p" "$OUT/$p.inputfx.wav" "$OUT/$p.cue.wav" le -120
  for t in record inputfx cue; do
    row presence "$p.on_$t" "$p" "$OUT/$p.$t.wav" "$OUT/neutral.$t.wav" ge -30
  done
done

for t in record inputfx cue; do
  render gate_regress "$t" postregress=1 $GATE
done
row regress record_vs_inputfx gate_regress "$OUT/gate_regress.record.wav" "$OUT/gate_regress.inputfx.wav" ge -40
row regress record_vs_cue gate_regress "$OUT/gate_regress.record.wav" "$OUT/gate_regress.cue.wav" le -120
row regress inputfx_vs_fixed gate_regress "$OUT/gate_regress.inputfx.wav" "$OUT/gate.inputfx.wav" ge -40

for t in record inputfx cue; do
  render sustgate0 "$t" set=SUSTAINGATE:0.0
done
row observe sustgate0.record_vs_inputfx sustgate0 "$OUT/sustgate0.record.wav" "$OUT/sustgate0.inputfx.wav" le 0
row observe sustgate0.record_vs_cue sustgate0 "$OUT/sustgate0.record.wav" "$OUT/sustgate0.cue.wav" le 0
row observe sustgate0.inputfx_vs_silence sustgate0 "$OUT/sustgate0.inputfx.wav" "$OUT/neutral.inputfx.wav" ge -30

python3 tools/chain-render/parity.py "$MAN"
