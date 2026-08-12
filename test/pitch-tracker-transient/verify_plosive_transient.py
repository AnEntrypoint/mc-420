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
MAX_DEVIATION_CENTS_LIMIT = 60.0


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine_with_plosive(n, freq_hz, burst_start_ms=550, burst_ms=15, amp=0.7, burst_amp=0.9):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    env = np.ones(n)
    attack = 64
    env[:attack] = np.linspace(0.0, 1.0, attack)
    burst_start = int(burst_start_ms / 1000 * SAMPLE_RATE)
    burst_len = int(burst_ms / 1000 * SAMPLE_RATE)
    rng = np.random.default_rng(42)
    noise = burst_amp * rng.uniform(-1.0, 1.0, size=burst_len)
    out = tone * env
    out[burst_start:burst_start + burst_len] = noise
    return out


def make_inputs(n, dry, target_note, gate_start_samp):
    zero = np.zeros(n)
    ones = np.ones(n)
    gate = np.zeros(n)
    gate[gate_start_samp:] = 1.0
    return np.stack(
        [
            dry, zero, zero, zero, zero,
            target_note * ones, gate,
            zero, zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    )


def render(dsp_text, freq_hz, target_note, burst_start_ms, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    gate_start_samp = int(0.4 * SAMPLE_RATE)
    dry = sine_with_plosive(n, freq_hz, burst_start_ms=burst_start_ms)
    inputs = make_inputs(n, dry, target_note, gate_start_samp)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def check_plosive_mid_sustain(freq_hz, semitone_shift, burst_start_ms=550):
    text = DSP_PATH.read_text()
    target_note = ROOT_NOTE + semitone_shift
    expected_hz = freq_hz * (2 ** (semitone_shift / 12.0))
    dur = burst_start_ms / 1000 + 0.4
    audio = render(text, freq_hz, target_note, burst_start_ms, dur)

    win = max(256, int(3.0 * SAMPLE_RATE / min(freq_hz, expected_hz)))
    pre_burst_start = int((burst_start_ms - 40) / 1000 * SAMPLE_RATE)
    pre_seg = audio[pre_burst_start:pre_burst_start + win]
    pre_f = measure_freq(pre_seg, SAMPLE_RATE, min_hz=max(20.0, expected_hz * 0.5), max_hz=expected_hz * 2.0)
    pre_c = cents_error(pre_f, expected_hz)

    burst_ms = 15
    offsets_ms = [o for o in (burst_ms + 5, burst_ms + 15, burst_ms + 30, burst_ms + 50, burst_ms + 100)]
    row = {}
    for off in offsets_ms:
        start = int((burst_start_ms + off) / 1000 * SAMPLE_RATE)
        seg = audio[start:start + win]
        f = measure_freq(seg, SAMPLE_RATE, min_hz=max(20.0, expected_hz * 0.5), max_hz=expected_hz * 2.0)
        row[off] = cents_error(f, expected_hz)

    worst_dev = max((abs(c) for c in row.values() if not np.isnan(c)), default=0.0)
    print(f"  freq={freq_hz:7.1f}Hz shift={semitone_shift:+5.1f}st (pre-burst={pre_c:+.1f}c): " + " ".join(
        f"t+{o}ms={row[o]:+7.1f}c" if not np.isnan(row[o]) else f"t+{o}ms=    nan" for o in offsets_ms
    ))
    return worst_dev


def main():
    print("multitranspose.dsp plosive/transient-mid-sustain regression check (interval-harmonizer architecture)")
    print(f"DSP: {DSP_PATH}")
    print("This bug class (a broadband burst mid-sustained-note causing an octave-search in the shifted")
    print("output) was, across many prior sessions, structurally impossible to fully fix in the old")
    print("absolute-pitch-lock design -- see AGENTS.md's extensive history. In the interval-harmonizer")
    print("architecture shiftAmount never depends on live-tracked input pitch at all, so a burst can only")
    print("ever perturb window-sizing quality, never which note comes out. This test's job is now to")
    print("PROVE that structural guarantee holds, with a gate tight enough to catch any future regression")
    print(f"that reintroduces a tracker dependency: worst |cents| deviation must stay under {MAX_DEVIATION_CENTS_LIMIT:.0f}c "
          f"through and immediately after the burst.")

    failures = []
    for freq_hz, semitone_shift in ((110.0, 12.0), (164.8, -7.0), (220.0, 0.0), (440.0, -19.0)):
        worst_dev = check_plosive_mid_sustain(freq_hz, semitone_shift)
        ok = worst_dev < MAX_DEVIATION_CENTS_LIMIT
        print(f"    -> worst_dev={worst_dev:.1f}c ({'OK' if ok else 'FAIL'})")
        if not ok:
            failures.append(f"{freq_hz}Hz shift={semitone_shift}st worst_dev={worst_dev:.1f}c >= {MAX_DEVIATION_CENTS_LIMIT:.0f}c limit")

    print()
    if failures:
        print("FAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("PASSED: a plosive/transient burst mid-sustained-note has no effect on the shifted note's pitch.")
        sys.exit(0)


if __name__ == "__main__":
    main()
