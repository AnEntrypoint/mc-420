# Pending validation

- tools/audio/focusrite-loop-guard.sh — witness: focusrite-loop-guard apply output, capture-stats.json, loop-direct.json, inject-ch6.json and guard-capture.json; verify the Focusrite headphone sources, Mix input 02 and Mixer Input 12 routing, and the before/after RMS on channel 2.
- tools/audio/record-tap-witness.cjs — witness: record-tap-witness.json and the saved clip WAVs; compare RMS and onsets for each input 1 mode with the latch in each state, with no other looper cleared.
- src/dsp/audio_thread.cpp — witness: code grep of inputRecGain and recordTap; the record tap reads the per-channel mode and no latch parameter.
- dsp/effects_runtime_post.dsp — witness: code grep of recordTap and audienceGate; recordTap has no SUSTAINGATE.
- dsp/effects_runtime_pre.dsp — witness: code grep of preFilterOut and masterIn; the pre-stage feeds both cue and master before any audience gate.
- tools/audio/focusrite-loop-guard.sh — witness: hp2-proof.json and loud-signal-spectrum.txt; the remaining latch-off clipping stays on Focusrite channel 2 with Headphones 2 L muted, its source off and its volume at zero, so it is blocked on the M-Audio AIR 192|4 front-panel USB/Direct hardware monitor blend knob or the physical cable from Focusrite Headphones 2 L to AIR192 input 2.
- tools/audio/99-focusrite-input2-guard.rules — witness: udevadm test reads the rule, synthetic sound add restarts focusrite-input2-guard.service, and two guard runs leave Line In 2 Pad, Air and Level unchanged.
- tools/netboot/etc/init.d/aloop — witness: post-deploy reboot log, telemetry defaults and Link peer state.