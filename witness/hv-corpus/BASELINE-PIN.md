# Baseline pin

The committed baseline renders in this directory (`base__*.txt`,
`sine_*.base.txt`, and the matching set under
`docs/witness/pitch-ceiling/`) are anchored to

```
pitchtracker_ac.dsp sha256 3f0184ab36e8bb243fdaa9a325736175b1a64f54dbd93719baa658af2cb6bef3
```

That anchor is deliberate and is not silently refreshed when the tracker
on `main` moves. The tracker on `main` has since changed (it is
`8c4e78f84f84344d4a4861d510eb887879f759536c35f6b7633e21ef6f48ab78` at
the time of writing), and these renders are still the `3f0184ab` ones.

## Why the pin is not refreshed

The ceiling-dedup rules R1-R4 are pre-registered against the
`3f0184ab` baseline, and the candidate they rejected was judged under
that pre-registration. Re-rendering the baseline now and re-running the
comparison would re-judge an already-rejected candidate against a
tracker it was never registered against. That is post-hoc
goalpost-moving, the same failure this project already recorded for
`granulator-freeze-static-metric-v2`, whose metric was chosen after its
percentiles were seen.

## What follows from the pin

- Any **new** tracker candidate must pre-register against the **current**
  tracker, with a fresh baseline render. This pin does not license
  reusing these numbers for a new candidate.
- The `ceiling-dedup` workflow compares the live tracker hash against
  this anchor. On mismatch it writes a `STALE BASELINE` row instead of a
  verdict and issues no clean verdict, so a stale baseline can never be
  read as a fresh measurement.
- The hold-variant traces under `docs/witness/hv-floor/` come from the
  same `3f0184ab` era and are covered by the same pin.
