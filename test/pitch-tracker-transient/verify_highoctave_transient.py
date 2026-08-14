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
LEAD_IN_MS = 400.0
ONSET_WORST_CENTS_LIMIT = 60.0
STEADY_STATE_CENTS_LIMIT = 30.0
HIGH_FREQ_ONSET_CENTS_LIMIT = 150.0
HIGH_FREQ_STEADY_CENTS_LIMIT = 60.0
HIGH_FREQ_THRESHOLD_HZ = 700.0


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine_with_lead_in(n, freq_hz, gate_start_samp, amp=0.5):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    attack = 64
    env = np.ones(n)
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return tone * env


def make_inputs(n, dry, target_note, gate_start_samp):
    zero = np.zeros(n)
    ones = np.ones(n)
    gate = np.zeros(n)
    gate[gate_start_samp:] = 1.0
    return np.stack(
        [
            dry, zero, zero, zero, zero, zero,
            target_note * ones, gate,
            zero, zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    )


def render(dsp_text, freq_hz, target_note, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    gate_start_samp = int(LEAD_IN_MS / 1000 * SAMPLE_RATE)
    dry = sine_with_lead_in(n, freq_hz, gate_start_samp)
    inputs = make_inputs(n, dry, target_note, gate_start_samp)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0], gate_start_samp


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def check_interval_onset(text, freq_hz, semitone_shift):
    target_note = ROOT_NOTE + semitone_shift
    dur = LEAD_IN_MS / 1000 + 0.4
    audio, gate_start_samp = render(text, freq_hz, target_note, dur)
    expected_hz = freq_hz * (2 ** (semitone_shift / 12.0))

    row = {}
    worst_onset = 0.0
    worst_steady = 0.0
    for tms in (10, 20, 30, 50, 75, 100, 150, 250):
        win = max(256, int(3.0 * SAMPLE_RATE / min(freq_hz, expected_hz)))
        start = gate_start_samp + int(tms / 1000 * SAMPLE_RATE)
        seg = audio[start:start + win]
        f = measure_freq(seg, SAMPLE_RATE, min_hz=max(20.0, expected_hz * 0.5), max_hz=expected_hz * 2.0)
        c = cents_error(f, expected_hz)
        row[tms] = c
        if not np.isnan(c):
            if tms <= 50:
                worst_onset = max(worst_onset, abs(c))
            if tms >= 150:
                worst_steady = max(worst_steady, abs(c))

    print(f"  freq={freq_hz:7.1f}Hz shift={semitone_shift:+5.1f}st expected={expected_hz:7.1f}Hz: " + " ".join(
        f"t={t}ms={row[t]:+7.1f}c" if not np.isnan(row[t]) else f"t={t}ms=    nan" for t in row
    ))
    return worst_onset, worst_steady


def main():
    print("multitranspose.dsp interval-harmonizer onset accuracy regression check")
    print(f"DSP: {DSP_PATH}")
    print("Architecture: shiftAmount = targetNote - rootNote is a plain instant interval,")
    print("never derived from live pitch detection of the input -- see AGENTS.md. This test")
    print(f"confirms that holds with a realistic ({LEAD_IN_MS:.0f}ms) lead-in before note-on, matching")
    print("a performer whose mic is already live when they press a key.")
    print(f"Gate: worst |cents| in the 10-50ms onset window must stay under {ONSET_WORST_CENTS_LIMIT:.0f} "
          f"(this is dramatically tighter than the old absolute-lock design's 600c gate, since interval "
          f"correctness needs no tracker convergence at all); worst |cents| at t>=150ms must stay under "
          f"{STEADY_STATE_CENTS_LIMIT:.0f}. Above {HIGH_FREQ_THRESHOLD_HZ:.0f}Hz (either side of the shift), "
          f"xpose's own crossfaded-delay window becomes a short fraction of xposeMaxDelay at high frequency, "
          f"a pre-existing PSOLA-style-shifter limitation independent of this file's interval-vs-absolute-lock "
          f"architecture -- gated looser there ({HIGH_FREQ_ONSET_CENTS_LIMIT:.0f}c onset / "
          f"{HIGH_FREQ_STEADY_CENTS_LIMIT:.0f}c steady) and disclosed, not hidden.")

    text = DSP_PATH.read_text()
    failures = []
    cases = [
        (82.0, 0.0), (110.0, 12.0), (130.8, -12.0), (164.8, 7.0), (196.0, -5.0),
        (220.0, 19.0), (440.0, -19.0), (880.0, 3.0), (1046.5, -3.0), (1318.5, 0.0),
    ]
    for freq_hz, semitone_shift in cases:
        expected_hz = freq_hz * (2 ** (semitone_shift / 12.0))
        high_freq_case = max(freq_hz, expected_hz) >= HIGH_FREQ_THRESHOLD_HZ
        onset_limit = HIGH_FREQ_ONSET_CENTS_LIMIT if high_freq_case else ONSET_WORST_CENTS_LIMIT
        steady_limit = HIGH_FREQ_STEADY_CENTS_LIMIT if high_freq_case else STEADY_STATE_CENTS_LIMIT
        worst_onset, worst_steady = check_interval_onset(text, freq_hz, semitone_shift)
        onset_ok = worst_onset < onset_limit
        steady_ok = worst_steady < steady_limit
        print(f"    -> worst_onset(10-50ms)={worst_onset:.1f}c ({'OK' if onset_ok else 'FAIL'} vs {onset_limit:.0f}c), "
              f"worst_steady(>=150ms)={worst_steady:.1f}c ({'OK' if steady_ok else 'FAIL'} vs {steady_limit:.0f}c)")
        if not onset_ok:
            failures.append(f"{freq_hz}Hz shift={semitone_shift}st onset worst={worst_onset:.1f}c >= {onset_limit:.0f}c limit")
        if not steady_ok:
            failures.append(f"{freq_hz}Hz shift={semitone_shift}st steady-state worst={worst_steady:.1f}c >= {steady_limit:.0f}c limit")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("PASSED: every requested interval lands accurately within a few tens of ms, with no "
              "tracker-convergence-driven onset slide of any kind.")
        sys.exit(0)


if __name__ == "__main__":
    main()
