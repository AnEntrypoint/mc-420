# Corpus pitch reference

Measured peaks for the files the pitch gate uses. A filename-derived note is NOT evidence of a
file's pitch; measure before using one as a target.

## Method

48 kHz mono wav, 16384-sample Goertzel windows, non-overlapping, first 6 s, power summed across
windows, peak picked on a log-spaced grid from 40 Hz to 4000 Hz at 0.5 percent steps (about 8.6 c
resolution). Sub-multiple test: if the power at peak/2, peak/3 or peak/4 is within 12 dB of the
peak, the lower frequency is taken instead. `h2` and `h3` are the second and third harmonic margins
in dB below the chosen peak - a large negative margin means the peak really is the fundamental.

Witness: `.gm/witness/corpus-pitch-reference.txt`. Cross-checked against an independent
power-averaged FFT with Hann windows at 50 percent overlap and parabolic interpolation (the two
agree: sax 1049.1 here vs 1051.5 there, marimba C5 559.6 vs 558.9, cello 111.8 vs 111.6).

## Reliable - peak is the fundamental

| file | filename note | measured peak | vs label | h2 | h3 |
|---|---|---|---|---|---|
| piano_mid_C4 | C4 261.63 | 262.22 | +3.9 c | -6.7 | -22.0 |
| marimba_low_C2B2 | C2 65.41 | 65.21 | -5.2 c | -37.0 | -40.6 |
| cello_low_sulC_A2 | A2 110.00 | 111.76 | +27.4 c | -2.4 | -8.7 |
| trumpet_high_C6 | C6 1046.50 | 1049.13 | +4.3 c | -7.3 | -11.5 |
| soprano_sax_high_C6 | C6 1046.50 | 1049.13 | +4.3 c | -16.7 | -25.4 |
| clarinet_high_C6B6 | C6 1046.50 | 1049.13 | +4.3 c | -22.9 | -17.5 |
| vibraphone_mid_C5B5 | C5 523.25 | 527.13 | +12.8 c | -28.5 | -39.0 | PHRASE, see below |
| marimba_mid_C5B5 | C5 523.25 | 559.64 | +116.4 c | -42.1 | -39.9 |

`cello_low_sulC_A2` and `marimba_mid_C5B5` sit 27 c and 116 c above their labels, so scoring those
files against the filename note charges the tracker for reference error it did not make. The C6
files and `piano_mid_C4` are within about 5 c and can be scored against the label.

`marimba_mid_C5B5` is a PHRASE, not one note: four struck notes separated by about 46 dB of
silence, rising chromatically. Measured here with 0.25 s Goertzel windows over all 10 s:

| note | onset | sustained peak | vs previous note |
|---|---|---|---|
| 528.3 Hz | 0.25 s | 0.144 rms | - |
| 558.9 Hz | 3.23 s | 0.180 rms | +99.6 c |
| 590.4 Hz | 5.75 s | 0.051 rms | +95.4 c |
| 628.8 Hz | 8.50 s | 0.129 rms | +109.3 c |

Its 559.64 entry above is the dominant pitch of that run, which happens to be the second note, so
it is still a real fundamental - but a gate that holds one key across the run and reports a single
whole-segment estimate is measuring the run, not a pitch. Against 558.94 the tracker reads -1.1 c
(median over voiced windows, `.gm/witness/marimba-c5b5-detector-pick-and-lag.txt`), while the same
6 s hold reports 548.43 Hz, +81.4 c against the 523.25 label. Score this file per note, or not at
all.

## Not reliable - do not score against the filename label

The measured peak is a partial or phrase content, or the harmonic margin is too weak to call it the
fundamental. Each needs a better measurement before it is used as a ground-truth target.

| file | measured peak | vs label | why it is not reliable |
|---|---|---|---|
| bassoon_low_C2B2 | 486.70 | +3474.5 c | peak is a high partial; the comb certifies 69.68, see below |
| tuba_run_C2B2 | 496.50 | +3509.1 c | `_run_` is a phrase, and 496.5 is not its fundamental |
| trumpet_low_A3 | 1091.84 | +2773.4 c | about 5x the label; the comb certifies 218.35, see below |
| violin_low_sulG_G3B3 | 394.71 | +1211.9 c | about 2x the label; the comb certifies 196.64, see below |
| oboe_mid_C5B5 | 556.85 | +107.8 c | two pitch centres measured, 527.35 and 557.67, so no single target |

Files whose names contain `_run_` or `_scale_` are phrases rather than single notes, and a
highest-average-power method reports a dominant pitch for them, not the note a gate asks about.
A `<note><octave><note2><octave2>` range name is not proof of a single note either:
`marimba_mid_C5B5` carries that shape and is a four-note run (see the note above), so measure any
range-named file before using it as a single-note target.
`vibraphone_mid_C5B5` had only 3 voiced windows here, so treat it as usable but soft.

`tools/pitch-reference/submultiple.mjs` runs the same method as this file (16384-sample non-overlapping
Goertzel windows, power summed, log grid 40-4000 Hz at 0.5 percent steps) with the sub-multiple test
extended from /2../4 to /2../8, and prints the harmonic ladder at whatever it finds. On
`trumpet_low_A3` it reproduces the 1091.84 Hz peak exactly. The only sub-multiple landing in
200-240 Hz is peak/5 = 218.368 Hz, and its local maximum is 218.40 Hz at 19.1 dB below the peak,
which is outside the 12 dB margin above, so this file stays excluded. The exclusion is a limitation
of the margin, not evidence against the fundamental: the ladder at 218.40 Hz is complete and
brass-shaped, H1 -60.1, H2 -47.9, H3 -47.5, H4 -42.3, H5 -41.2, H6 -40.0, H7 -42.9, H8 -45.7 dB,
with H6 the strongest and H1 the weakest, and no partial below the band floor plus 12 dB. So the
true fundamental is 218.40 Hz (-12.9 c against the A3 label) and a method that tests the whole
harmonic series instead of the peak's own level would certify it. Witness:
`.gm/witness/trumpet-a3-extended-submultiple.txt`.

`bassoon_low_C2B2`, `violin_low_sulG_G3B3` and `oboe_mid_C5B5` are the same failure class - a
partial or a harmonic tie beating the fundamental - so a whole-series test would likely move them
too. Until it exists, 8 of 34 files are scoreable and the gate measures what the reference can
certify, not what the tracker can hear.

## Comb certification (archive#corpus-comb-certification)

`tools/pitch-reference/comb.mjs` scores every candidate f0 on a log grid by the power summed at
k*f0 for k = 1..8, penalised 12 dB per partial that falls below the spectrum median plus 12 dB, and
takes the LOWEST candidate within 3 dB of the best score. Lowest-wins is what makes it a comb and
not a peak finder. A candidate with no energy at its own f0 is rejected outright: that one rule is
what kills the sub-octave candidates, which otherwise score almost as well as the true fundamental
because their even multiples land on the real harmonics.

Run: `node tools/pitch-reference/comb.mjs --phrase marimba_mid_C5B5,vibraphone_mid_C5B5`, witness
`.gm/witness/corpus-comb-certification.txt`.

Against the Reliable table it reproduces 7 of 7 non-phrase entries within 6.2 c (piano 262.61 vs
262.22, marimba_low 65.31 vs 65.21, cello 111.36 vs 111.76, trumpet_high 1045.45 vs 1049.13,
soprano_sax 1050.68 vs 1049.13, clarinet 1045.45 vs 1049.13, marimba_mid 557.67 vs 559.64).

Newly certified, each with no missing partial and a strong fundamental:

| file | comb f0 | vs filename label | note |
|---|---|---|---|
| bassoon_low_C2B2 | 69.68 | +108 c vs C2 | ladder H1 58.1 .. H7 73.8 dB against a 3.4 dB floor; the label is not the note |
| violin_low_sulG_G3B3 | 196.64 | +5.6 c vs G3 | the 394.71 peak is its 2nd harmonic |
| trumpet_low_A3 | 218.35 | -13.0 c vs A3 | -0.4 c against the Goertzel sub-multiple value of 218.40 |
| guitar_pluck_C4B4 | 294.53 | +5.1 c vs D4 | single struck note, confirmed by segmentation |

`oboe_mid_C5B5` and `piano_low_A1` pass the comb rule but are NOT adopted: oboe carries two
complete ladders a semitone apart (527.35 and 557.67, comb sums 42.7 and 51.6 dB), so a single
target would be a coin flip, and piano_low_A1's 96.37 is dissonant with its own 275.02 peak.
`vocal_female_vibrato` and `vocal_tenor_operatic_PD` pass too, but segmentation shows both move
through several pitches, so one f0 is meaningless for them.

`vibraphone_mid_C5B5` is a PHRASE, not one note: a four-note run, the same shape as
`marimba_mid_C5B5`, with struck notes at 527.3 / 559.6 / 591.8 / 627.0 Hz at 0.34 / 3.07 / 5.80 /
8.87 s, each about +100 c above the previous, separated by roughly 46 dB of silence (rms 0.034
against 0.0005). Its 527.13 entry above is the first note of that run, which is why the reference
called it soft. Score it per note or not at all; the metric measures it and does not gate it.

Scoreable set: 10 files (6 of the previous 8 reliable entries, since vibraphone and marimba_mid are
phrases, plus the 4 above). The gate had been counting 8 and 2 of those were phrase artifacts, so
the real change is 6 to 10.

## Rule

A gate that scores pitch against a target note must either use a measured peak from this table, or
record the measurement it used with the run. Do not take the note from the filename.

## Scope of a settled metric (marimba_low_C2B2)

The peak above is measured over the first 6 s. The settled metric in `tools/pitchtracker-render/render_corpus.py` (`SETTLE_S = 1.0`) scores every voiced block from 1.0 s to the end of the file, so the two windows disagree for this file. The 6-10 s tail is quiet (rms -36 dBFS) and its dominant periodicity is 69.6-69.8 Hz: the Goertzel peak over 6-10 s is 69.58 Hz with 65.21 Hz 12.9 dB below it, and the normalised autocorrelation of the raw file reaches r >= 0.998 at lags 677-691 over 6.5-9.5 s. In the same CI trace the 1.0-3.6 s sustain settles at 65.526 Hz (+8.4 c). The settled value of 69.767 Hz (+116.95 c) comes from the tail: 47.5 percent of the 6-10 s voiced blocks sit at exactly that value.

Witness: dispatch 1792922745694-3069-404da0200617f3 (session verify-defect-marimba-c2-offline-plus117c), over CI run 40178097047 traces and the corpus wav. 69.77 / 65.21 is not an integer or simple ratio, so the offset is not an octave or harmonic lock. A settled metric must score the window its reference covers, or the reference must be measured over the scored window. Choosing between them is an owner decision (decision-marimba-c2-metric-window).
