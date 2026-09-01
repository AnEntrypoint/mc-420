#!/usr/bin/env python3
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
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"
WORKER = Path(__file__).with_name("_render_pitchtracker.py")
CORPUS_DIR = REPO_ROOT / "test-audio-corpus" / "user-provided"


def load_wav_mono_48k(path: Path) -> np.ndarray:
    data, sr = sf.read(str(path), always_2d=True)
    mono = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        n_out = int(round(len(mono) * SAMPLE_RATE / sr))
        x_old = np.linspace(0.0, 1.0, len(mono), endpoint=False)
        x_new = np.linspace(0.0, 1.0, n_out, endpoint=False)
        mono = np.interp(x_new, x_old, mono)
    peak = np.max(np.abs(mono)) or 1.0
    mono = mono / peak * 0.8
    return mono.astype(np.float64).reshape(1, -1)


def detect_octave_jumps(freq_track: np.ndarray, sr: int):
    events = []
    prev = None
    for i in range(1, len(freq_track)):
        f = freq_track[i]
        if f <= 0 or prev is None or prev <= 0:
            prev = f
            continue
        ratio = f / prev
        if ratio > 1.7 or ratio < 0.59:
            events.append({
                "sample": i, "time_s": round(i / sr, 4),
                "from_hz": round(prev, 2), "to_hz": round(f, 2),
                "ratio": round(ratio, 3),
            })
        prev = f
    return events


def main():
    name = sys.argv[1]
    wav_path = CORPUS_DIR / name
    code = DSP_PATH.read_text()
    input_audio = load_wav_mono_48k(wav_path)
    duration_s = min(12.0, input_audio.shape[1] / SAMPLE_RATE)
    input_audio = input_audio[:, : int(duration_s * SAMPLE_RATE)]

    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)
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
            return 1
        out = np.load(str(output_path))
        freq_track = out[0] if out.ndim > 1 else out
        events = detect_octave_jumps(freq_track, SAMPLE_RATE)

        result = {
            "file": name, "duration_s": round(duration_s, 2),
            "n_jumps": len(events),
            "events": events,
        }
        np.save(Path(__file__).with_name(f"freqtrack_{name}.npy"), freq_track)
        out_json = Path(__file__).with_name(f"result_{name}.json")
        out_json.write_text(json.dumps(result, indent=2, default=float))
        print(f"{name}: {len(events)} jumps, saved {out_json.name}")
        for e in events[:15]:
            print("  ", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
