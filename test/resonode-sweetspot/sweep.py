import itertools
import json
import math
import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

from harness import compile_processor

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "resonode_synth.dsp"
OUT_PATH = Path(__file__).resolve().parent / "sweep_results.jsonl"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
BURST_MS = 15.0
RENDER_S = 2.5
TEST_NOTE = 60


def build_excitation(sample_rate, render_s, burst_ms, seed):
    n = int(render_s * sample_rate)
    burst_n = int(burst_ms * 0.001 * sample_rate)
    rng = np.random.default_rng(seed)
    noise = rng.uniform(-1.0, 1.0, size=burst_n).astype(np.float64)
    ramp = np.minimum(1.0, np.arange(burst_n) / (0.001 * sample_rate))
    decay = np.exp(-np.arange(burst_n) / (0.003 * sample_rate))
    burst = noise * ramp * decay * 0.9
    sig = np.zeros(n, dtype=np.float64)
    sig[:burst_n] = burst
    return sig


def midi_to_hz(note):
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def render_case(params, note=TEST_NOTE):
    dsp_text = DSP_PATH.read_text()
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    excite = build_excitation(SAMPLE_RATE, RENDER_S, BURST_MS, seed=42).astype(np.float32)
    n = excite.shape[0]

    playback = engine.make_playback_processor("in", excite.reshape(1, -1))
    faust, index, _ = compile_processor(engine, dsp_text)
    engine.load_graph([(playback, []), (faust, ["in"])])

    faust.set_parameter(index["fx_resonode_position"], float(params["position"]))
    faust.set_parameter(index["fx_resonode_decay"], float(params["decay"]))
    faust.set_parameter(index["fx_resonode_damping"], float(params["damping"]))
    faust.set_parameter(index["fx_resonode_stretch"], float(params["stretch"]))
    faust.set_parameter(index["fx_resonodevoice0_note"], float(note))
    faust.set_parameter(index["fx_resonodevoice0_gate"], 1.0)
    faust.set_parameter(index["fx_resonodevoice0_vel"], 1.0)

    duration_s = n / SAMPLE_RATE
    if not engine.render(duration_s):
        raise RuntimeError("render failed")
    audio = engine.get_audio()
    return audio[0]


def rms_envelope(x, sr, win_ms=20.0, hop_ms=10.0):
    win = max(1, int(win_ms * 0.001 * sr))
    hop = max(1, int(hop_ms * 0.001 * sr))
    n = len(x)
    out = []
    i = 0
    while i + win <= n:
        seg = x[i : i + win]
        out.append(math.sqrt(float(np.mean(seg * seg)) + 1e-20))
        i += hop
    return np.array(out), hop / sr


def analyze(audio, sr, f0):
    env, hop_s = rms_envelope(audio, sr)
    peak_idx = int(np.argmax(env))
    peak_val = env[peak_idx]
    peak_db = 20 * math.log10(peak_val + 1e-12)

    decay_time_ms = (len(env) - 1 - peak_idx) * hop_s * 1000.0
    for i in range(peak_idx, len(env)):
        db = 20 * math.log10(env[i] + 1e-12)
        if db - peak_db < -24.0:
            decay_time_ms = (i - peak_idx) * hop_s * 1000.0
            break

    n50 = int(0.05 * sr)
    n500 = int(0.5 * sr)
    early = audio[:n50]
    late = audio[n50:n500] if len(audio) > n500 else audio[n50:]
    early_rms = math.sqrt(float(np.mean(early * early)) + 1e-20)
    late_rms = math.sqrt(float(np.mean(late * late)) + 1e-20)
    transient_ratio = early_rms / (late_rms + 1e-9)

    win_start = int(0.10 * sr)
    win_end = int(0.40 * sr)
    win_end = min(win_end, len(audio))
    seg = audio[win_start:win_end]
    if len(seg) < 256:
        seg = audio[: min(len(audio), 8192)]
    windowed = seg * np.hanning(len(seg))
    spec = np.fft.rfft(windowed)
    freqs = np.fft.rfftfreq(len(seg), d=1.0 / sr)
    mag = np.abs(spec)

    total_energy = float(np.sum(mag * mag)) + 1e-20
    centroid = float(np.sum(freqs * mag * mag) / total_energy)

    cutoff = 1.5 * f0
    low_mask = freqs <= cutoff
    low_energy = float(np.sum((mag[low_mask]) ** 2))
    low_freq_ratio = low_energy / total_energy

    peak_thresh = 0.05 * float(np.max(mag))
    peak_idxs = []
    for i in range(2, len(mag) - 2):
        if mag[i] > peak_thresh and mag[i] >= mag[i - 1] and mag[i] >= mag[i + 1] and freqs[i] <= 8000.0:
            peak_idxs.append(i)
    peak_idxs.sort(key=lambda i: -mag[i])
    peak_idxs = peak_idxs[:8]

    if peak_idxs:
        devs = []
        weights = []
        for i in peak_idxs:
            fp = freqs[i]
            k = max(1, round(fp / f0))
            dev = abs(fp - k * f0) / (k * f0)
            devs.append(dev)
            weights.append(mag[i])
        weights = np.array(weights)
        devs = np.array(devs)
        inharmonicity = float(np.sum(devs * weights) / (np.sum(weights) + 1e-20))
    else:
        inharmonicity = 0.0

    n_early_sus0, n_early_sus1 = int(0.05 * sr), int(0.15 * sr)
    n_late_sus0, n_late_sus1 = int(0.5 * sr), int(0.6 * sr)
    early_sus = audio[n_early_sus0:n_early_sus1]
    late_sus = audio[n_late_sus0:n_late_sus1] if len(audio) > n_late_sus1 else audio[n_late_sus0:]
    early_sus_rms = math.sqrt(float(np.mean(early_sus * early_sus)) + 1e-20)
    late_sus_rms = math.sqrt(float(np.mean(late_sus * late_sus)) + 1e-20)
    sustain_ratio = late_sus_rms / (early_sus_rms + 1e-9)

    return {
        "decayTimeMs": decay_time_ms,
        "transientRatio": transient_ratio,
        "spectralCentroidHz": centroid,
        "lowFreqEnergyRatio": low_freq_ratio,
        "inharmonicity": inharmonicity,
        "sustainRatio": sustain_ratio,
        "peakDb": peak_db,
    }


def main():
    grid = {
        "position": [0.08, 0.25, 0.42, 0.60, 0.80],
        "decay": [0.15, 0.6, 1.8, 4.0, 7.0],
        "damping": [0.15, 0.35, 0.60, 0.80, 0.97],
        "stretch": [-0.4, -0.1, 0.15, 0.55, 1.2],
    }

    keys = list(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))
    print(f"total combos: {len(combos)}", file=sys.stderr)

    f0 = midi_to_hz(TEST_NOTE)

    with OUT_PATH.open("w") as f:
        for idx, combo in enumerate(combos):
            params = dict(zip(keys, combo))
            try:
                audio = render_case(params)
                feats = analyze(audio, SAMPLE_RATE, f0)
                row = {"params": params, "features": feats}
            except Exception as e:
                row = {"params": params, "error": str(e)}
            f.write(json.dumps(row) + "\n")
            f.flush()
            if idx % 50 == 0:
                print(f"{idx}/{len(combos)}", file=sys.stderr)

    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()
