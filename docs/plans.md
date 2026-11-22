# Open plans (mirror of gm PRD rows)

# Ranked remaining backlog, 2026-11-14

Current item: rank 1, worked offline. It does not use the Pi, ESP, Focusrite, owner hardware or audio capture.

| rank | id | status | dependency | offline | subject |
| --- | --- | --- | --- | --- | --- |
| 1 | netboot-refresh-replaces-binary-only-lv2-stale | pending, offline witness added | refresh-apkovl.sh and local archive | yes | refresh-apkovl.sh swaps only the binary, leaving LV2 from the old payload |
| 2 | netboot-windows-poller-ignores-pin | pending, offline pin check added | serve-netboot-win.js | yes | serve-netboot-win.js polls newest green main, not the pin |
| 3 | netboot-served-payload-not-pin-build | pending, host archive only | served apkovl file | yes | served apkovl is pre-offset but not the pinned build |
| 4 | pitch-reference-comb-submultiple-floor-disagree | pending | offline corpus tools | yes | comb.mjs certifies vocal 114.18 Hz while submultiple.mjs finds no clearing line in 100-150 Hz |
| 5 | gate-level-normalisation | pending | offline render, owner pre-registration | partial | Normalise gate inputs to a fixed rms so the energy floor stops deciding which files are scoreable |
| 6 | gate-silence-23-of-37 | pending | cause found; no render needed | yes | 23 of 37 gate inputs publish no voiced settled block: check the gain convention |
| 7 | gate-level-normalised-pin-rule-reregister | pending | external owner recompute | no | Level-normalised gate needs re-registration on the pin rule |
| 8 | gate-silence-23-of-37-ready-unvoiced | pending | external per-file settled output | no | 3 of the 23 silent gate inputs are energy-ready at the corpus gain but publish no voiced settled block |
| 9 | resonode-m1-envelope-follow-target-0-30 | parked | external DawDreamer round 5 | no | resonode envelope-follow M1: re-registered target 0.30, round 5 pending |
| 10 | lp-slope-control-binding | pending | code plus MIDI injection on device | no | LPSLOPE (fx/lpslope) has no control-surface binding, so 24 dB/oct is unreachable from the device |
| 11 | filter-chain-swap-lp-before-hp | pending | code plus device listen check | no | swap filter chain order to low-pass then high-pass |
| 12 | defect-piano-low-a1-tau-sensitive | pending | offline DSP render, no rig | yes | piano_low_A1 is voiced at corrAtLagVar tau 0.01 and silent at 0.02 on identical input |
| 13 | defect-marimba-c2-3p6-685hz-segment | pending | offline DSP render, no rig | yes | marimba_low_C2B2 3.6-6.0 s segment settles at 685.7 Hz in the CI traces |
| 14 | defect-pin-vocal-tenor-137-vs-certified-114 | pending | offline DSP render, no rig | yes | vocal_tenor_operatic_PD settles at 137.5 Hz; the certified comb F0 is 114.18 Hz (321.7 cents, not an octave or subharmonic) |
| 15 | defect-2093-grid-ext-low-register-regression | pending | offline DSP render, no rig | yes | 2093 grid extension moves vibraphone_mid_C5B5 to 189 Hz and runs piano_low_A1 to 1714 Hz |
| 16 | defect-sine-2093-subharmonic | pending | offline DSP render, no rig | yes | sine_2093 settles at 700.24 Hz, a 3:1 subharmonic (-1895.6 c), at both correlation taus |
| 17 | defect-rb3-link-target-fold-origin-drift | pending | simulator plus hardware witness | no | rb 3 first take: Link target folds on 16 beats, phase trim drifts the origin by a beat |
| 18 | defect-rb3-origin-level-per-run-offset | pending | simulator plus hardware witness | no | rb 3 origin settles at a per-run level from -3 to +78 samples off the arm edge |
| 19 | defect-rb3-origin-rate-41ppm | pending | simulator plus hardware witness | no | rb 3 origin drifts 41-49 ppm after creation (constant slope in every run) |
| 20 | first-loop-master-timing | pending | simulator plus hardware witness | no | First loop sets master tempo, phrase and origin on every path, predictably |
| 21 | first-loop-phrase-offset-by-loop-length | pending | simulator plus hardware witness | no | First loop's phrase turnaround sits one loop before the record press, not at the press |
| 22 | first-loop-own-take-after-peer-origin | pending | peer hardware witness | no | A device's own first take after adopting a peer origin re-origins the network |
| 23 | timing-empty-slave-adoption | pending | peer hardware witness | no | Empty slave must adopt a peer's first recording seamlessly and fast |
| 24 | timing-origin-exact-sample-unwitnessed | pending | hardware witness | no | Exact-sample origin claim is unwitnessed on hardware |
| 25 | adr034-impose-target-not-published | pending | hardware telemetry witness | no | ADR-034 press-minus-L phrase origin is not observable in telemetry |
| 26 | adr034-peer-present-hardware-witness | pending | peer hardware witness | no | ADR-034 press-minus-L origin needs a hardware witness with a live Link peer |
| 27 | link-peer-not-reacquired-after-aloop-restart-180s | pending | Pi/ESP console witness held by peer | no | Link peer did not re-acquire within 180 s of a single aloop service restart |
| 28 | peer-reacquisition-alsa-roundtrip-rise | pending | Pi telemetry with peer | no | ALSA roundtrip and latency bias rise ~52 samples on Link peer re-acquisition and stay elevated |
| 29 | pi-phase-rebase-backwards-phrase-jump | pending | Pi/ESP | no | Pi phase rebase can make the ESP emit a false phrase boundary |
| 30 | esp-no-realign-on-phase-rebase-without-ltmp | pending | ESP peer | no | ESP does not queue a realign on a Pi phase rebase that arrives without an LTMP |
| 31 | midi-transport-realign-needs-on-device-din-capture | pending | on-device DIN/UART capture | no | Gear-side MIDI Start after a real peer loss has no on-device DIN/UART byte witness |
| 32 | visual-metronome-beat-cue-onset | pending | hardware LED/cue witness | no | Visual beat cue onset is within 7 ms of the Link beat origin it marks |

## Offline witnesses, 2026-11-14

- Item 2 `netboot-windows-poller-ignores-pin`: `node tools/netboot/check-netboot-pin.cjs image/serve-netboot-win.js` -> `{"checks":9,"failed":[],"pass":true,"file":"image/serve-netboot-win.js"}`. Held witness: a Windows host running the poller with both `NETBOOT_PIN` and a newer green `main` must serve only the pinned SHA; that needs owner hardware. No rig action was taken.
- Item 3 `netboot-served-payload-not-pin-build`: 2026-11-22 the default `NETBOOT_PIN` moved to `7a68a1ce` and `tools/netboot/refresh-apkovl.sh` with no override installed that build (aloop sha256 `b54a16a6`, 4 LV2 bundles, backup `aloop.apkovl.tar.gz.bak-20261122T081317Z`); `node tools/netboot/check-served-pin.cjs` now reads `pass:true`. Held witness: a netboot reboot of the Pi from the served payload with telemetry defaults checked.
- Item 4 `pitch-reference-comb-submultiple-floor-disagree`: `node tools/pitch-reference/check-floor-rule.mjs` ran both tools on one 432044-byte WAV with a 96 MB heap, asserted comb certifies 114.18 Hz, submultiple reports zero clearing candidates and excludes the file, and `archive#pitch-reference-floor-rule` states both floors. The disagreement is recorded as a stated rule. The check is offline, uses no rig or audio capture, and no archived verdict was changed.

Additional non-row blockers: the no-chip-reset console witness is held by esp-idf-link; hot-deploy reboot persistence remains an open PRD; gm release propagation is held on auto-update. The AIR192 USB/Direct knob is already fully USB, so it is not a blocker: latch-off clipping on Focusrite channel 2 is high mic/beeper gain for the timing test, `focusrite-input2-guard.service` (Line In 2 Pad on, Air off, Level Line, with its udev rule) is the mitigation, and lowering the mic gain after the test removes the condition.

## Closed rows

Rows that left the open list; the open rows are the ranked table above. Where a row has more detail, the named doc holds it; otherwise this line is its only record.

- `decision-7ms-invariant-peer-present-engaged-figure`: closed. Owner decision and live loopback witness for the ~7 ms invariant with a Link peer present. Detail: DECISIONS.md.
- `docs-archive-anchor-references-unresolved`: closed. AGENTS.md references 58 archive# anchors but the measurements archive defines only 15.
- `pi-phase-capture-128-fold-rb`: closed. 128-beat phase capture is folded at rb when rb does not divide 128.
- `chore-x64-lv2-target`: left the open list after the 2026-11-06 dump. Last recorded: Closed. The x64 LV2 build target is in CI and green.
- `defect-lock-above-1500hz-clamp`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. The candidate fix 934258b (refine K = P/4, ceiling 2600) is a FAIL under the agreed gate, confirmed by an independent DawDreamer render (dawdreamer-de, pinned driver drv_p934 sha bcbb71ac2e42f188eedc52b3affd9cf74c0778dc7218a60afb44104e81923b5d): crotale_high_C7 at held note 96 (true pitch, gate row) moves… Detail: DECISIONS.md, measurements-archive.md.
- `defect-lock-transient-flapping`: left the open list after the 2026-11-06 dump. Last recorded: OPEN, blocked on measurement. The piano transient cases cannot be judged on valid captures: piano C4 at MIDI 60 and MIDI 45 gives INVALID in every rep (2.3 to 2.9 dB over the 30e-6 silence, below the 10 dB rule).
- `defect-lock-unpitched-floor-2000hz`: left the open list after the 2026-11-06 dump. Last recorded: RE-SCOPED. The 2000 Hz readings are NOT a lock defect.
- `defect-transpose-a1-splice-residual`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. After 8ed5946 the tracker follows piano_low_A1 (59.7 cents mean), but the splices are still not clean: glitch count at threshold 0.25 minGapMs 5 is 27/28/29 at +12/+19/+24 against a baseline of 24/27/31, and the render's splice count fell 294->192. Detail: DECISIONS.md.
- `defect-witness-range-4khz`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. tools/loopback-witness/loopback-witness.js searches only 50 to 4000 Hz, so any output above 4 kHz is reported at its octave below.
- `gm-commit-refusals-message-lint`: left the open list after the 2026-11-06 dump. Last recorded: Partial cause of git_commit failures in this project: the commit-message gate refuses subjects over 50 characters and body lines over 72. Detail: DECISIONS.md.
- `gm-lean-walk-evidence-missing`: left the open list after the 2026-11-06 dump. Last recorded: gm walks in this project write no .gm/lean-walk evidence. phase_history shows JTBD, XYPROB, EARS and INVEST were reached, and none of them left a file, so the walk coverage the dream-rsi inference reads is 0 by construction. Detail: DECISIONS.md.
- `goal-transpose-vocoder-predictable`: left the open list after the 2026-11-06 dump. Last recorded: GOAL (means-free). Acceptance in EARS. Detail: DECISIONS.md.
- `means-ac-tracker-octave-flip`: left the open list after the 2026-11-06 dump. Last recorded: MEANS: remove octave jumps at their source. Acceptance in EARS. Detail: DECISIONS.md.
- `means-live-loopback-witness`: left the open list after the 2026-11-06 dump. Last recorded: MEANS: a live witness loop needing no human. Acceptance in EARS.
- `means-transpose-corpus-breadth`: left the open list after the 2026-11-06 dump. Last recorded: MEANS: prove behaviour over as much real material as exists. Acceptance in EARS. Detail: DECISIONS.md.
- `means-transpose-latency-floor`: left the open list after the 2026-11-06 dump. Last recorded: MEANS: lowest achievable latency, proved. Acceptance in EARS. Detail: DECISIONS.md, measurements-archive.md.
- `means-vocoder-formant-quality`: left the open list after the 2026-11-06 dump. Last recorded: MEANS: make the vocoder and formant layer as predictable as the transpose. Acceptance in EARS. Detail: DECISIONS.md.
- `plan-crotale-window-sensitivity`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. The crotale baseline tracker output is bimodal (61, 170, 708 Hz plateau, 941, 1400-1500 Hz), so its settled value moves about 4 times with the window (t >= 1.0 s gives 708.6 Hz; second-half gives 170.2 Hz). Detail: DECISIONS.md.
- `plan-dawdreamer-harness-commit`: left the open list after the 2026-11-06 dump. Last recorded: BLOCKED ON USER. The DawDreamer offline render harness (dd_faust_render.py, dd_pitch_run.py, drafted by the DawDreamer session in dd-render) is not committed to mc-420. Detail: DECISIONS.md.
- `plan-defect-midi96-instability`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. The device lock for a 2093 Hz input held at MIDI 96 reads 149.55 Hz (about 4 octaves low) consistently, while the offline lock run for the same inputs is unstable (2009 Hz, ncc 0.65). Detail: DECISIONS.md.
- `plan-defect-piano-lowbass-ac-silent`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. pitchtracker_ac outputs 0 Hz on the whole of piano_low_A1.wav (55.69 Hz) and on balloon_pop_transient.wav, on both the 5d298ed2 and 934258b builds and on the c2100 variant. Detail: DECISIONS.md.
- `plan-piano-transient-measurement`: left the open list after the 2026-11-06 dump. Last recorded: OPEN, blocked on measurement. The piano transient-octave claim cannot be judged: the piano note window sits 2 to 3 dB over silence, below the 10 dB validity rule, so every piano lock case is INVALID. Detail: DECISIONS.md.
- `plan-profile-voice-path`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. Profile the remaining hotspot items from the list sent to the DawDreamer session: item 2 (six pitch_poly voices) measured at 3.5 percent of one core with the shared tracker included and about 2.4 percent with the tracker stubbed; the LPC formant shaper adds about 3.3 points. Detail: DECISIONS.md.
- `plan-variant-v3-gate`: left the open list after the 2026-11-06 dump. Last recorded: OPEN. Variant v3 (full 2600 candidate list used only when the base pick is above 1000 Hz; sha256 2b7a6698..., scratchpad v2/var/v3.dsp) is being compiled and gated by the DawDreamer session. Detail: DECISIONS.md.
- Closed in the 2026-11-06 campaign: `docs-origin-formula-misses-phase-wrap`, `phrase-gap-triage-mc420-gm-scope-23`, `gap-38-20813-status-field-semantics`, `gap-76-ci-hardware-verifiers`, `gap-80-duplicate-sim-step`, `gap-81-phrase-anchor-path-gate`, `gap-51-join-race-tempo-authority`, `clear-reset-corrected-gate`.
