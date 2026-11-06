# Corrected clear-reset gate, pre-registered BEFORE any re-run

Owner decision 2026-11-06: the item 1 FAIL on R3-cleared-wlen stands as recorded; do not lower the threshold or reinterpret it. Write the corrected gate as a separately pre-registered follow-up and COMMIT it before any re-run.

Original run: `node test/hardware/verify-clear-reset-first-take.js 192.168.137.132 1250` -> `ITEM1_EXIT=1`, `[clear-reset] SOME FAILED`, 13 of 14 PASS. Raw output `.gm/witness-out/item1-clear-reset-run-20261106.txt` and reading `.gm/witness-out/item1-clear-reset-witness-20261106.txt` are immutable evidence. The harness default gate stays `original`, so that run reproduces exactly.

## Sequence (identical to the original)

Booted and empty device; press pad0 (note 2) -> sample origin telemetry -> hold 1250 ms -> press pad0 again (FINISH) -> settle; press CLEAR_ALL (note 0x5b) + release -> settle 1200 ms -> sample cleared state; repeat the identical take. Read UDP 4445 after every phase. tcp/9401 MIDI injection only. No restart, no ssh, no code change on the device, no hot-deploy. Re-run only in an owner-approved quiet Pi window.

## Unchanged rules

- R1: `xruns_after <= xruns_before + 1`; `latency_bias_samples_after <= before + 16`; `alsa_roundtrip_samples_after <= before + 16`. Any growth beyond this is a regression and the run stops.
- R2: each take must have `master_len_samples > 0`, `recorded_beats >= 1`, `loopers.wraplen[0] > 1`.
- R4: `last_take_arm_sample(take2) > last_take_arm_sample(take1)` and `audio_samples(take2) > audio_samples(take1)`.
- R5: `|last_take_span_samples - master_len_samples| <= 1.05 * (master_len_samples / recorded_beats)` per take.
- R6: `|derivedBpm(take2) - derivedBpm(take1)| <= 0.05` and `recorded_beats(take2) == recorded_beats(take1)`.
- ADR-034 observation is unchanged and is NOT A GATE: `impose_target_samples` is reported against `last_take_arm_sample - master_len_samples`; `NOT_PUBLISHED` is its own verdict.

## The corrected R3 (replaces ONLY R3-cleared-wlen)

After CLEAR_ALL the device-owned control state must equal startup defaults:

| rule | gate |
| --- | --- |
| R3-cleared-mlen | `master_len_samples == 0` |
| R3-cleared-rb | `recorded_beats == 0` |
| R3c-phase-zero | `master_phase_beats == 0` |
| R3c-sustain | `sustain_cmd == 0` |
| R3c-effspeed | `|eff_speed - 1| < 1e-4` |
| R3c-monitor | `monitor_mode == false` |
| R3c-glitch | `glitch_engaged == false` |
| R3c-rec | `(loopers.rec & 1) == 0` |
| R3c-play | `(loopers.play & 1) == 0` |

`loopers.wraplen[0]` is EXPLICITLY NOT GATED. AGENTS.md records that `wraplen > 1` is not proof of content because of `m_looperWrapLenStaleAfterWipe`, and `src/control/apc_grid.cpp:onClearAll` sets that flag. It is reported as a raw observation only. `sample_clock.create_*`, `impose_audio_samples` and `link_target_samples` are reported as raw observations, not gated; stale creation fields in the cleared window are a separately tracked suspicion.

Link bpm and peer count are REPORTED, never gated: `resetTempoAuthority()` clears ownership, not the session tempo held by the peer.

## Verdict rule

ALL rules must PASS. Every raw telemetry sample is printed. A FAIL is a FAIL; no threshold is lowered after results and no rule is reinterpreted. Before/after `xruns`, `latency_bias_samples` and `alsa_roundtrip_samples` are logged; if either regresses the run stops and the deployed commit is reverted and re-witnessed.

## Command

`node test/hardware/verify-clear-reset-first-take.js 192.168.137.132 1250 corrected`

This file is committed before that command is ever run.
