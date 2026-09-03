declare name "PitchPoly";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic PSOLA/formant-preserving pitch-shift bridge for multitranspose.dsp's 6 key-lock voices -- extracted into its own compile unit (never inline inside multitranspose.dsp) to keep the ffunction declaration away from that file's own compile-time-cliff risk. Each voice gets its own EngineSoladSnac instance (SNAC pitch tracking, splice-based PSOLA resplicing, real GrainFormant formant preservation) via a shared voice-indexed C++ array, mirroring pitch.dsp's existing mono free-transpose bridge exactly, just made polyphonic.";

pitchTickPoly = ffunction(float dubfx_pitch_tick_poly(float, float, float, float, float), "pitch_poly_ffi.h", "");
pitchConfidencePoly = ffunction(float dubfx_pitch_confidence_poly(float), "pitch_poly_ffi.h", "");

process(sig, voiceIdx, scaleRatio, formant, engaged) =
    (sig, voiceIdx, scaleRatio, formant, engaged : pitchTickPoly), (voiceIdx : pitchConfidencePoly);
