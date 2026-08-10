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

ONSET_WORST_CENTS_LIMIT = 600.0
STEADY_STATE_CENTS_LIMIT = 20.0


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine_transient(n, freq_hz, attack_samples=64, amp=0.9):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, attack_samples)
    env[:attack_samples] = ramp
    return tone * env


def make_inputs(n, dry, free, formant, target_note, gate):
    zero = np.zeros(n)
    ones = np.ones(n)
    return np.stack(
        [
            dry,
            zero,
            free * ones,
            formant * ones,
            target_note * ones,
            gate * ones,
            zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    )


def render(dsp_text, freq_hz, target_note, formant=0.0, dur=0.4):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = sine_transient(n, freq_hz)
    inputs = make_inputs(n, dry, 0.0, formant, target_note, 1.0)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def check_unison_lock_onset(freq_hz):
    text = DSP_PATH.read_text()
    target_note = 69.0 + 12.0 * np.log2(freq_hz / 440.0)
    audio = render(text, freq_hz, target_note)

    row = {}
    worst_onset = 0.0
    worst_steady = 0.0
    for tms in (10, 20, 30, 50, 75, 100, 150, 250):
        win = max(256, int(3.0 * SAMPLE_RATE / freq_hz))
        start = int(tms / 1000 * SAMPLE_RATE)
        seg = audio[start:start + win]
        f = measure_freq(seg, SAMPLE_RATE, min_hz=40.0, max_hz=2000.0)
        c = cents_error(f, freq_hz)
        row[tms] = c
        if not np.isnan(c):
            if tms <= 50:
                worst_onset = max(worst_onset, abs(c))
            if tms >= 150:
                worst_steady = max(worst_steady, abs(c))

    print(f"  {freq_hz:7.1f}Hz: " + " ".join(
        f"t={t}ms={row[t]:+7.1f}c" if not np.isnan(row[t]) else f"t={t}ms=    nan" for t in row
    ))
    return worst_onset, worst_steady


def main():
    print("multitranspose.dsp onset pitch-lock regression check (unison-lock, low + high octaves)")
    print(f"DSP: {DSP_PATH}")
    print(f"Gate: worst |cents| in the 10-50ms onset window must stay under {ONSET_WORST_CENTS_LIMIT:.0f} "
          f"(a full octave is 1200 -- this catches the floor-pinned-detNote octave-slide bug); "
          f"worst |cents| at t>=150ms must stay under {STEADY_STATE_CENTS_LIMIT:.0f} (steady-state tuning).")

    failures = []
    for freq_hz in (82.0, 110.0, 130.8, 164.8, 196.0, 220.0, 440.0, 880.0, 1046.5, 1318.5):
        worst_onset, worst_steady = check_unison_lock_onset(freq_hz)
        onset_ok = worst_onset < ONSET_WORST_CENTS_LIMIT
        steady_ok = worst_steady < STEADY_STATE_CENTS_LIMIT
        print(f"    -> worst_onset(10-50ms)={worst_onset:.1f}c ({'OK' if onset_ok else 'FAIL'}), "
              f"worst_steady(>=150ms)={worst_steady:.1f}c ({'OK' if steady_ok else 'FAIL'})")
        if not onset_ok:
            failures.append(f"{freq_hz}Hz onset worst={worst_onset:.1f}c >= {ONSET_WORST_CENTS_LIMIT:.0f}c limit")
        if not steady_ok:
            failures.append(f"{freq_hz}Hz steady-state worst={worst_steady:.1f}c >= {STEADY_STATE_CENTS_LIMIT:.0f}c limit")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("PASSED: no octave-scale onset slide and steady-state tuning is accurate at every tested frequency.")
        sys.exit(0)


if __name__ == "__main__":
    main()
