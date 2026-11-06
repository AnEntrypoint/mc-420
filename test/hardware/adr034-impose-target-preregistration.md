# ADR-034 impose-target telemetry: pre-registration BEFORE the hardware re-run

Owner decision 2026-11-06 (orchestrator-86): option (a), publish a real sample-domain press-minus-L target. Do not reword the hardware witness and do not lower acceptance. Minimal change: move the publish of `imposeTargetSamples` out of the dead branch so it is set when the master is created, leaving the impose logic untouched.

## Formula check, already done and witnessed

ADR-034 line, verbatim from docs/DECISIONS.md:724:

> Decision: when the first loop is created with length L beats, the Link beat origin is imposed at (record press - L), so the phrase turnaround is one loop before the press. The loop grid origin (DSP phase 0) stays at the press.

Also docs/DECISIONS.md:727 `requestPhaseImpose at press minus loopMicros, loopMicros = masterLen / sampleRate`, AGENTS.md:9 `the Link beat origin is imposed at press minus L beats`. L is in beats; one whole loop in samples is `masterLenSamples = recordedBeatsShared * beatLenSamplesShared` (src/dsp/audio_thread.cpp:886-888), so press minus L beats = `lastTakeArmSample - masterLen`. `lastTakeArmSample` is src/dsp/audio_thread.h:99, the audio sample count at the ARM press. They MATCH. Full witness .gm/witness-out/adr034-formula-check-20261106.txt.

## Precondition established by the offline hunt

gm.grep located the writers: src/dsp/audio_thread.h:112 (default -1.0), src/dsp/audio_thread.cpp:920 (reset to -1.0 in the master-creation branch), src/dsp/audio_thread.cpp:961 (only non-reset writer), src/control/telemetry.cpp:139 and :167 (format and argument). Line 961 is unreachable: it is nested under `!awaitingImposeRebase`, but the creation branch sets `awaitingImposeRebase = true` and clears it only one controlTick (200 ms) later, when `masterJustCreated` is already false. Hardware: `impose_target_samples = -1` in all nine UDP 4445 samples of both item 1 runs while `link_target_samples` and `impose_audio_samples` are published. Full witness .gm/witness-out/adr034-impose-target-pathline-20261106.txt.

## The change (telemetry only)

In the `if (masterJustCreated)` branch of src/dsp/audio_thread.cpp, replace `g_telem.imposeTargetSamples = -1.0;` with `g_telem.imposeTargetSamples = (double)lastTakeArmSample - (double)masterLen;`. Delete the unreachable `if (masterJustCreated) g_telem.imposeTargetSamples = linkTargetSamples;` at line 961. `requestPhaseImpose(0.0, pressMicros - loopMicros, (double)recordedBeatsShared)` and all impose logic stay byte-identical. No audio-path change, no ALSA change, no blocking work, so the ~7 ms end-to-end invariant cannot grow. The header default of -1.0 stays as the not-yet-created sentinel.

## Pass gate for the hardware re-run, fixed now

Run in its OWN quiet Pi window with START and END markers to esp, after the ADR-034 commit is CI green and hot-deployed:

`node test/hardware/verify-clear-reset-first-take.js 192.168.137.132 1250`

- `sample_clock.impose_target_samples` must be published (> 0) for BOTH the boot-first take and the post-clear first take.
- For each take `|impose_target_samples - (last_take_arm_sample - master_len_samples)| <= 4096` samples.
- `xruns` flat against the pre-deploy baseline and `latency_bias_samples` / `alsa_roundtrip_samples` within 16 samples of baseline. If either regresses, stop, revert the deployed commit and re-witness.
- All other pre-registered R1-R6 rules unchanged. A FAIL is a FAIL; no threshold is lowered after results and no rule is reinterpreted.

Precondition deviations from a prior run (a CLEAR_ALL needed to restore the empty state) must be recorded in the witness, as orchestrator-86 required for the corrected gate run.

The original item 1 `ITEM1_EXIT=1 / SOME FAILED` and the corrected-gate `CORRECTED_EXIT=0 / ALL PASS` both stay on record unchanged.

ADDENDUM 2026-11-06, written BEFORE any ADR-034 hardware re-run: command clarification, no threshold or acceptance change.
The command above must be run as `node test/hardware/verify-clear-reset-first-take.js 192.168.137.132 1250 corrected`. The fourth argument selects the corrected gate. The default `original` gate still contains R3-cleared-wlen, which is the KNOWN MIS-SPECIFIED rule that failed in the item 1 run (loopers.wraplen[0] is intentionally stale after clear; AGENTS.md records m_looperWrapLenStaleAfterWipe). Using the default gate would make the run exit 1 for a reason unrelated to ADR-034 and would obscure the impose-target verdict. The `corrected` gate replaces that one rule with the nine device-owned control-state rules already pre-registered and committed at 4da2ebcc, leaving R1, R2, R4, R5 and R6 byte-identical. Every ADR-034 pass condition, the 4096-sample tolerance, the xruns/latency tolerances and the revert rule above are UNCHANGED. The ADR034 NOT_PUBLISHED / WITHIN_TOLERANCE / OUTSIDE_TOLERANCE observation lines are printed by both gates.
Precondition rule carried over from the corrected-gate run: if the device is not empty at the start, a CLEAR_ALL sent to restore the empty state must be recorded as a precondition deviation in the witness with the telemetry that justified it, and the run must not be described as a clean run of the registered sequence.
