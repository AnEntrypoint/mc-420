SOURCE-LEVEL PEER-PATH DIFF PRE-REGISTRATION, 2026-11-06 (owner ruling: investigate offline, all devices held).
Written and committed BEFORE the re-run of the diff. No device action, no deploy, no restart, no revert.
QUESTION (orchestrator-86): what changed between 77bd050c532d54441321cc8fd1179b48ce61adae and
6abaaceee97cd8a53ec10d533b6fa2db031fb52c on the peer path, and would a revert to 77bd050c clear the
derived engaged end-to-end figure seen in window 4a?
HYPOTHESES, fixed now:
  H1 the diff contains an ALSA / period / buffer / snd_pcm_delay / roundTripEst change -> a revert
     could clear it.
  H2 the diff contains a Link phase-target / phase-trim / peer-path compute change -> a revert could
     clear it through the audio thread.
  H3 the diff is TELEMETRY-ONLY -> a revert cannot change alsa_roundtrip_samples or
     latency_bias_samples, so it cannot clear the derived figure on source evidence.
  H4 the fold patch (77bd050c) is itself on the peer path, but reverting TO 77bd050c keeps it; only
     reverting to 77bd050c^ would remove it.
METHOD, fixed now: git log --oneline 77bd050c..6abaacee; git diff --stat and git diff of the same
range restricted to src/ dsp/ effects/ config/; classify every changed line into exactly one of
ALSA/BUFFER, LINK_PEER_PATH, TELEMETRY_ONLY, OTHER. Confirm requestPhaseImpose at
src/dsp/audio_thread.cpp:916 is byte-identical. Confirm by git show 77bd050c which peer-path changes
belong to the proposed revert target itself. Cross-check against the already-witnessed device readings
(window 2 AFTER 193.1/129.1 peers=0; window 3 BEFORE 190.3/126.3 peers=1 on the 77bd050c build;
window 3 AFTER 184.7/120.7 peers=0; esp AFTER series and window 4a 236.9..238.7/172.9..174.7
peers=1 on 6abaacee).
DECISION RULE, fixed now: if every changed line in the range is TELEMETRY_ONLY and requestPhaseImpose
is byte-identical, verdict = REVERT_TO_77bd050c_CANNOT_CLEAR_ON_SOURCE_EVIDENCE, with the elevation
attributed to a DEVICE/ALSA STATE EFFECT. If ANY changed line is ALSA/BUFFER or LINK_PEER_PATH, verdict
= REVERT_COULD_CLEAR_NEEDS_DEVICE_CONTROL. Anything a device restart control would be needed to prove
is kept as NOT_MEASURABLE_OFFLINE, never claimed as a device verdict. No hypothesis or threshold may
be added after results. Reverting is NOT executed here (owner: any revert is closed).
NOTE: an earlier identical read-only diff was run at sha 1c0389ec; that result stands as recorded and
is NOT retroactively relabelled as pre-registered. This document pre-registers the re-run that
produces the formal verdict.
