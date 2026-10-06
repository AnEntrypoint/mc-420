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

**A full-scale 15 ms noise burst genuinely disturbs the splice crossfade for ~15 ms.** Measured
77c at t+20ms and 0.0c at t+30ms, with the wider window confirming the settled pitch is exact.
The plosive gate therefore covers the settled pitch only — `SETTLED_AFTER_BURST_MS = 30` — and
prints the pre-settled offsets tagged `(splice)` rather than gating them. A regression that
reintroduced continuous mid-sustain re-tracking would move the settled pitch and still fail.
