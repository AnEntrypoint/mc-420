import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

MAX_STEADY_CENTS = 30.0

GATED_FREQS = (82.0, 110.0, 130.8, 164.8, 196.0, 220.0, 246.9, 440.0, 880.0, 1318.5, 1046.5)


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def harmonic_tone(n, freq_hz, sr=SAMPLE_RATE, n_harmonics=6, amp=0.7, attack=200):
    t = np.arange(n) / sr
    sig = np.zeros(n)
    for k in range(1, n_harmonics + 1):
        sig += (1.0 / k) * np.sin(2 * np.pi * freq_hz * k * t)
    sig = sig / np.max(np.abs(sig)) * amp
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, min(attack, n))
    env[: len(ramp)] = ramp
    return sig * env


def render_raw_detected_freq(dsp_text, freq_hz, dur=1.0):
    idx = dsp_text.index("process(sig)")
    probe_dsp = dsp_text[:idx] + "process(x) = detectedFreq(x) : (_,!) : max(minTrackHz) : min(maxTrackHz);\n"
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = harmonic_tone(n, freq_hz)
    playback = engine.make_playback_processor("in", dry.reshape(1, -1))
    faust = compile_processor(engine, probe_dsp, "ac_tracker")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def steady_state_cents(y, freq_hz, t_start=0.15, t_end=1.0):
    i0 = int(t_start * SAMPLE_RATE)
    i1 = int(t_end * SAMPLE_RATE)
    mean_hz = float(np.mean(y[i0:i1]))
    return 1200.0 * np.log2(mean_hz / freq_hz)


def main():
    print("pitchtracker_ac.dsp steady-state accuracy on harmonically-rich content")
    print(f"DSP: {DSP_PATH}")
    print(f"Gate: |mean cents error| over 150ms-1000ms must stay under {MAX_STEADY_CENTS}")
    text = DSP_PATH.read_text()
    all_ok = True
    for f in GATED_FREQS:
        y = render_raw_detected_freq(text, f)
        err = steady_state_cents(y, f)
        ok = abs(err) < MAX_STEADY_CENTS
        all_ok = all_ok and ok
        print(f"    {f:8.1f}Hz -> {err:+7.1f}c ({'OK' if ok else 'FAIL'})")

    print()
    if all_ok:
        print("PASSED: pitchtracker_ac.dsp steady-state accuracy is within tolerance on the gated frequency set.")
    else:
        print("FAILED: pitchtracker_ac.dsp steady-state bias regressed on the gated frequency set.")
        sys.exit(1)


if __name__ == "__main__":
    main()
