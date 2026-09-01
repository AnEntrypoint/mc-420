#!/usr/bin/env python3
"""Isolate xpose() from multitranspose.dsp entirely -- test the shift ratio
directly with FIXED window w and FIXED shift s (as hsliders), bypassing all
note-detection/smoothing/attack logic, to find whether the delay-line math
itself has a frequency-dependent bug."""
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

XPOSE_DSP = '''
import("stdfaust.lib");
xposeMaxDelay = 2000;
xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*crossfadeGain +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-crossfadeGain)
with {
    i = 1 - pow(2, s/12);
    d = i : (+ : +(w) : fmod(_,w)) ~ _;
    crossfadePos = ma.fmin(d/x,1);
    crossfadeGain = crossfadePos*crossfadePos*(3-2*crossfadePos);
};
W = hslider("w", 200, 70, 960, 1);
X = hslider("x", 100, 35, 480, 1);
S = hslider("s", 5, -48, 48, 0.01);
process(sig) = xpose(W, X, S, sig);
'''


def synth_tone(freq_hz, dur_s, sr=SAMPLE_RATE):
    n = int(dur_s * sr)
    t = np.arange(n) / sr
    return (np.sin(2 * np.pi * freq_hz * t) * 0.5).astype(np.float64)


def measure_zcr(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    return zc / (2.0 * dur) if dur > 0 else 0.0


def main():
    import dawdreamer as daw

    shift_s = 5.0
    test_freqs = [40, 55, 65, 80, 100, 130, 165, 220, 330, 440]
    seg_dur_s = 0.5
    seg_n = int(seg_dur_s * SAMPLE_RATE)

    dry_segs = [synth_tone(f, seg_dur_s) for f in test_freqs]
    dry_full = np.concatenate(dry_segs).reshape(1, -1)
    total_n = dry_full.shape[1]

    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    fp = engine.make_faust_processor("fx")
    fp.set_dsp_string(XPOSE_DSP)
    fp.compile_flags = SHIPPED_FLAGS
    print("compiling...", file=sys.stderr)
    ok = fp.compile()
    print("compile ok:", ok, file=sys.stderr)
    if not ok:
        return 1

    names = [p["name"] for p in fp.get_parameters_description()]
    print("params:", names, file=sys.stderr)

    playback = engine.make_playback_processor("sig_in", dry_full)
    engine.load_graph([(playback, []), (fp, ["sig_in"])])

    def find(sub):
        for nm in names:
            if sub == nm or nm.endswith("/" + sub):
                return nm
        return None

    w_p, x_p, s_p = find("w"), find("x"), find("s")
    print("resolved:", w_p, x_p, s_p, file=sys.stderr)

    # window/crossfade sized per-segment matching windowForFormant's real
    # formula (w = SR/freq clamped [70,960], x = w*0.5 clamped [35, ...])
    n_auto = total_n // BLOCK_SIZE + 1
    w_auto = np.zeros(n_auto)
    x_auto = np.zeros(n_auto)
    s_auto = np.full(n_auto, shift_s)
    blocks_per_seg = seg_n // BLOCK_SIZE
    for i, f in enumerate(test_freqs):
        raw_w = 48000.0 / f
        w = max(70.0, min(raw_w, 960.0))
        x = max(35.0, w * 0.5)
        start_b = i * blocks_per_seg
        end_b = min(n_auto, start_b + blocks_per_seg)
        w_auto[start_b:end_b] = w
        x_auto[start_b:end_b] = x

    if w_p:
        fp.set_automation(w_p, w_auto)
    if x_p:
        fp.set_automation(x_p, x_auto)
    if s_p:
        fp.set_automation(s_p, s_auto)

    duration_s = total_n / SAMPLE_RATE
    print(f"rendering {duration_s}s...", file=sys.stderr)
    if not engine.render(duration_s):
        print("RENDER FAILED", file=sys.stderr)
        return 1
    audio = engine.get_audio()
    out = audio[0] if audio.ndim > 1 else audio

    print("\n=== ISOLATED xpose() RESULTS (fixed s=5 semitones, w/x scaled per-freq like real caller) ===")
    for i, f in enumerate(test_freqs):
        start = i * seg_n
        end = start + seg_n
        steady = out[start + int(seg_n * 0.4):start + int(seg_n * 0.9)]
        measured = measure_zcr(steady)
        ratio = measured / f if f > 0 else 0
        implied_semitones = 12 * np.log2(ratio) if ratio > 0 else float("nan")
        print(f"input={f:>4}Hz w={max(70,min(48000/f,960)):.0f} -> output={measured:7.2f}Hz implied_shift={implied_semitones:+6.2f}st (target=5.0)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
