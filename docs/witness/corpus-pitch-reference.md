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

## Not reliable - do not score against the filename label

The measured peak is a partial or phrase content, or the harmonic margin is too weak to call it the
fundamental. Each needs a better measurement before it is used as a ground-truth target.

| file | measured peak | vs label | why it is not reliable |
|---|---|---|---|
| bassoon_low_C2B2 | 486.70 | +3474.5 c | peak is a high partial, not the C2 fundamental |
| tuba_run_C2B2 | 496.50 | +3509.1 c | `_run_` is a phrase, and 496.5 is not its fundamental |
| trumpet_low_A3 | 1091.84 | +2773.4 c | about 5x the label; a partial |
| violin_low_sulG_G3B3 | 394.71 | +1211.9 c | about 2x the label; second harmonic dominating |
| oboe_mid_C5B5 | 556.85 | +107.8 c | h2 is +0.2 dB, so fundamental and 2nd harmonic tie |

Files whose names contain `_run_` or `_scale_` are phrases rather than single notes, and a
highest-average-power method reports a dominant pitch for them, not the note a gate asks about.
`vibraphone_mid_C5B5` had only 3 voiced windows here, so treat it as usable but soft.

## Rule

A gate that scores pitch against a target note must either use a measured peak from this table, or
record the measurement it used with the run. Do not take the note from the filename.
