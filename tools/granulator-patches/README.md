# granulator-patches

Renders a held C major triad through `aloop::Sampler` for each granulator
patch in `patches.tsv` and writes `granulator-patches.tsv`. It runs as the
CI job `granulator-patches` (`.github/workflows/granulator-patches.yml`).
Nothing here runs on a device and nothing sends MIDI.

usage: `render_patches <patches.tsv> <out.tsv>`

## Pre-registered thresholds

These are the thresholds on row `granulator-patch-render-ci`, set before the
first CI run.

- Metrics per patch: grain rate (Hz) is the peaks per second of the 10 ms RMS
  envelope above its mean; envelope mean and std (dB) over 10 ms RMS windows;
  spectral centroid mean and coefficient of variation over 16384-sample Hann
  windows.
- Two patches are distinguishable if at least one holds: the grain rate
  differs by at least 20% of the larger; the envelope mean differs by at least
  2.0 dB; the centroid mean differs by at least 300 Hz.
- Freeze (static spectrum): centroid CV below 0.05 and envelope std below 1.0 dB.
- Tape: distinguishable from each of the other patches by the rule above.
- A patch set passes only if every pair is distinguishable and the Freeze and
  Tape rows are present.

## Failure rules

Exit 1, with no figure written, on a missing Freeze or Tape row, a NaN, or an
empty figure. A failed distinguishability verdict is written to the TSV as
`VERDICT FAIL` and exits 0.
