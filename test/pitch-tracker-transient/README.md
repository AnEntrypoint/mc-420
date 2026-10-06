# pitch-tracker-transient

Two render backends, chosen by whether the DSP can be JIT-compiled:

| job | backend | scripts |
| --- | --- | --- |
| `multitranspose-engine` | `dsp_cli` (committed Faust codegen, `g++` only, no faust/dawdreamer install) | the 5 `multitranspose.dsp` checks |
| `pitchtracker-faust-jit` | DawDreamer `FaustProcessor` | `verify_ac_tracker_steadystate_bias.py`, `diag_isolate_floor.py`, `diag_trace_main_loop.py` |

DawDreamer's `FaustProcessor` refuses `ffunction`-declared externals and cannot resolve
`component("pitch_poly.dsp")`, so `multitranspose.dsp` never compiled under it. Those five
scripts therefore had no working baseline for as long as the workflow existed (`test-pitch-tracker`
was red 13 runs straight). They now render through `dsp_cli`, which embeds the shipping
`AloopEffectDsp` codegen and resolves the `ffunction` externs at ordinary link time — the real
engine, not a model of it.

## `dsp_cli_engine.py`

Writes each of `multitranspose.dsp`'s 17 input channels to a float32 WAV, shells out to
`dsp_cli --genN wav:<file> ... out.wav`, and reads the 16-bit PCM output back as float.

- Channels 5+ carry MIDI note values (~60) and gate 0/1. These must be float32, never int32:
  an int32 write clips them and the voice never engages.
- Identical channels are deduped by content hash, so a run writes fewer WAVs than it has channels.
- Channels that are all-zero are skipped, and `--gen0 silence:<secs>` is substituted when nothing
  at all would be written.
- Locate the binary with `DSP_CLI=<path>`; otherwise it probes `dsp_cli`, `dsp_cli.exe`,
  `tools/dsp-cli/dsp_cli.exe`, `tools/dsp-cli/dsp_cli`.
- `dsp_cli.exe` must be rebuilt whenever `tools/dsp-cli/dsp_generated.cpp` changes. CI always
  rebuilds from source; a stale host binary silently renders the old engine.

## Findings that shaped the gates

**`extFreqDet=0` does not lock in-test.** Channel 4 is the external frequency-detect input; 0
selects the internal zero-crossing tracker, which does not converge inside these windows, so the
voice stays unshifted and the reported error equals the entire requested shift. Every script now
feeds the true input frequency on channel 4, which is what the on-device path supplies. Chord
worst-case went 246c to 3.9c and voice-as-bass 0/6 to 6/6 with no other change.

**`measure_freq` needs >= 6 periods.** The old window was `max(256, 3*sr/f)`; during the attack
ramp a 3-period window is not stationary and the NCC picks a wrong lag — a 196 Hz tone measured
291.17 Hz with a 734-sample window and 196.00 Hz with 4096. All windows agree from t+30ms.
Every script now uses `max(512, 6*sr/min(freq, expected))`.

## Octave stability under a timbre shift (gated)

`verify_ac_tracker_timbre_shift.py` drives a sustained note's 2nd harmonic from 0.3 to 1.0 while
its fundamental falls 1.0 -> 0.05 across 0.2s-3.0s, and gates every 200ms window past 0.10s at
100c. Before the fix this read +1200c at 110/220/440Hz, the tracker following the loudest
component; it now reads 3.5c / 0.1c / 0.4c.

Three rules fall out of it, all easy to re-break. The demote test must use the parabolic vertex
(`corrPeakAt`) while the 2x/3x promotion stays on raw rounded-to-nearest lags: peak values erase
the integer-lag penalty that separates a 349 Hz pick from 1047 Hz, measured as -1896c at 1046.5Hz.
A demotion must suppress the promotion outright (`notDemoted`), because after a demotion the 2x
candidate IS the original pick and at 110Hz the raw estimates ripple +-0.019 against a mean gap of
0.0047, so the promotion re-fired on 21% of samples and pulled the window mean from 110Hz to
133Hz. And the demote releases slowly (`demoteTau = 0.2`, duty > 0.5) for the same reason: at
110Hz that ripple is 4-8x the evidence it carries, so an instantaneous comparison flickers between
octaves many times per 200ms window.

A fourth rule is about where that damper lives, and is the easiest one to break by accident: it holds
the **already-refined** frequency (`holdStep` in `detectedFreq`), never `subharmonicPromote`'s own
`baseFreq`. `baseFreq` drives `corrRawAt`'s and `refineFreq`'s delay-line indices, and a signal
reaching an index feeds straight into the one Faust cost that is not linear in the source: the
shipped file needs 213.1s of codegen and ~0.9GB RSS on `ubuntu-24.04-arm`, past faust's own default
120s `-t` alarm (hence `-t 600` in `build-lv2.yml`, which is what makes the difference between
`rc=142` and `rc=0`). Every tap index in the shipped file is a function of `coarseFreq` alone, and
that is measurably worth keeping: muxing the selected frequency and calling `refineFreq` once
instead of four times is value-identical and cut 12 taps to 3, yet still blew the alarm, while a
variant whose whole process line is the bare `detectedFreq` probe compiled in 100-105s. No flag is
responsible -- all seven shipped flag sets time out identically, no flags included. The same cost is
why `demoteTest` runs once in `detectedFreq` and its result is passed into `subharmonicPromote`
rather than being called from both sites: a second call duplicates every `corrPeakAt` pair.

## `model_ac_tracker.py`

A pure-numpy model of the whole `pitchtracker_ac.dsp` chain -- the 37-candidate grid, the peak and
raw correlation estimators, demote, promote and refine. It reproduces the CI baseline exactly, so
both batteries can be iterated locally in seconds instead of a ~5 minute CI round trip: `python
model_ac_tracker.py` runs them against the settings the `.dsp` currently ships. `raw` reproduces
the pre-fix behaviour; `mixed`, `smooth`, `latch` select other demote/promote estimator
combinations; `ceil=`, `m=`, `dtau=`, `rel=` and `excl` override individual constants.

**A full-scale 15 ms noise burst genuinely disturbs the splice crossfade for ~15 ms.** Measured
77c at t+20ms and 0.0c at t+30ms, with the wider window confirming the settled pitch is exact.
The plosive gate therefore covers the settled pitch only — `SETTLED_AFTER_BURST_MS = 30` — and
prints the pre-settled offsets tagged `(splice)` rather than gating them. A regression that
reintroduced continuous mid-sustain re-tracking would move the settled pitch and still fail.
