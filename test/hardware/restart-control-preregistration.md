PRE-REGISTRATION: SINGLE DEVICE RESTART CONTROL FOR THE ALSA STATE-EFFECT HYPOTHESIS, 2026-11-06.
Owner ruling (orchestrator-86): exactly ONE device action is cleared — one remote aloop service restart. NO deploy, NO flash, NO revert, NO LTMP, NO LRST, NO power cycle. Device work freezes again immediately after this control and a report goes to orchestrator-86 before any further window. This file is COMMITTED to main (lanmower only) and its sha is reported BEFORE any run. No hypothesis, threshold, comparison or pass/fail line may be added after results.

## Frozen state and question
Build on device: 6abaaceee97cd8a53ec10d533b6fa2db031fb52c, /opt/aloop/aloop md5 35d907a4be7a32e654315686ea5c6ec1. NO binary change in this window.
Question: does the +51.9-sample ALSA roundtrip elevation RECUR after a restart with the Link peer re-acquired, on identical code? Parent pre-registered verdict 25f46b92 (prereg 02c64a78) classified it as a DEVICE/ALSA STATE EFFECT, not a build effect, and additive to the derived engaged figure; pre-registered source diff 69e47f66 (prereg 71adb371) showed 77bd050c..6abaacee is telemetry-only so a revert cannot clear it.

## Frozen reference numbers
ELEVATED PLATEAU (peers=1): esp window-3 AFTER t+15/t+30/t+45 bias 237.3/237.4/237.1 rt 173.3/173.4/173.1; window 4a medians bias 237.6/238.6/238.1 rt 173.6/174.6/174.1, idleMs 4.950/4.971/4.960, derived engagedSamples 364.6/365.6/365.1, engagedMs 7.596/7.617/7.606, 29/29 samples over 7 ms, peerViolations 0, xruns flat at 1.
LOW PRE-DEPLOY PEER-PRESENT BAND: window 2 BEFORE bias 196.7 rt 132.7; window 3 BEFORE bias 190.3 rt 126.3. Post-deploy peerless window 3 AFTER bias 184.7 rt 120.7.
Identity: latency_bias_samples = N 64 + alsa_roundtrip_samples + trim 0 (src/dsp/audio_thread.cpp:1503); rt is a 4 s average of capDelay + playDelay from snd_pcm_delay (:648, :1472, :1485-1495), never a fast EMA.

## Restart procedure, fixed now
  1. BASELINE: one UDP 4445 status. Require link.synced=true and link.peers>=1; if not, STOP with verdict PEER_NOT_PRESENT_AT_BASELINE and no restart. Record bias, rt, idleMs, engagedSamples, engagedMs, xruns, mlen, rb.
  2. REMOTE RESTART (the ONLY recovery path): node test/hardware/ssh-run.js 192.168.137.132 'rc-service aloop restart' using ssh2. Log its output verbatim and RECOVERY_PATH=REMOTE_RESTART_VIA_SSH2. If it fails, log RECOVERY_PATH=REMOTE_RESTART_FAILED_NO_FALLBACK, STOP and report; NO power cycle and NO fallback without a new owner ruling.
  3. PEER RE-ACQUISITION: poll UDP 4445 at 1 Hz until link.synced=true AND link.peers>=1 TWICE consecutively, max 180 s. Record the elapsed seconds and the peerless samples. If not reached, verdict = PEER_NOT_REACQUIRED (own verdict, not a hypothesis pass/fail), STOP and report.
  4. SETTLE 6 s after re-acquisition (AGENTS.md: skip ~6 s after FINISH), then measure: 20 samples at 1 Hz BEFORE, one pad0 (note 2) 1250 ms take with 5 telemetry samples DURING at 250 ms, 20 samples at 1 Hz AFTER. For each sample record bias, rt, trim, idleMs = bias/48, engagedSamples = bias + 127, engagedMs = engagedSamples/48, peers, synced, bpm, phase_err_beats, xruns, mlen, rb.
  Only these device actions occur: one UDP status query per sample, one MIDI take, one remote restart. No deploy, no file write on the device, no netboot change.

## End-to-end measure, fixed now
idleMs = latency_bias_samples / 48; derived engagedSamples = latency_bias_samples + 127; derived engagedMs = engagedSamples / 48. The +127 is the documented engaged free-transpose stage (docs/measurements-archive.md:418, docs/witness/solad-read-lag/breakdown.txt:71-72; 64 DUBFX_BS at effects/home/faust/pitch_ffi.h:24 + 64 SOLA read lag at effects/home/faust/soladSnacOctaver.h:251, derived form 63 + gap = 127 at gap 64). This is a DERIVED figure from live telemetry plus a shipped constant, NOT a live USB audio loopback capture; no live round-trip is claimed. 7 ms = 336 samples. AGENTS.md exempts engaged wet-effect latency; the ~7 ms INVARIANT CALL REMAINS THE OWNER'S and is NOT decided by this control.

## Peer-present condition, fixed now
Every JUDGED sample (all 45 BEFORE/DURING/AFTER samples) must have link.synced=true and link.peers>=1. A peer loss during the judged phases makes the verdict INCONCLUSIVE. xruns must not grow by more than 1 across the window.

## Verdict rule, BOTH outcomes written BEFORE the run
  ELEVATED_BAND: bias median in [221.6, 253.6] and rt median in [157.6, 189.6] (observed plateau 237.6 / 173.6 +/- 16).
  LOW_BAND: bias median in [177.5, 209.5] and rt median in [113.5, 145.5] (low band centre 193.5 / 129.5 +/- 16).
  CONFIRMS_STATE_EFFECT: ALL THREE phases have their bias AND rt medians inside ELEVATED_BAND, with peers>=1 and synced=true in every judged sample and no xrun growth > 1. Reading: the elevation RECURS on identical code after a restart, so it is a device/ALSA state effect, not the build.
  REFUTES_STATE_EFFECT: ALL THREE phases have their bias AND rt medians inside LOW_BAND, with the same peer and xrun conditions. Reading: the elevation does NOT recur after a restart; the state-effect hypothesis is not confirmed.
  INCONCLUSIVE: neither of the above — intermediate values, mixed phases, peer loss during judged samples, or xrun growth > 1. Own verdict; stop and report, no further device action.
  PEER_NOT_REACQUIRED and PEER_NOT_PRESENT_AT_BASELINE are separate own verdicts, not pass/fail of the hypothesis.
The derived engagedMs medians are reported against 7 ms in each phase as an observation only; they do NOT change the CONFIRMS/REFUTES/INCONCLUSIVE verdict and do NOT decide the invariant.
A FAIL is a FAIL. No threshold is widened, no rule reinterpreted, no verdict softened after results.

## Window protocol
START and END markers to esp; esp holds all device polls. One window, one restart. After the control, devices freeze again and the verdict is reported to orchestrator-86 as THE PRE-REGISTERED RESTART CONTROL, labelled separately from the parent ALSA verdict 25f46b92 and the peer-path diff verdict 69e47f66. The ALSA investigation agent's own pre-registered verdict (prereg 54f179e9) is separate again.
