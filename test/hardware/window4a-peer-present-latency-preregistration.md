WINDOW 4a PRE-REGISTRATION, 2026-11-06 (read-only, written BEFORE any measurement).
Ruling (orchestrator-86): insert a read-only window 4a BEFORE the item 9 flash. NO deploy, NO restart, NO flash, NO power cycle. Hold the Link peer present throughout and measure latency_bias_samples and alsa_roundtrip_samples before, during and after a take on the current 6abaacee build. Put esp's t+15..t+45 numbers in the witness next to mine. Then decide whether the +51.9-sample rise belongs to the peer's presence or to the build. If it is the build, stop and report before window 4. Do not flash or restart on top of an unexplained latency rise.
REFERENCE STATES, fixed now from tool output already observed:
  A (peer present, pre-deploy, 77bd050c device build, window 2 BEFORE): bias 196.7, rt 132.7, xruns 5.
  B (peer present, pre-deploy, window 3 BEFORE): bias 190.3, rt 126.3, xruns 1.
  C (peer absent, immediately post-deploy 6abaacee, window 3 AFTER): bias 184.7, rt 120.7, xruns 1.
  D (esp read-only series, peer re-acquired, 6abaacee): t+00s peers=0 bias 185.4 rt 121.4; t+15s peers=1 bias 237.3 rt 173.3; t+30s peers=1 bias 237.4 rt 173.4; t+45s peers=1 bias 237.1 rt 173.1. xruns flat at 1. Witness /config/workspace/esp-idf-link/.gm/witness-out/window3-adr034-witness-20261106.txt.
Identity: latency_bias_samples = N + alsa_roundtrip_samples + latency_trim_samples (AGENTS.md; src/dsp/audio_thread.cpp:1503), so the +51.9 rise is entirely in roundTripEstSamples, a 4 s average of capDelay + playDelay (audio_thread.cpp:1487-1503), never a fast EMA.
MEASUREMENT (test/hardware/verify-peer-present-latency.js): require link.synced=true and link.peers>=1 at the start; sample UDP 4445 at 1 Hz for 12 s BEFORE, 5 samples at 250 ms DURING a 1250 ms pad0 take, and 1 Hz for 12 s AFTER. Record bias, rt, trim, peers, synced, bpm, phase_err_beats, xruns, master_len_samples, recorded_beats. Print count, min, median, max of bias and rt per phase, plus peer-presence violations. No threshold is invented after results.
DECISION RULE, fixed now:
  - If all samples keep peers>=1 AND each phase median bias is within 16 samples of the pre-deploy peer-present band (A/B: 190.3..196.7), verdict TRANSIENT_SETTLING: the rise was a re-acquisition transient, NOT the build, and window 4 may proceed.
  - If all samples keep peers>=1 AND each phase median bias is within 16 samples of D (237.1..237.4), verdict PERSISTENT_PEER_PRESENT_STATE. I will then check the shipped 6abaacee diff by path:line: if it touches no ALSA, period, buffer, or audio-thread compute path (it is telemetry-only at src/dsp/audio_thread.cpp:920), verdict STATE_EFFECT_NOT_BUILD and window 4 may proceed, with the caveat that a restart-free window cannot fully isolate restart state from build. Any doubt is reported as UNATTRIBUTED and window 4 is NOT opened without an owner ruling.
  - Any peer loss, any bias/rt growth > 16 samples across before -> during -> after, or any xrun growth is BUILD_OR_PATH_SUSPECT: STOP and report before window 4.
  - A FAIL is a FAIL; no tolerance is widened after results and no verdict is reinterpreted.
No device change occurs in this window beyond the MIDI take itself. START and END markers go to esp; esp holds its polls.

ADDENDUM 2026-11-06, orchestrator-86 ruling, written BEFORE any window 4a measurement.
END-TO-END IS THE DECIDING NUMBER. The invariant is about end-to-end latency, not just bias and
roundtrip. test/hardware/verify-peer-present-latency.js now reports, for every sample and phase:
idleMs = latency_bias_samples / 48; engagedSamples = latency_bias_samples + 127; engagedMs =
engagedSamples / 48; and over7ms counts samples whose engagedMs > 7. The +127 engaged free-transpose
stage is the repo's documented decomposition (docs/measurements-archive.md:418 and
docs/witness/solad-read-lag/breakdown.txt:71-72: idle 190.9 = 3.977 ms, engaged end-to-end
317.9 samples = 6.623 ms = 190.9 + 127; 128 samples = 64 DUBFX_BS buffering at
effects/home/faust/pitch_ffi.h:24 plus 64 SOLA read lag at
effects/home/faust/soladSnacOctaver.h:251, derived form engaged latency = 63 + gap = 127 at gap 64).
The engaged wet-effect latency is EXEMPT per AGENTS.md, so BOTH the non-exempt idleMs and the
headline engagedMs are reported; the owner decides which governs. This is a derived end-to-end
figure from live telemetry plus a verified shipped constant, NOT a fresh audio loopback capture;
a live USB audio round-trip capture is a separate measurement and is not claimed here.
DECISION RULE ADDITION, fixed now: if the median engagedMs in ANY of the three phases exceeds
7.000 ms, or any single sample does, the verdict is END_TO_END_OVER_7MS: STOP, report to
orchestrator-86, and do NOT open window 4, 5 or 6. If the median engagedMs is <= 7.000 ms in all
three phases, report the numbers and the earlier bias/rt verdict; the invariant is then not breached
by this measurement. No tolerance is widened after results.
The device changes (windows 4, 5, 6) are ALL ON HOLD until orchestrator-86 clears the latency
interpretation. Window 4a itself has NO deploy, NO restart, NO flash, NO power cycle.
NETBOOT PIN, fixed by orchestrator-86: pin 6abaaceee97cd8a53ec10d533b6fa2db031fb52c (fully green
CI), NOT the stale served sha a0e08fb3... and NOT the old 5acb7d3b default. The served payload is
NOT refreshed until the latency interpretation clears.
