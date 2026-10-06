import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

MAX_CENTS = 100.0

WINDOW_S = 0.2
SETTLE_S = 0.10


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def timbre_shift_tone(n, f0_hz, f0_start=1.0, f0_end=0.05, h2_start=0.3, h2_end=1.0,
                      ramp_start=0.2, ramp_end=3.0):
    t = np.arange(n) / SAMPLE_RATE
    frac = np.clip((t - ramp_start) / (ramp_end - ramp_start), 0.0, 1.0)
    a0 = f0_start + (f0_end - f0_start) * frac
    a2 = h2_start + (h2_end - h2_start) * frac
    sig = a0 * np.sin(2 * np.pi * f0_hz * t) + a2 * np.sin(2 * np.pi * f0_hz * 2.0 * t)
    sig = sig / np.max(np.abs(sig)) * 0.7
    attack = int(0.01 * SAMPLE_RATE)
    env = np.ones(n)
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return sig * env


def render_detected(dsp_text, sig, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    playback = engine.make_playback_processor("in", sig.reshape(1, -1))
    faust = compile_processor(engine, dsp_text, "ac_tracker")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def window_means(y, f0_hz):
    win = int(WINDOW_S * SAMPLE_RATE)
    start = int(SETTLE_S * SAMPLE_RATE)
    rows = []
    i = start
    while i + win <= len(y):
        seg = y[i:i + win]
        mean_hz = float(np.mean(seg))
        rows.append(((i + win / 2) / SAMPLE_RATE, mean_hz, 1200.0 * np.log2(mean_hz / f0_hz)))
        i += win
    return rows


def main():
    print("pitchtracker_ac.dsp octave stability under a real timbre shift")
    print(f"DSP: {DSP_PATH}")
    print("A sustained note whose 2nd harmonic overtakes its own fundamental (fundamental 1.0 ->")
    print("0.05, 2nd harmonic 0.3 -> 1.0 across 0.2s-3.0s) is the documented real-world octave-swap")
    print("trigger: the spectral peak moves an octave while the true fundamental stays present, just")
    print("quieter. A tracker that follows the loudest component jumps to 440Hz here; one that keeps")
    print(f"the fundamental stays at 220Hz. Gate: no 200ms window past {SETTLE_S:.2f}s may deviate")
    print(f"more than {MAX_CENTS:.0f}c from the true fundamental -- an octave error reads 1200c.")

    text = DSP_PATH.read_text()
    failures = []
    for f0_hz in (110.0, 220.0, 440.0):
        dur = 3.4
        n = int(dur * SAMPLE_RATE)
        sig = timbre_shift_tone(n, f0_hz)
        y = render_detected(text, sig, dur)
        rows = window_means(y, f0_hz)
        worst = max((abs(c) for _, _, c in rows), default=0.0)
        print(f"  f0={f0_hz:6.1f}Hz: " + " ".join(f"t{t:.1f}={hz:6.1f}Hz({c:+.0f}c)" for t, hz, c in rows))
        ok = worst < MAX_CENTS
        print(f"    -> worst={worst:.1f}c ({'OK' if ok else 'FAIL'})")
        if not ok:
            failures.append(f"{f0_hz}Hz worst={worst:.1f}c >= {MAX_CENTS:.0f}c limit")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("PASSED: a 2nd harmonic overtaking its own fundamental never moves the tracked pitch.")
    sys.exit(0)


if __name__ == "__main__":
    main()
