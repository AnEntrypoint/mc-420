import subprocess
import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"
DSP_REL_PATH = "effects/home/faust/multitranspose.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

ROOT_NOTE = 60.0
LEAD_IN_MS = 400.0
STEADY_START_MS = 250.0
STEADY_DUR_MS = 200.0
HIGH_FREQ_CUTOFF_HZ = SAMPLE_RATE / 4.0

CASES = [(880.0, 3.0), (1046.5, -3.0), (1318.5, 0.0)]


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


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


def make_inputs(n, dry, target_note, gate_start_samp, freq_hz):
    zero = np.zeros(n)
    ones = np.ones(n)
    gate = np.zeros(n)
    gate[gate_start_samp:] = 1.0
    ext = np.full(n, freq_hz)
    return np.stack(
        [
            dry, zero, zero, zero, ext,
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
    inputs = make_inputs(n, dry, target_note, gate_start_samp, freq_hz)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0], gate_start_samp


def high_freq_energy_fraction(sig, sr, cutoff_hz):
    windowed = sig * np.hanning(len(sig))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(sig), 1.0 / sr)
    total = float(np.sum(spec ** 2)) + 1e-18
    high = float(np.sum(spec[freqs >= cutoff_hz] ** 2))
    return high / total


def spectral_flatness(sig):
    windowed = sig * np.hanning(len(sig))
    power = np.abs(np.fft.rfft(windowed)) ** 2
    power = power[1:]
    power = power[power > 0]
    if len(power) == 0:
        return float("nan")
    log_mean = float(np.mean(np.log(power)))
    geo_mean = np.exp(log_mean)
    arith_mean = float(np.mean(power))
    return geo_mean / arith_mean if arith_mean > 0 else float("nan")


def measure_case(dsp_text, freq_hz, semitone_shift):
    target_note = ROOT_NOTE + semitone_shift
    dur = LEAD_IN_MS / 1000 + (STEADY_START_MS + STEADY_DUR_MS) / 1000 + 0.05
    audio, gate_start_samp = render(dsp_text, freq_hz, target_note, dur)
    steady_start = gate_start_samp + int(STEADY_START_MS / 1000 * SAMPLE_RATE)
    steady_len = int(STEADY_DUR_MS / 1000 * SAMPLE_RATE)
    segment = audio[steady_start:steady_start + steady_len]
    high_frac = high_freq_energy_fraction(segment, SAMPLE_RATE, HIGH_FREQ_CUTOFF_HZ)
    flatness = spectral_flatness(segment)
    return high_frac, flatness


def git_show_head_text():
    result = subprocess.run(
        ["git", "show", f"HEAD:{DSP_REL_PATH}"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def main():
    print("xpose() crossfade-curve (linear -> smoothstep) splice-sideband regression check")
    print(f"DSP: {DSP_PATH}")
    print(f"Measuring high-frequency (>{HIGH_FREQ_CUTOFF_HZ:.0f}Hz) energy fraction of the steady-state")
    print("shifted output at the three existing extreme-shift high-octave test cases (matching")
    print("verify_highoctave_transient.py's own frequencies), old (linear crossfade, HEAD) vs")
    print("new (smoothstep crossfade, working tree). Smoothstep should not increase this fraction;")
    print("this is a diagnostic measurement, not a hard CI gate, since no prior baseline was pinned.")
    print()

    new_text = DSP_PATH.read_text()
    old_text = git_show_head_text()

    if new_text == old_text:
        print("working tree is identical to HEAD -- nothing to compare, run this against a real diff.")
        sys.exit(0)

    header = (
        f"{'freq':>9} {'shift':>7} {'old_hi':>10} {'new_hi':>10} {'hi_delta':>10} "
        f"{'old_flat':>12} {'new_flat':>12} {'flat_delta':>12}"
    )
    print(header)
    rows = []
    for freq_hz, semitone_shift in CASES:
        old_frac, old_flat = measure_case(old_text, freq_hz, semitone_shift)
        new_frac, new_flat = measure_case(new_text, freq_hz, semitone_shift)
        hi_delta = new_frac - old_frac
        flat_delta = new_flat - old_flat
        rows.append((freq_hz, semitone_shift, old_frac, new_frac, hi_delta, old_flat, new_flat, flat_delta))
        print(
            f"{freq_hz:9.1f} {semitone_shift:+7.1f} {old_frac:10.6f} {new_frac:10.6f} {hi_delta:+10.6f} "
            f"{old_flat:12.3e} {new_flat:12.3e} {flat_delta:+12.3e}"
        )

    print()
    hi_worse = [r for r in rows if r[4] > 1e-6]
    if hi_worse:
        print(f"{len(hi_worse)}/{len(rows)} cases show a measurable high-frequency energy INCREASE with the smoothstep curve.")
    else:
        print("No case shows a measurable high-frequency energy increase with the smoothstep curve.")
    flat_worse = [r for r in rows if r[7] > 0]
    flat_better = [r for r in rows if r[7] < 0]
    print(f"{len(flat_better)}/{len(rows)} cases show LOWER spectral flatness (less noise-like, smoother splice) with smoothstep.")
    print(f"{len(flat_worse)}/{len(rows)} cases show HIGHER spectral flatness (more noise-like) with smoothstep.")


if __name__ == "__main__":
    main()
