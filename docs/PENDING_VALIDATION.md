# Pending validation

- tools/audio/focusrite-loop-guard.sh — witness: focusrite-loop-guard apply output, capture-stats.json, loop-direct.json, inject-ch6.json and guard-capture.json; verify the Focusrite headphone sources, Mix input 02 and Mixer Input 12 routing, and the before/after RMS on channel 2.
- tools/audio/record-tap-witness.cjs — witness: record-tap-witness.json and the saved clip WAVs; compare RMS and onsets for each input 1 mode with the latch in each state, with no other looper cleared.
- src/dsp/audio_thread.cpp — witness: code grep of inputRecGain and recordTap; the record tap reads the per-channel mode and no latch parameter.
- dsp/effects_runtime_post.dsp — witness: code grep of recordTap and audienceGate; recordTap has no SUSTAINGATE.
- dsp/effects_runtime_pre.dsp — witness: code grep of preFilterOut and masterIn; the pre-stage feeds both cue and master before any audience gate.
- tools/netboot/etc/init.d/aloop — witness: post-deploy reboot log, telemetry defaults and Link peer state.
