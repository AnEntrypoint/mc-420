import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pitch_measure import measure_freq

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

ROOT_NOTE = 60.0
CHORD_CENTS_LIMIT = 40.0
STEAL_CLICK_RATIO_LIMIT = 6.0
SILENT_LIMIT = 1e-6


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine(n, freq_hz, amp=0.35):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    attack = 256
    env = np.ones(n)
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return tone * env


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def run(text, inputs, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def check_disabled_silent(text):
    dur = 0.3
    n = int(dur * SAMPLE_RATE)
    dry = sine(n, 220.0)
    inputs = np.zeros((17, n), dtype=np.float64)
    inputs[0] = dry
    audio = run(text, inputs, dur)
    peak = float(np.max(np.abs(audio)))
    print(f"  disabled-state peak amplitude: {peak:.2e}")
    return peak < SILENT_LIMIT


def check_chord(text):
    dur = 0.6
    n = int(dur * SAMPLE_RATE)
    dry = sine(n, 220.0)
    gate_start = int(0.4 * SAMPLE_RATE)
    gate = np.zeros(n)
    gate[gate_start:] = 1.0
    zero = np.zeros(n)
    # Absolute pitch-lock: each voice's target is the KEY itself, independent
    # of the 220Hz dry input -- unison/major-3rd/5th expressed as target MIDI
    # notes relative to ROOT_NOTE, not as shift amounts from the input pitch.
    target_notes = [ROOT_NOTE, ROOT_NOTE + 4.0, ROOT_NOTE + 7.0]
    # dry, loopSum, free, formant, extFreqDet, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5 (17 total)
    inputs_rows = [dry, zero, zero, zero, zero]
    for note in target_notes:
        inputs_rows += [np.full(n, note), gate]
    for _ in range(3):
        inputs_rows += [zero, zero]
    inputs = np.stack(inputs_rows, axis=0)
    audio = run(text, inputs, dur)

    seg = audio[gate_start + int(0.15 * SAMPLE_RATE): gate_start + int(0.45 * SAMPLE_RATE)]
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / SAMPLE_RATE)
    worst = 0.0
    results = []
    for note in target_notes:
        shift = note - ROOT_NOTE
        expected_hz = midi_to_hz(note)
        band = (freqs > expected_hz * 0.85) & (freqs < expected_hz * 1.15)
        if not np.any(band):
            results.append((shift, expected_hz, None, float("nan")))
            continue
        band_idx = np.where(band)[0]
        band_spec = spectrum[band_idx]
        rel_peak = int(np.argmax(band_spec))
        peak_idx = band_idx[rel_peak]
        bin_hz = freqs[1] - freqs[0]
        if 0 < rel_peak < len(band_idx) - 1:
            y0, y1, y2 = spectrum[peak_idx - 1], spectrum[peak_idx], spectrum[peak_idx + 1]
            denom = y0 - 2.0 * y1 + y2
            delta = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-12 else 0.0
            delta = max(-1.0, min(1.0, delta))
        else:
            delta = 0.0
        peak_hz = float(freqs[peak_idx] + delta * bin_hz)
        c = cents_error(peak_hz, expected_hz)
        results.append((shift, expected_hz, peak_hz, c))
        if not np.isnan(c):
            worst = max(worst, abs(c))
    for shift, expected_hz, f, c in results:
        print(f"  chord voice shift={shift:+.1f}st expected={expected_hz:.1f}Hz nearest-peak={f}Hz cents={c:.1f}")
    print(f"  worst chord |cents|: {worst:.1f}")
    return worst < CHORD_CENTS_LIMIT


def check_voice_steal(text):
    dur = 0.5
    n = int(dur * SAMPLE_RATE)
    dry = sine(n, 220.0, amp=0.4)
    gate = np.ones(n)
    gate[:int(0.05 * SAMPLE_RATE)] = 0.0
    note = np.full(n, ROOT_NOTE)
    steal_sample = int(0.3 * SAMPLE_RATE)
    note[steal_sample:] = ROOT_NOTE + 12.0
    zero = np.zeros(n)
    inputs_rows = [dry, zero, zero, zero, zero, note, gate]
    for _ in range(5):
        inputs_rows += [zero, zero]
    inputs = np.stack(inputs_rows, axis=0)
    audio = run(text, inputs, dur)

    deriv = np.abs(np.diff(audio))
    steal_window = deriv[max(0, steal_sample - 8): steal_sample + 400]
    bg_start = int(0.15 * SAMPLE_RATE)
    bg_window = deriv[bg_start: bg_start + 4000]
    steal_peak = float(np.max(steal_window))
    bg_peak = float(np.max(bg_window)) + 1e-9
    ratio = steal_peak / bg_peak
    finite = bool(np.all(np.isfinite(audio)))
    print(f"  voice-steal deriv peak={steal_peak:.4f} background deriv peak={bg_peak:.4f} ratio={ratio:.2f} finite={finite}")
    return finite and ratio < STEAL_CLICK_RATIO_LIMIT


def main():
    print("multitranspose.dsp chord correctness + voice-steal click-safety regression check")
    print(f"DSP: {DSP_PATH}")
    text = DSP_PATH.read_text()

    failures = []

    print("\n-- disabled state must be exactly silent --")
    if not check_disabled_silent(text):
        failures.append("disabled state was not silent")

    print("\n-- a held 3-note chord (unison / major 3rd / 5th) must land each voice accurately --")
    if not check_chord(text):
        failures.append(f"chord accuracy exceeded {CHORD_CENTS_LIMIT:.0f}c on at least one voice")

    print("\n-- voice steal (continuous gate, note changes) must not click or produce non-finite output --")
    if not check_voice_steal(text):
        failures.append("voice steal produced an excessive click or non-finite output")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("PASSED: disabled-state silence, chord accuracy, and voice-steal click-safety all hold.")
        sys.exit(0)


if __name__ == "__main__":
    main()
