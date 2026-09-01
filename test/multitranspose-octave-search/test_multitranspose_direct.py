#!/usr/bin/env python3
"""Render multitranspose.dsp directly with real vocal audio + a real
(already-guarded) extFreqDet trace, holding one voice's key, to check
whether the downstream note-lock/xpose math introduces its own octave
artifact even when freqDet itself is clean and stable."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"
CORPUS = REPO_ROOT / "test-audio-corpus" / "user-provided" / "kimmels_famous_last_words.wav"
FREQTRACK = Path(__file__).with_name("freqtrack_kimmels_famous_last_words.wav.npy")


# Simulate the C++ jumpGuard exactly (mirrors src/dsp/audio_thread.cpp) to
# get the GUARDED extFreqDet, not the raw tracker output.
JUMP_MAX_RATIO = 1.6817928
JUMP_CONFIRM_BLOCKS = 9
OCTAVE_CONFIRM_BLOCKS = 60
OCTAVE_TOLERANCE_RATIO = 1.05
SILENCE_RESET_BLOCKS = 40


def simulate_cpp_guard(freq_track):
    anchor = 0.0
    candidate = 0.0
    streak = 0
    silence_blocks = 0
    outputs = []
    n_blocks = len(freq_track) // BLOCK_SIZE
    for b in range(n_blocks):
        raw = float(freq_track[(b + 1) * BLOCK_SIZE - 1])
        if raw <= 0.0:
            silence_blocks += 1
            if silence_blocks >= SILENCE_RESET_BLOCKS:
                anchor = 0.0
                candidate = 0.0
                streak = 0
        else:
            silence_blocks = 0
            fresh_onset = anchor <= 0.0
            plausible_vs_anchor = (not fresh_onset) and (raw < anchor * JUMP_MAX_RATIO and raw > anchor / JUMP_MAX_RATIO)
            if plausible_vs_anchor:
                anchor = raw
                candidate = 0.0
                streak = 0
            else:
                candidate_plausible = candidate > 0.0 and raw < candidate * JUMP_MAX_RATIO and raw > candidate / JUMP_MAX_RATIO
                if candidate_plausible:
                    streak += 1
                else:
                    candidate = raw
                    streak = 1
                octave_up = (raw / (anchor * 2.0)) if not fresh_onset else 1.0
                octave_down = (raw / (anchor * 0.5)) if not fresh_onset else 1.0
                octave_suspicious = (not fresh_onset) and (
                    (OCTAVE_TOLERANCE_RATIO > octave_up > 1.0 / OCTAVE_TOLERANCE_RATIO)
                    or (OCTAVE_TOLERANCE_RATIO > octave_down > 1.0 / OCTAVE_TOLERANCE_RATIO)
                )
                required = OCTAVE_CONFIRM_BLOCKS if octave_suspicious else JUMP_CONFIRM_BLOCKS
                if streak >= required:
                    anchor = raw
                    candidate = 0.0
                    streak = 0
        out_val = 0.0 if silence_blocks >= SILENCE_RESET_BLOCKS else anchor
        # replicate this block-value across all 64 samples in the block for per-sample feed
        outputs.extend([out_val] * BLOCK_SIZE)
    return np.array(outputs)


def render(code, inputs_dict, flags, duration_s):
    """inputs_dict: name -> np.ndarray (1, N). Renders via a full FaustProcessor with automation."""
    import dawdreamer as daw
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    fp = engine.make_faust_processor("fx")
    fp.set_dsp_string(code)
    fp.compile_flags = flags
    if not fp.compile():
        print("COMPILE FAILED", file=sys.stderr)
        return None
    params = fp.get_parameters_description()
    names = [p["name"] for p in params]
    print("params:", names, file=sys.stderr)

    dry_audio = inputs_dict["dry"]
    playback = engine.make_playback_processor("dry_in", dry_audio)
    engine.load_graph([(playback, []), (fp, ["dry_in"])])

    # automate extFreqDet, formant=0, targetNote via set_automation where available
    n_samples = dry_audio.shape[1]
    automations = {}
    if "freqDet" in " ".join(names) or any("extFreqDet" in n for n in names):
        pass

    return fp, names


def main():
    code = DSP_PATH.read_text()
    data, sr = sf.read(str(CORPUS), always_2d=True)
    mono = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        n_out = int(round(len(mono) * SAMPLE_RATE / sr))
        x_old = np.linspace(0, 1, len(mono), endpoint=False)
        x_new = np.linspace(0, 1, n_out, endpoint=False)
        mono = np.interp(x_new, x_old, mono)
    peak = np.max(np.abs(mono)) or 1.0
    mono = (mono / peak * 0.8).astype(np.float64)

    freq_track = np.load(FREQTRACK)
    guarded = simulate_cpp_guard(freq_track)
    n = min(len(mono), len(guarded))
    mono = mono[:n].reshape(1, -1)

    import dawdreamer as daw
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    fp = engine.make_faust_processor("fx")
    fp.set_dsp_string(code)
    fp.compile_flags = SHIPPED_FLAGS
    ok = fp.compile()
    print("compile ok:", ok, file=sys.stderr)
    if not ok:
        return 1
    params = fp.get_parameters_description()
    for p in params:
        print(" param:", p["name"], p.get("minValue"), p.get("maxValue"), p.get("defaultValue"), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
