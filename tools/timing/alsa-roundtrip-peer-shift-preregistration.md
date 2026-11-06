# Pre-registration: what makes alsa_roundtrip_samples shift on Link peer re-acquisition

Owner: orchestrator-86 ruling 2026-11-06. Offline investigation only. No Pi SSH, no UDP 4445/4446, no 20813, no serial, no MIDI injection, no telemetry polling, no deploy, no restart, no flash, no power cycle. All device windows ON HOLD. This file is COMMITTED before any analysis code is run. No hypothesis, threshold, comparison or pass/fail line is added after results.

## Status of prior runs

Before this commit only READ-ONLY reconnaissance ran: gm.read_file, gm.grep, gm.stat_file, git show --name-only, git log -1, git fetch. No analysis script ran, no number was computed, no threshold existed, no verdict was produced. There are therefore no exploratory results to relabel. The first analysis run happens strictly after this commit and its output is reported as the pre-registered verdict.

## Frozen constants (read from code before this commit)

- N = block_size = 64, period = N = 64 (src/dsp/audio_thread.cpp:558), buffer = period*2 = 128 (line 559), start_threshold = avail_min = period (lines 577, 578). sampleRate = 48000.
- Identity (line 1503): latency_bias_samples = N + roundTripEstSamples + trimSamples. roundTripEstSamples = 4 s average of capDelay + playDelay + N (lines 1485, 1494-1495); capDelay from snd_pcm_delay(cap) (line 648), playDelay from snd_pcm_delay(play) (line 1472); g_telem.alsaRoundTripSamples = roundTripEstSamples (line 1501); trimSamples = g_cfg.latencyTrimSamples + g_liveLatencyTrimSamples (line 1500).
- trimSamples at line 1500 is a config/live-trim term, NOT the Link phase trim (linkPhaseTrim line 847 / masterPhaseSamples line 856). AGENTS.md:63 phase trim applies to masterPhaseSamples ONLY. Even if g_liveLatencyTrimSamples were Link-driven it would change trimSamples hence bias, not roundTripEstSamples hence rt.
- Telemetry field list src/control/telemetry.cpp:131 (alsa_roundtrip_samples, latency_bias_samples, latency_trim_samples), values at line 150; Link fields at line 126.
- AGENTS.md:74 latency bias is MEASURED via snd_pcm_delay, 4 s average, never a fast EMA; AGENTS.md:20 the ~7 ms budget (NOT decided here; owner's window 4a live measurement).

## Fixed comparison (frozen)

Peerless baseline = window-3 AFTER t+00s (peers=0 synced=False bpm=124.2): bias=185.4 rt=121.4. Peer-present plateau = mean of t+15/t+30/t+45 (peers=1 bpm=120.0): bias 237.3/237.4/237.1, rt 173.3/173.4/173.1. xruns flat=1. Reference shift = +51.9 samples (~1.08 ms). Controls (frozen): pre-deploy window 2 BEFORE peers=1 bias=196.7 rt=132.7; window 3 BEFORE peers=1 bias=190.3 rt=126.3; post-deploy peerless peers=0 bias=184.7 rt=120.7; period*2 lever rt 355.4 to 126.9. Sources: esp window-3 witness /config/workspace/esp-idf-link/.gm/witness-out/window3-adr034-witness-20261106.txt, docs/witness/solad-read-lag/breakdown.txt:60-75, docs/measurements-archive.md:417-430.

## Hypotheses (frozen; each ranked SUPPORTED / REFUTED / NOT_MEASURABLE_OFFLINE)

- H1 DISCRETE_ALSA_QUANTUM: the +51.9 is one period (64), one block (64), one buffer (128) or another whole buffer quantum in {32,64,128,256}. Implicates lines 558-560, 577-578, 1485.
- H2 LINK_PHASE_TRIM_CAUSE: the shift is produced by Link phase-trim / varispeed (masterPhaseSamples lines 856/902/974-982, linkPhaseTrim line 847, linkSpeedRatio lines 837/842, effSpeed line 849) or by the telemetry trimSamples term (lines 1500, 1503). Implicates the Link block lines 837-1082 and link_bridge.cpp:123-205.
- H3 PEER_PRESENCE_SUFFICIENT: Link peer re-acquisition (peers 0->1) is by itself sufficient to raise rt. Controls: pre-deploy peers=1 LOW readings.
- H4 BUILD_OR_REVERT: the deployed build (77bd050c fold patch + 6abaacee ADR-034 telemetry) is the cause; reverting to 77bd050c would clear the derived engaged figure. REFERENCED, not re-derived: parent's pre-registered source-diff verdict commit 69e47f66522c765600b921254072b364bc57821b (REVERT_TO_77bd050c_CANNOT_CLEAR_ON_SOURCE_EVIDENCE), witness .gm/witness-out/alsa-roundtrip-77bd050c-vs-6abaacee-source-check-20261106.txt, prereg tools/timing/peer-path-diff-preregistration.md. The 77bd050c..6abaacee peer-path diff scope (git diff + git log classification) is CORROBORATED under this prereg, not issued as a second independent verdict.
- H5 RESTART_ALSA_BUFFER_STATE: the elevation is a service-restart / ALSA-buffer fill / start-threshold / xrun-recovery state effect on snd_pcm_delay steady state, confounded with peer re-acquisition. Kept NOT_MEASURABLE_OFFLINE for the causal confirmation (needs a device restart control with peer held constant).

## Decision rule (frozen thresholds)

- D1 trim decomposition: dBias = plateauBias - baselineBias; dRt = plateauRt - baselineRt; dTrim = dBias - dRt. H2 (trim route) is SUPPORTED only if |dTrim| > 1.0 sample. If |dTrim| < 1.0 the entire shift sits in roundTripEstSamples and H2 (trim route) is REFUTED.
- D2 quantum: H1 is SUPPORTED only if |dRt - Q| <= 0.10*Q for some Q in {32,64,128,256}; else REFUTED. Report dRt/period, dRt/buffer, dRt/N, dRt/48000*1000 ms.
- D3 Link structural: the claim Link phase-trim / varispeed CAN change snd_pcm_delay is REFUTED (structural negative SUPPORTED) if the roundTrip block lines 1485-1503 and the ALSA param block lines 540-608 contain ZERO of {masterPhaseSamples, linkSpeedRatio, effSpeed, linkPhaseTrim, linkSnap, rebaseSeq, phaseAtTime, forceBeatAtTime, imposeTempo, linkTargetSamples, masterPhaseSlope} AND lines 648/1472 are the only snd_pcm_delay feeds to line 1485.
- D4 peer presence: H3 is SUPPORTED only if every peers=1 reading is >= baseline + 0.5*51.9 AND no peers=1 reading is within 0.10*period (6.4 samples) of the peerless baseline rt=121.4. A single peers=1 reading within 6.4 samples of 121.4 REFUTES H3.
- D5 build/revert: stated plainly from the corroborated diff classification, referencing 69e47f66; no new independent verdict.
- D6 restart state: verdict NOT_MEASURABLE_OFFLINE (needs device restart control + peer-present end-to-end measurement).

## Pass/fail line (composite claim C, frozen)

C: The +51.9-sample elevation is a non-integer-quantum (~0.81*period) change confined ENTIRELY to the ALSA snd_pcm_delay average (roundTripEstSamples); it is NOT a phase-trim change; the Link phase-trim/varispeed path has NO code path to snd_pcm_delay or the ALSA params; and the peer's presence alone is NOT a sufficient cause. C PASSES iff ALL hold: (i) |dBias - dRt| < 1.0; (ii) dRt not within 10% of any Q in {32,64,128,256}; (iii) zero Link identifiers in lines 1485-1503 and 540-608; (iv) at least one peers=1 reading within 6.4 samples of 121.4; (v) all code-fact assertions (lines 648, 1472, 1485, 1494, 1501, 1503, 558, 559, 577, 1500) hold. C FAILS otherwise. The 7 ms end-to-end invariant is NOT decided here; it belongs to the parent's window 4a live measurement (test/hardware/window4a-peer-present-latency-preregistration.md).

## Scope discipline

Owned files: this prereg, tools/timing/alsa-roundtrip-peer-shift-analysis.js, .gm/witness-out/alsa-roundtrip-peer-shift-analysis-20261106.txt. src/, dsp/, .gm/prd/, .github/workflows/, test/hardware/, tools/loop-quantization-sim/ are READ-ONLY. No device verdict is claimed. Every ranking keeps NOT_MEASURABLE_OFFLINE as its own verdict.
