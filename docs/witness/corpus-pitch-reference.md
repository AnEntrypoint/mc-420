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
| vibraphone_mid_C5B5 | C5 523.25 | 527.13 | +12.8 c | -28.5 | -39.0 |
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
| bassoon_low_C2B2 | 486.70 | +3474.5 c | peak is a high partial, not the C2 fundamental |
| tuba_run_C2B2 | 496.50 | +3509.1 c | `_run_` is a phrase, and 496.5 is not its fundamental |
| trumpet_low_A3 | 1091.84 | +2773.4 c | about 5x the label; a partial; extended test finds the fundamental at 218.40 but it fails the 12 dB margin, see below |
| violin_low_sulG_G3B3 | 394.71 | +1211.9 c | about 2x the label; second harmonic dominating |
| oboe_mid_C5B5 | 556.85 | +107.8 c | h2 is +0.2 dB, so fundamental and 2nd harmonic tie |

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

## Rule

A gate that scores pitch against a target note must either use a measured peak from this table, or
record the measurement it used with the run. Do not take the note from the filename.
