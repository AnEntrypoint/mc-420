#!/usr/bin/env python3
"""Measure key-based pitch-lock accuracy across a frequency sweep to find
whether low pitches lock less firmly than high ones, using multitranspose.dsp
directly via DawDreamer. Compiles ONCE, renders all test frequencies
concatenated into a single pass (each frequency held constant for its own
segment, its own matching extFreqDet segment), then slices/measures each
segment from one render -- avoids the real per-file compile cost of this
DSP being paid 10x."""
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"


def hz_to_midi(f):
    return 69.0 + 12.0 * np.log2(f / 440.0)


def midi_to_hz(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def synth_tone(freq_hz, dur_s, sr=SAMPLE_RATE):
    n = int(dur_s * sr)
    t = np.arange(n) / sr
    fundamental = np.sin(2 * np.pi * freq_hz * t)
    h2 = 0.3 * np.sin(2 * np.pi * freq_hz * 2 * t)
    h3 = 0.15 * np.sin(2 * np.pi * freq_hz * 3 * t)
    env = np.ones(n)
    fade = int(0.01 * sr)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    return ((fundamental + h2 + h3) * env * 0.5).astype(np.float64)


def measure_output_pitch(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    if np.max(np.abs(seg)) < 1e-6:
        return 0.0
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    if dur <= 0:
        return 0.0
    return zc / (2.0 * dur)


def main():
    import dawdreamer as daw

    code = DSP_PATH.read_text()
    shift_semitones = 5.0  # constant, modest shift -- isolates pitch height from shift magnitude
    print(f"constant shift={shift_semitones} semitones from each input frequency", file=sys.stderr)

    test_freqs = [40, 55, 65, 80, 100, 130, 165, 220, 330, 440]
    seg_dur_s = 1.0
    seg_n = int(seg_dur_s * SAMPLE_RATE)

    dry_segs = []
    extfreq_segs = []
    n0_segs = []
    for f in test_freqs:
        dry_segs.append(synth_tone(f, seg_dur_s))
        extfreq_segs.append(np.full(seg_n, float(f)))
        target_note_f = hz_to_midi(f) + shift_semitones
        n0_segs.append(np.full(seg_n, target_note_f))
    dry_full = np.concatenate(dry_segs).reshape(1, -1)
    extfreq_full = np.concatenate(extfreq_segs).reshape(1, -1)
    n0_full = np.concatenate(n0_segs).reshape(1, -1)
    total_n = dry_full.shape[1]
    zero_loop = np.zeros((1, total_n), dtype=np.float64)

    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    fp = engine.make_faust_processor("fx")
    fp.set_dsp_string(code)
    fp.compile_flags = SHIPPED_FLAGS
    print("compiling...", file=sys.stderr)
    ok = fp.compile()
    print("compile ok:", ok, file=sys.stderr)
    if not ok:
        return 1

    zero_sig = np.zeros((1, total_n), dtype=np.float64)
    free_sig = np.zeros((1, total_n), dtype=np.float64)
    formant_sig = np.zeros((1, total_n), dtype=np.float64)
    n0_sig = n0_full
    g0_sig = np.ones((1, total_n), dtype=np.float64)

    playback_dry = engine.make_playback_processor("dry_in", dry_full)
    playback_loop = engine.make_playback_processor("loop_in", zero_loop)
    playback_free = engine.make_playback_processor("free_in", free_sig)
    playback_formant = engine.make_playback_processor("formant_in", formant_sig)
    playback_extfreq = engine.make_playback_processor("extfreq_in", extfreq_full)
    playback_n0 = engine.make_playback_processor("n0_in", n0_sig)
    playback_g0 = engine.make_playback_processor("g0_in", g0_sig)
    playback_zero_n = engine.make_playback_processor("zero_n_in", zero_sig)
    playback_zero_g = engine.make_playback_processor("zero_g_in", zero_sig)

    engine.load_graph([
        (playback_dry, []),
        (playback_loop, []),
        (playback_free, []),
        (playback_formant, []),
        (playback_extfreq, []),
        (playback_n0, []),
        (playback_g0, []),
        (playback_zero_n, []),
        (playback_zero_g, []),
        (fp, ["dry_in", "loop_in", "free_in", "formant_in", "extfreq_in",
              "n0_in", "g0_in"] + ["zero_n_in", "zero_g_in"] * 5),
    ])

    duration_s = total_n / SAMPLE_RATE
    print(f"rendering {duration_s:.1f}s in one pass...", file=sys.stderr)
    if not engine.render(duration_s):
        print("RENDER FAILED", file=sys.stderr)
        return 1
    audio = engine.get_audio()
    out = audio[0] if audio.ndim > 1 else audio
    print("output len:", len(out), "expected:", total_n, file=sys.stderr)
    np.save(Path(__file__).with_name("pitch_lock_test_output.npy"), out)
    np.save(Path(__file__).with_name("pitch_lock_test_input.npy"), dry_full[0])

    print("\n=== RESULTS (constant 5-semitone shift from each input) ===")
    for i, f in enumerate(test_freqs):
        start = i * seg_n
        end = start + seg_n
        seg = out[start:end]
        steady = seg[int(seg_n * 0.3):int(seg_n * 0.8)]
        measured_hz = measure_output_pitch(steady)
        target_note_f = hz_to_midi(f) + shift_semitones
        if measured_hz > 0:
            measured_note = hz_to_midi(measured_hz)
            cents_off = (measured_note - target_note_f) * 100
            print(f"input={f:>4}Hz target={target_note_f:6.2f} -> output={measured_hz:7.2f}Hz note={measured_note:6.2f} off={cents_off:+7.1f} cents")
        else:
            print(f"input={f:>4}Hz target={target_note_f:6.2f} -> output=SILENT/undetected")

    return 0


if __name__ == "__main__":
    sys.exit(main())
