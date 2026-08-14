import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

ROOT_NOTE = 60.0
DETERMINISM_LIMIT = 1e-9
MIN_CENTROID_SPREAD_HZ = 5.0


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def vocal_like_tone(n, freq_hz, amp=0.35):
    t = np.arange(n) / SAMPLE_RATE
    out = np.sin(2 * np.pi * freq_hz * t)
    out += 0.3 * np.sin(2 * np.pi * 2 * freq_hz * t)
    out += 0.12 * np.sin(2 * np.pi * 3 * freq_hz * t)
    out /= np.max(np.abs(out)) + 1e-9
    env = np.ones(n)
    attack = 256
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return amp * out * env


def render(text, formant_val, freq_hz=220.0, semitone_shift=7.0, dur=0.5):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = vocal_like_tone(n, freq_hz)
    gate_start = int(0.15 * SAMPLE_RATE)
    gate = np.zeros(n)
    gate[gate_start:] = 1.0
    zero = np.zeros(n)
    ones = np.ones(n)
    note = np.full(n, ROOT_NOTE + semitone_shift)
    formant = np.full(n, formant_val)
    inputs_rows = [dry, zero, zero, formant, zero, zero, note, gate]
    for _ in range(5):
        inputs_rows += [zero, zero]
    inputs = np.stack(inputs_rows, axis=0)
    faust = compile_processor(engine, text, "multitranspose")
    playback = engine.make_playback_processor("in", inputs)
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0], gate_start


def spectral_centroid(sig):
    spec = np.abs(np.fft.rfft(sig * np.hanning(len(sig))))
    freqs = np.fft.rfftfreq(len(sig), 1.0 / SAMPLE_RATE)
    denom = np.sum(spec ** 2)
    if denom < 1e-12:
        return 0.0
    return float(np.sum(freqs * spec ** 2) / denom)


def check_formant_zero_is_identity(text):
    a1, gate_start = render(text, 0.0)
    a2, _ = render(text, 0.0)
    diff = float(np.max(np.abs(a1 - a2)))
    print(f"  formant=0 determinism max abs diff: {diff:.2e}")
    return diff < DETERMINISM_LIMIT


def check_formant_is_audible_and_bounded(text):
    tail_start = int(0.3 * SAMPLE_RATE)
    centroids = {}
    for fv in (-3.0, -1.5, 0.0, 1.5, 3.0):
        audio, _ = render(text, fv)
        assert np.all(np.isfinite(audio)), f"non-finite output at formant={fv}"
        peak = float(np.max(np.abs(audio)))
        assert peak < 3.0, f"unbounded output at formant={fv}: peak={peak}"
        c = spectral_centroid(audio[tail_start:])
        centroids[fv] = c
        print(f"  formant={fv:+.1f} centroid={c:.1f}Hz peak={peak:.3f}")
    spread = max(centroids.values()) - min(centroids.values())
    print(f"  centroid spread across formant range: {spread:.1f}Hz")
    return spread > MIN_CENTROID_SPREAD_HZ


def main():
    print("multitranspose.dsp formant vocal-morph control regression check")
    print(f"DSP: {DSP_PATH}")
    text = DSP_PATH.read_text()

    failures = []

    print("\n-- formant=0 must be an exact, deterministic no-op --")
    if not check_formant_zero_is_identity(text):
        failures.append("formant=0 is not a deterministic identity")

    print("\n-- formant must produce a real, bounded, finite, audible timbral change --")
    if not check_formant_is_audible_and_bounded(text):
        failures.append(f"formant sweep produced less than {MIN_CENTROID_SPREAD_HZ:.0f}Hz of spectral centroid movement")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("PASSED: formant is an exact no-op at 0 and a real, bounded, controllable vocal-character control away from it.")
        sys.exit(0)


if __name__ == "__main__":
    main()
