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


def render(code: str, input_audio: np.ndarray, work_dir: Path) -> np.ndarray:
    code_path = work_dir / "dsp_code.txt"
    input_path = work_dir / "input.npy"
    output_path = work_dir / "output.npy"
    code_path.write_text(code)
    np.save(input_path, input_audio)

    proc = subprocess.run(
        [
            sys.executable,
            str(WORKER),
            str(code_path),
            json.dumps(SHIPPED_FLAGS),
            str(input_path),
            str(output_path) + ".npy",
            str(SAMPLE_RATE),
            str(BLOCK_SIZE),
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )
    if proc.returncode != 0:
        print(f"  RENDER FAILED rc={proc.returncode}", file=sys.stderr)
        print(proc.stdout, file=sys.stderr)
        print(proc.stderr, file=sys.stderr)
        return None
    return np.load(str(output_path) + ".npy")


def detect_octave_jumps(freq_track: np.ndarray, sr: int):
    events = []
    prev = None
    prev_i = 0
    for i in range(1, len(freq_track)):
        f = freq_track[i]
        if f <= 0 or prev is None or prev <= 0:
            prev = f
            prev_i = i
            continue
        ratio = f / prev
        if ratio > 1.7 or ratio < 0.59:
            events.append({
                "sample": i,
                "time_s": round(i / sr, 4),
                "from_hz": round(prev, 2),
                "to_hz": round(f, 2),
                "ratio": round(ratio, 3),
            })
        prev = f
        prev_i = i
    return events


def main():
    if not DSP_PATH.exists():
        print(f"DSP not found: {DSP_PATH}", file=sys.stderr)
        return 1
    code = DSP_PATH.read_text()

    wav_files = sorted(CORPUS_DIR.glob("*.wav"))
    if not wav_files:
        print(f"No wavs in {CORPUS_DIR}", file=sys.stderr)
        return 1

    results = {}
    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)
        for wav_path in wav_files:
            print(f"=== {wav_path.name} ===", file=sys.stderr)
            try:
                input_audio = load_wav_mono_48k(wav_path)
            except Exception as e:
                print(f"  LOAD FAILED: {e}", file=sys.stderr)
                continue
            duration_s = input_audio.shape[1] / SAMPLE_RATE
            if duration_s > 12.0:
                input_audio = input_audio[:, : int(12.0 * SAMPLE_RATE)]
                duration_s = 12.0
            out = render(code, input_audio, work_dir)
            if out is None:
                results[wav_path.name] = {"error": "render_failed"}
                continue
            freq_track = out[0] if out.ndim > 1 else out
            events = detect_octave_jumps(freq_track, SAMPLE_RATE)
            results[wav_path.name] = {
                "duration_s": round(duration_s, 2),
                "n_samples": len(freq_track),
                "min_nonzero_hz": round(float(np.min(freq_track[freq_track > 0])), 2) if np.any(freq_track > 0) else None,
                "max_hz": round(float(np.max(freq_track)), 2),
                "octave_jump_events": events,
                "n_octave_jumps": len(events),
            }
            print(f"  jumps={len(events)} max_hz={results[wav_path.name]['max_hz']}", file=sys.stderr)

    out_path = Path(__file__).with_name("results.json")
    out_path.write_text(json.dumps(results, indent=2))
    total_jumps = sum(r.get("n_octave_jumps", 0) for r in results.values())
    print(f"\nTOTAL octave-jump events across corpus: {total_jumps}", file=sys.stderr)
    print(f"Results written to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
