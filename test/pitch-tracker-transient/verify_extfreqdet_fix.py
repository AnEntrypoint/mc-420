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

MAX_DEVIATION_CENTS_LIMIT = 600.0


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine_with_plosive(n, freq_hz, burst_start_ms=150, burst_ms=15, amp=0.7, burst_amp=0.9):
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


def make_inputs(n, dry, free, formant, ext_freq_det, target_note, gate):
    zero = np.zeros(n)
    ones = np.ones(n)
    return np.stack(
        [
            dry,
            zero,
            free * ones,
            formant * ones,
            ext_freq_det,
            target_note * ones,
            gate * ones,
            zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    )


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def render_with_extfreqdet(dsp_text, freq_hz, target_note, burst_start_ms, dur=0.6):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = sine_with_plosive(n, freq_hz, burst_start_ms=burst_start_ms)
    ext_freq_det = np.full(n, freq_hz, dtype=np.float64)
    inputs = make_inputs(n, dry, 0.0, 0.0, ext_freq_det, target_note, 1.0)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def check_extfreqdet_suppresses_search(freq_hz, burst_start_ms=150):
    text = DSP_PATH.read_text()
    target_note = 69.0 + 12.0 * np.log2(freq_hz / 440.0)
    audio = render_with_extfreqdet(text, freq_hz, target_note, burst_start_ms)

    burst_ms = 15
    win = max(256, int(3.0 * SAMPLE_RATE / freq_hz))
    win_ms = 1000.0 * win / SAMPLE_RATE
    offsets_ms = [burst_ms + win_ms + o for o in (5, 15, 30, 50, 75, 100, 150, 200)]
    row = {}
    for off in offsets_ms:
        start = int((burst_start_ms + off) / 1000 * SAMPLE_RATE)
        seg = audio[start:start + win]
        f = measure_freq(seg, SAMPLE_RATE, min_hz=40.0, max_hz=2000.0)
        row[off] = cents_error(f, freq_hz)

    worst_dev = max((abs(c) for c in row.values() if not np.isnan(c)), default=0.0)
    print(f"  {freq_hz:7.1f}Hz (extFreqDet held at true freq): " + " ".join(
        f"t+{o}ms={row[o]:+7.1f}c" if not np.isnan(row[o]) else f"t+{o}ms=    nan" for o in offsets_ms
    ))
    return worst_dev


def main():
    print("extFreqDet end-to-end fix check: does an external tracker holding the true freq through a plosive suppress the octave search?")
    print(f"DSP: {DSP_PATH}")
    print(f"Gate: worst |cents| deviation after burst must stay under {MAX_DEVIATION_CENTS_LIMIT}")
    freqs = [110.0, 164.8, 220.0, 440.0]
    all_ok = True
    for f in freqs:
        worst = check_extfreqdet_suppresses_search(f)
        ok = worst < MAX_DEVIATION_CENTS_LIMIT
        all_ok = all_ok and ok
        print(f"    -> worst_dev={worst:.1f}c ({'OK' if ok else 'FAIL'})")
    print()
    if all_ok:
        print("PASSED: extFreqDet, when held at the true frequency through a plosive burst, suppresses the octave search.")
    else:
        print("FAILED: extFreqDet does not suppress the octave search even when fed the true frequency.")
        sys.exit(1)


if __name__ == "__main__":
    main()
