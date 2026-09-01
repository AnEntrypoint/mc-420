#!/usr/bin/env python3
"""Reproduce two specific reported symptoms against pitchtracker_ac.dsp:
1. 'ding ding ding' -- rapid percussive/staccato onsets, searches every time
2. Lowering voice pitch (descending) twitches an octave up/down
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"
WORKER = Path(__file__).with_name("_render_pitchtracker.py")


def synth_ding(freq_hz, n_dings, gap_s, dur_s, sr=SAMPLE_RATE):
    """Percussive clicks: sharp attack, fast decay, silence gaps between."""
    one_ding_n = int(dur_s * sr)
    gap_n = int(gap_s * sr)
    t = np.arange(one_ding_n) / sr
    envelope = np.exp(-t * 25.0)
    tone = np.sin(2 * np.pi * freq_hz * t) * envelope
    silence = np.zeros(gap_n)
    signal = np.concatenate([tone, silence] * n_dings)
    return signal.astype(np.float64).reshape(1, -1)


def synth_descend(start_hz, end_hz, dur_s, sr=SAMPLE_RATE):
    """Smooth vocal-like descending glide with slight vibrato + harmonics."""
    n = int(dur_s * sr)
    t = np.arange(n) / sr
    freq_t = start_hz + (end_hz - start_hz) * (t / dur_s)
    vibrato = 1.0 + 0.01 * np.sin(2 * np.pi * 5.0 * t)
    freq_t = freq_t * vibrato
    phase = np.cumsum(2 * np.pi * freq_t / sr)
    fundamental = np.sin(phase)
    harmonic2 = 0.4 * np.sin(2 * phase)
    harmonic3 = 0.2 * np.sin(3 * phase)
    envelope = np.ones(n)
    fade = int(0.02 * sr)
    envelope[:fade] = np.linspace(0, 1, fade)
    envelope[-fade:] = np.linspace(1, 0, fade)
    signal = (fundamental + harmonic2 + harmonic3) * envelope * 0.6
    return signal.astype(np.float64).reshape(1, -1)


def render(code, input_audio, work_dir):
    code_path = work_dir / "dsp_code.txt"
    input_path = work_dir / "input.npy"
    output_path = work_dir / "output.npy"
    code_path.write_text(code)
    np.save(input_path, input_audio)
    proc = subprocess.run(
        [sys.executable, str(WORKER), str(code_path), json.dumps(SHIPPED_FLAGS),
         str(input_path), str(output_path), str(SAMPLE_RATE), str(BLOCK_SIZE)],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0:
        print("RENDER FAILED", proc.stdout, proc.stderr, file=sys.stderr)
        return None
    out = np.load(str(output_path))
    return out[0] if out.ndim > 1 else out


def detect_jumps(freq_track, sr):
    events = []
    prev = None
    for i in range(1, len(freq_track)):
        f = freq_track[i]
        if f <= 0 or prev is None or prev <= 0:
            prev = f
            continue
        r = f / prev
        if r > 1.5 or r < 0.667:
            events.append({"sample": i, "time_s": round(i / sr, 4),
                            "from_hz": round(prev, 2), "to_hz": round(f, 2), "ratio": round(r, 3)})
        prev = f
    return events


def main():
    code = DSP_PATH.read_text()
    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)

        print("=== TEST 1: ding ding ding (percussive staccato, 220Hz, 5 dings) ===")
        ding_audio = synth_ding(220.0, n_dings=5, gap_s=0.15, dur_s=0.12)
        freq_track = render(code, ding_audio, work_dir)
        if freq_track is not None:
            events = detect_jumps(freq_track, SAMPLE_RATE)
            print(f"  {len(events)} jump events")
            for e in events[:20]:
                print("   ", e)

        print("\n=== TEST 2: descending pitch glide (220Hz -> 110Hz over 3s, vocal-like) ===")
        descend_audio = synth_descend(220.0, 110.0, 3.0)
        freq_track2 = render(code, descend_audio, work_dir)
        if freq_track2 is not None:
            events2 = detect_jumps(freq_track2, SAMPLE_RATE)
            print(f"  {len(events2)} jump events")
            for e in events2[:20]:
                print("   ", e)

    return 0


if __name__ == "__main__":
    sys.exit(main())
