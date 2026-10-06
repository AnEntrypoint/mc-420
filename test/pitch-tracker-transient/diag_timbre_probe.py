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
                  "refined1, refinedH, pCoarse, pH, raw1, raw2\nwith {")

DEMOTE_HEAD = "demoteTest(x, w, coarseFreq) = demoteNow\nwith {"
DEMOTE_PROBE = "demoteTest(x, w, coarseFreq) = demoteNow, pCoarse, pH\nwith {"

PROMOTE_HEAD = ("subharmonicPromote(x, w, coarseFreq, demoteNow) = promotedRatio, "
                "promotedConfidence, dominant3, dominant2\nwith {")
PROMOTE_PROBE = ("subharmonicPromote(x, w, coarseFreq, demoteNow) = promotedRatio, "
                 "promotedConfidence, dominant3, dominant2, raw1, raw2\nwith {")

DEMOTE_CALL = "    demoteNow = demoteTest(xh, w, coarseFreq);\n"
DEMOTE_CALL_PROBE = ("    demoteOut = demoteTest(xh, w, coarseFreq);\n"
                     "    demoteNow = demoteOut : (_, !, !);\n"
                     "    pCoarse = demoteOut : (!, _, !);\n"
                     "    pH = demoteOut : (!, !, _);\n")

PROMOTE_CALL = "    promotion = subharmonicPromote(xh, w, coarseFreq, demoteNow);\n"
PROMOTE_CALL_PROBE = (PROMOTE_CALL
                      + "    raw1 = promotion : (!, !, !, !, _, !);\n"
                      + "    raw2 = promotion : (!, !, !, !, !, _);\n")

ROUTES = [
    ("    dominant3 = promotion : (!, !, _, !);\n", "    dominant3 = promotion : (!, !, _, !, !, !);\n"),
    ("    dominant2 = promotion : (!, !, !, _);\n", "    dominant2 = promotion : (!, !, !, _, !, !);\n"),
    ("    finalConfidence = promotion : (!, _, !, !);\n",
     "    finalConfidence = promotion : (!, _, !, !, !, !);\n"),
]

PROCESS_PROBE = """process(sig) = out, coarseFreq, demoteNow, demoteDuty, refined1, refinedH,
                 pCoarse, pH, raw1, raw2, confident, ready
with {
    detected = detectedFreq(sig);
    rawFreqUnclamped = detected : (_, !, !, !, !, !, !, !, !, !, !);
    confident = detected : (!, _, !, !, !, !, !, !, !, !, !);
    coarseFreq = detected : (!, !, _, !, !, !, !, !, !, !, !);
    demoteNow = detected : (!, !, !, _, !, !, !, !, !, !, !);
    demoteDuty = detected : (!, !, !, !, _, !, !, !, !, !, !);
    refined1 = detected : (!, !, !, !, !, _, !, !, !, !, !);
    refinedH = detected : (!, !, !, !, !, !, _, !, !, !, !);
    pCoarse = detected : (!, !, !, !, !, !, !, _, !, !, !);
    pH = detected : (!, !, !, !, !, !, !, !, _, !, !);
    raw1 = detected : (!, !, !, !, !, !, !, !, !, _, !);
    raw2 = detected : (!, !, !, !, !, !, !, !, !, !, _);
    rawFreq = rawFreqUnclamped : max(minTrackHz) : min(maxTrackHz);
    ready = energyReady(sig);
    out = holdLastGood(rawFreq, ready, confident);
};
"""


def probe_dsp():
    src = DSP_PATH.read_text(encoding="utf-8")
    for head in (DETECTED_HEAD, DEMOTE_HEAD, PROMOTE_HEAD, DEMOTE_CALL, PROMOTE_CALL):
        if src.count(head) != 1:
            raise RuntimeError("anchor not found once: %r (%d)" % (head, src.count(head)))
    for old, _new in ROUTES:
        if src.count(old) != 1:
            raise RuntimeError("route not found once: %r (%d)" % (old, src.count(old)))
    src = (src.replace(DETECTED_HEAD, DETECTED_PROBE)
              .replace(DEMOTE_HEAD, DEMOTE_PROBE)
              .replace(PROMOTE_HEAD, PROMOTE_PROBE)
              .replace(DEMOTE_CALL, DEMOTE_CALL_PROBE)
              .replace(PROMOTE_CALL, PROMOTE_CALL_PROBE))
    for old, new in ROUTES:
        src = src.replace(old, new)
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
    print("timbre shift correlation trace (probe process line, 12 outputs)")
    print(f"DSP: {DSP_PATH}")
    outs = pt_render.render(probe_dsp(), sig, sr=SAMPLE_RATE, block=BLOCK_SIZE)
    (out, coarse, demote, duty, refined1, refinedH,
     pCoarse, pH, raw1, raw2, confident, ready) = outs

    win = int(0.02 * SAMPLE_RATE)
    for k, f0 in enumerate(FREQS):
        base = k * seg
        print(f"f0={f0}Hz")
        for start in range(int(2.0 * SAMPLE_RATE), int(2.8 * SAMPLE_RATE), win):
            i, j = base + start, base + start + win
            print(f"  t={(start + win / 2) / SAMPLE_RATE:4.2f}s "
                  f"out=[{out[i:j].min():6.1f},{out[i:j].max():6.1f}] "
                  f"coarse=[{coarse[i:j].min():6.1f},{coarse[i:j].max():6.1f}] "
                  f"demote={demote[i:j].mean():.2f} duty={duty[i:j].mean():.3f} "
                  f"pCoarse=[{pCoarse[i:j].min():+.4f},{pCoarse[i:j].max():+.4f}] "
                  f"pH=[{pH[i:j].min():+.4f},{pH[i:j].max():+.4f}] "
                  f"raw1=[{raw1[i:j].min():+.4f},{raw1[i:j].max():+.4f}] "
                  f"raw2=[{raw2[i:j].min():+.4f},{raw2[i:j].max():+.4f}]")
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
