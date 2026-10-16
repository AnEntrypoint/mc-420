# upshift-fold-map

Measures whether upward-transpose fold-back aliasing in the SOLA/SNAC free-transpose
engine is predictable from the source's own spectrum.

The engine's resample reader is a fixed 16-tap Hann-windowed sinc
(`effects/home/faust/soladSnacOctaver.h:250-251` sizes, table built at `:386-405`,
consumed by `readSinc` at `:406-421`, called from `:187-188`, `:438-439`, `:448-449`,
`:496-497`, `:508-509`). The kernel's cutoff is a constant — it is built once from
`SINC_TAPS` alone and carries no dependence on the read stride. An upshift reads at
stride `s = 2^(semis/12)`, so content above `fs/(2s)` is read past the kernel's
stopband and folds back.

## Usage

    g++ -O2 -std=c++17 -I effects/home/faust -o /tmp/dsp_cli tools/dsp-cli/dsp_cli.cpp -lm -lpthread
    python3 -I tools/upshift-fold-map/fold_map.py \
      --dsp-cli /tmp/dsp_cli --corpus test-audio-corpus/instruments \
      --out /tmp/upshift-sweep/out --json /tmp/upshift-sweep/result.json

Pure stdlib. No numpy. The FFT is a radix-2 Cooley-Tukey over Hann-windowed 4096-sample
frames at 50% overlap; out-of-band fraction is the summed bin power above `fs/(2s)`
divided by total bin power, with partial-bin interpolation at the cutoff.
`--skip-render` reuses wavs already in `--out`.

`dsp_cli --glitch-check` exits 1 whenever it finds at least one glitch, so the count is
read from stdout regardless of exit status.

## Measured result: out-of-band energy is NOT a predictor

16 corpus sources x +0/+12/+19/+24/+36, `normrms=0.21`, `threshold=0.25`, `minGapMs=5`.
Measured against `dsp_cli` built from HEAD `46476a8` plus the working-tree
`soladSnacOctaver.h` octave-hysteresis change; a re-run after that change moved a
handful of cells by a few counts (clarinet +12 32->35, trumpet_high +12 21->30,
piano_low +36 54->60) and left the verdict identical.

### Glitch count

| source | +0 | +12 | +19 | +24 | +36 |
|---|---|---|---|---|---|
| bassoon_low_C2B2 | 0 | 0 | 0 | 61 | 24 |
| cello_low_sulC_A2 | 0 | 0 | 0 | 0 | 19 |
| clarinet_high_C6B6 | 0 | 35 | 13 | 7 | 2 |
| marimba_low_C2B2 | 2 | 8 | 9 | 7 | 6 |
| marimba_mid_C5B5 | 4 | 6 | 7 | 5 | 16 |
| oboe_mid_C5B5 | 0 | 24 | 7 | 4 | 5 |
| piano_high_C7 | 2 | 10 | 7 | 3 | 4 |
| piano_low_A1 | 2 | 20 | 27 | 25 | 60 |
| piano_mid_C4 | 1 | 3 | 5 | 1 | 13 |
| trumpet_high_C6 | 0 | 30 | 4 | 3 | 2 |
| trumpet_low_A3 | 0 | 5 | 2 | 1 | 1 |
| vibraphone_mid_C5B5 | 4 | 11 | 9 | 8 | 14 |
| violin_high_sulE_C7E7 | 4 | 9 | 5 | 5 | 11 |
| violin_low_sulG_G3B3 | 0 | 23 | 12 | 12 | 2 |
| vocal_female_vibrato | 0 | 18 | 36 | 47 | 31 |
| vocal_male_baritone_scale | 0 | 0 | 0 | 0 | 30 |

### Out-of-band energy fraction above fs/(2s)

| source | >24.0k | >12.0k | >8.0k | >6.0k | >3.0k |
|---|---|---|---|---|---|
| bassoon_low_C2B2 | 0.0000 | 0.0000 | 0.0001 | 0.0003 | 0.0004 |
| cello_low_sulC_A2 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0002 |
| clarinet_high_C6B6 | 0.0000 | 0.0001 | 0.0003 | 0.0006 | 0.0283 |
| marimba_low_C2B2 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| marimba_mid_C5B5 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0001 |
| oboe_mid_C5B5 | 0.0000 | 0.0001 | 0.0001 | 0.0004 | 0.0554 |
| piano_high_C7 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0015 |
| piano_low_A1 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 |
| piano_mid_C4 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0009 |
| trumpet_high_C6 | 0.0000 | 0.0000 | 0.0002 | 0.0013 | 0.0864 |
| trumpet_low_A3 | 0.0000 | 0.0000 | 0.0000 | 0.0001 | 0.0154 |
| vibraphone_mid_C5B5 | 0.0000 | 0.0001 | 0.0001 | 0.0001 | 0.0007 |
| violin_high_sulE_C7E7 | 0.0000 | 0.0029 | 0.0056 | 0.0691 | 0.2636 |
| violin_low_sulG_G3B3 | 0.0000 | 0.0000 | 0.0000 | 0.0002 | 0.0078 |
| vocal_female_vibrato | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0020 |
| vocal_male_baritone_scale | 0.0000 | 0.0000 | 0.0001 | 0.0007 | 0.0014 |

### Correlation

| column | r(glitches, oob) | r(gl - gl(+0), oob) | r(glitches, peakStep) |
|---|---|---|---|
| +0 | -0.1414 | n/a | +0.0728 |
| +12 | -0.0561 | -0.15 | +0.09 |
| +19 | -0.1199 | -0.19 | +0.44 |
| +24 | -0.1058 | -0.15 | +0.45 |
| +36 | -0.2155 | -0.25 | +0.18 |
| pooled (n=80) | **-0.0418** | | |

Every coefficient is negative. The predictor fails in both directions:

- `marimba_low_C2B2` has the least out-of-band energy in the corpus (0.0000 at every
  cutoff) and glitches at every setting, including +0.
- `violin_high_sulE_C7E7` has the most (0.2636 above 3 kHz, 3x the next source
  `trumpet_high_C6` at 0.0864) and sits mid-pack.
- `vocal_female_vibrato` has almost none above 3 kHz (0.0020) and is the worst at +24.

Two further observations kill the fold-back hypothesis as the driver of this metric:

1. **Glitches at +0 are non-zero for 7 of 16 sources.** At `s = 1` no content is out of
   band and fold-back is impossible by construction, so whatever `--glitch-check`
   threshold 0.25 is firing on is not upshift aliasing.
2. **Glitch count is not monotone in stride.** clarinet runs 35/13/7/2, trumpet_high
   runs 30/4/3/2, violin_low runs 23/12/12/2 — decreasing as more of the spectrum goes
   out of band. Column means are 1.19 / 12.63 / 8.94 / 11.81 / 15.00, non-monotone.

The only positive association is with `peakStep` (r up to +0.45 at +19/+24), i.e. the
metric tracks splice step size, which is dominated by the source's own transient
content and by where splices land, not by spectral fold-back.

## Consequence

No predictor rule is shipped as engine behaviour, because the measurement does not
support one. The two previously rejected fixes stay rejected (stride-adaptive kernel
made +24 worse, 32 vs 27; write-side anti-alias adds ~3 samples of latency).

This tool does not touch the audio path. It only reads corpus wavs and drives
`dsp_cli`; it changes no output sample and adds no latency.

Witness: all 80 renders of the 16 measured sources were produced before the commit
and again after it with the same `dsp_cli` binary, then md5-compared — 80 of 80
byte-identical, 0 different.

## Corpus note

Measured when `test-audio-corpus/instruments` held 16 wavs; it has since grown to 34.
The tool takes whatever `--corpus` contains, so re-running covers all of them.
