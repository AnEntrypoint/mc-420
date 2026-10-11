#!/bin/sh
set -e
cd "$(dirname "$0")/../.."

OUT=build/chain-render
mkdir -p "$OUT"

F="-vec -fun -dfs -vs 32 -nvi -ct 0"
I="-I . -I dsp -I effects/home/faust -I tools/chain-render"

faust $F -lang cpp -cn AloopPreDsp   $I dsp/aloop_pre.dsp                       -o "$OUT/gen_pre.cpp"
faust $F -lang cpp -cn AloopPreBypassDsp $I tools/chain-render/aloop_pre_bypass.dsp -o "$OUT/gen_pre_bypass.cpp"
faust $F -lang cpp -cn AloopPreCleanDsp  $I tools/chain-render/aloop_pre_clean.dsp  -o "$OUT/gen_pre_clean.cpp"
faust $F -lang cpp -cn AloopPostDsp  $I dsp/aloop_post.dsp                      -o "$OUT/gen_post.cpp"

awk '
/^[[:space:]]*inputFxOut[[:space:]]*=/ { n++; print "    inputFxOut = masterWet + loopHarmonyWet;"; next }
{ print }
END { if (n != 1) { printf("gen.sh: regress patch matched %d times, want 1\n", n) > "/dev/stderr"; exit 1 } }
' dsp/effects_runtime_post.dsp > "$OUT/effects_runtime_post_regress.dsp"
sed 's/effects_runtime_post\.dsp/effects_runtime_post_regress.dsp/' dsp/aloop_post.dsp > "$OUT/aloop_post_regress.dsp"
faust $F -lang cpp -cn AloopPostRegressDsp $I -I "$OUT" "$OUT/aloop_post_regress.dsp" -o "$OUT/gen_post_regress.cpp"
differ=$(diff dsp/effects_runtime_post.dsp "$OUT/effects_runtime_post_regress.dsp" | grep -c '^[<>]' || true)
if [ "$differ" != "2" ]; then
  echo "gen.sh: regress patch changed $differ lines, want 2" >&2
  exit 1
fi
faust $F -lang cpp -cn GuitarLofiFx  $I effects/home/faust/guitar_lofi_fx.dsp   -o "$OUT/gen_lfx.cpp"
faust $F -lang cpp -cn LfxNoBitcrush $I tools/chain-render/lfx_nobitcrush.dsp   -o "$OUT/gen_lfx_nobc.cpp"
faust $F -lang cpp -cn StageBitcrush $I effects/home/faust/bitcrush.dsp         -o "$OUT/gen_bitcrush.cpp"
faust $F -lang cpp -cn StageFlanger  $I effects/home/faust/flanger.dsp          -o "$OUT/gen_flanger.cpp"
faust $F -lang cpp -cn StageTremolo  $I effects/home/faust/tremolo.dsp          -o "$OUT/gen_tremolo.cpp"
faust $F -lang cpp -cn StagePhaser   $I effects/home/faust/phaser.dsp           -o "$OUT/gen_phaser.cpp"
faust $F -lang cpp -cn StageDistortion $I effects/home/faust/distortion.dsp     -o "$OUT/gen_distortion.cpp"
faust $F -lang cpp -cn StageVinyl    $I effects/home/faust/vinyl.dsp            -o "$OUT/gen_vinyl.cpp"
faust $F -lang cpp -cn StageFlutter  $I effects/home/faust/flutter.dsp          -o "$OUT/gen_flutter.cpp"

wc -l "$OUT"/gen_*.cpp
