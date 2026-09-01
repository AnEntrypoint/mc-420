import sys
import numpy as np
import dawdreamer as daw

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


def measure_zcr(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    return zc / (2.0 * dur) if dur > 0 else 0.0


test_freqs = [40, 55, 65, 80, 100, 130, 165, 220, 330, 440]
shift_s = 5.0
dur = 1.5

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()

print("=== per-frequency, set_parameter (constant, no automation interpolation) ===")
for freq in test_freqs:
    n = int(dur * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    sig = (np.sin(2 * np.pi * freq * t) * 0.5).reshape(1, -1)

    w = max(70.0, min(48000.0 / freq, 960.0))
    x = max(35.0, w * 0.5)
    fp.set_parameter("/dawdreamer/w", w)
    fp.set_parameter("/dawdreamer/x", x)
    fp.set_parameter("/dawdreamer/s", shift_s)
    playback = engine.make_playback_processor("sig_in", sig)
    engine.load_graph([(playback, []), (fp, ["sig_in"])])
    engine.render(dur)
    out = engine.get_audio()[0]
    steady = out[int(dur * SAMPLE_RATE * 0.5):int(dur * SAMPLE_RATE * 0.9)]
    measured = measure_zcr(steady)
    ratio = measured / freq
    implied_st = 12 * np.log2(ratio) if ratio > 0 else float("nan")
    print(f"input={freq:>4}Hz w={w:.0f} x={x:.0f} -> output={measured:8.2f}Hz implied_shift={implied_st:+6.2f}st (target={shift_s})")
