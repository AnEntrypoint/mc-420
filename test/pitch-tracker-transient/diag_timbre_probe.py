import sys
from pathlib import Path

import numpy as np

import pt_render

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SEGMENT_S = 3.4
FREQS = (110.0, 220.0, 440.0)

DETECTED_HEAD = "detectedFreq(x) = heldFreq, confident\nwith {"
DETECTED_PROBE = ("detectedFreq(x) = heldFreq, confident, coarseFreq, demoteNow, demoteDuty, "
                  "refined1, refinedH\nwith {")

PROCESS_PROBE = """process(sig) = out, coarseFreq, demoteNow, demoteDuty, refined1, refinedH, confident, ready
with {
    detected = detectedFreq(sig);
    rawFreqUnclamped = detected : (_, !, !, !, !, !, !);
    confident = detected : (!, _, !, !, !, !, !);
    coarseFreq = detected : (!, !, _, !, !, !, !);
    demoteNow = detected : (!, !, !, _, !, !, !);
    demoteDuty = detected : (!, !, !, !, _, !, !);
    refined1 = detected : (!, !, !, !, !, _, !);
    refinedH = detected : (!, !, !, !, !, !, _);
    rawFreq = rawFreqUnclamped : max(minTrackHz) : min(maxTrackHz);
    ready = energyReady(sig);
    out = holdLastGood(rawFreq, ready, confident);
};
"""


def probe_dsp():
    src = DSP_PATH.read_text(encoding="utf-8")
    if src.count(DETECTED_HEAD) != 1:
        raise RuntimeError("detectedFreq head not found once: %d" % src.count(DETECTED_HEAD))
    src = src.replace(DETECTED_HEAD, DETECTED_PROBE)
    cut = src.index("process(sig) = holdLastGood(")
    return src[:cut] + PROCESS_PROBE


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


def main():
    seg = int(SEGMENT_S * SAMPLE_RATE)
    sig = np.concatenate([timbre_shift_tone(seg, f) for f in FREQS]).astype(np.float32)
    dsp_text = probe_dsp()
    print("timbre shift internals trace (probe process line, 8 outputs)")
    print(f"DSP: {DSP_PATH}")
    outs = pt_render.render(dsp_text, sig, sr=SAMPLE_RATE, block=BLOCK_SIZE)
    (out, coarse, demote, duty, refined1, refinedH, confident, ready) = outs

    win = int(0.02 * SAMPLE_RATE)
    for k, f0 in enumerate(FREQS):
        base = k * seg
        print(f"f0={f0}Hz")
        for start in range(int(1.8 * SAMPLE_RATE), int(3.2 * SAMPLE_RATE), win):
            i, j = base + start, base + start + win
            print(f"  t={(start + win / 2) / SAMPLE_RATE:4.2f}s "
                  f"out=[{out[i:j].min():6.1f},{out[i:j].max():6.1f}] mean={out[i:j].mean():7.2f} "
                  f"coarse=[{coarse[i:j].min():6.1f},{coarse[i:j].max():6.1f}] "
                  f"demote={demote[i:j].mean():.2f} duty={duty[i:j].mean():.3f} "
                  f"r1={refined1[i:j].mean():7.2f} rH={refinedH[i:j].mean():7.2f} "
                  f"conf={confident[i:j].mean():.2f}")
        gate_win = int(0.2 * SAMPLE_RATE)
        cells = []
        s = int(0.10 * SAMPLE_RATE)
        while s + gate_win <= seg:
            i, j = base + s, base + s + gate_win
            mean_hz = float(out[i:j].mean())
            cells.append(f"t{(s + gate_win / 2) / SAMPLE_RATE:.1f}={mean_hz:6.1f}Hz"
                         f"({1200.0 * np.log2(mean_hz / f0):+.0f}c)")
            s += gate_win
        print("  gate windows: " + " ".join(cells))
    return 0


if __name__ == "__main__":
    sys.exit(main())
