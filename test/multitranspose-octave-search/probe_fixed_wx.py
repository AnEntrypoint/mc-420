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
wTarget = hslider("wTarget", 300, 70, 960, 1);
xTarget = hslider("xTarget", 150, 35, 480, 1);
sTarget = hslider("sTarget", 5, -48, 48, 0.01);
process(sig) = xpose(wTarget, xTarget, sTarget, sig);
'''


def measure_zcr(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    return zc / (2.0 * dur) if dur > 0 else 0.0


test_freqs = [40, 55, 65, 80, 100, 130, 165, 220, 330, 440]
shift_s = 5.0
seg_dur = 2.0
seg_n = int(seg_dur * SAMPLE_RATE)
W_FIXED = 300.0  # never changes across the whole render
X_FIXED = 150.0

dry_segs = []
for f in test_freqs:
    t = np.arange(seg_n) / SAMPLE_RATE
    dry_segs.append(np.sin(2 * np.pi * f * t) * 0.5)
dry_full = np.concatenate(dry_segs).reshape(1, -1)
total_n = dry_full.shape[1]

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()
fp.set_parameter("/dawdreamer/wTarget", W_FIXED)
fp.set_parameter("/dawdreamer/xTarget", X_FIXED)
fp.set_parameter("/dawdreamer/sTarget", shift_s)

playback = engine.make_playback_processor("sig_in", dry_full)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(total_n / SAMPLE_RATE)
out = engine.get_audio()[0]

print("=== w/x held perfectly constant across whole render (never glide) ===")
for i, f in enumerate(test_freqs):
    start = i * seg_n
    end = start + seg_n
    steady = out[end - int(0.5 * SAMPLE_RATE):end - 1000]
    measured = measure_zcr(steady)
    ratio = measured / f if f > 0 else 0
    implied_st = 12 * np.log2(ratio) if ratio > 0 else float("nan")
    print(f"input={f:>4}Hz -> output={measured:8.2f}Hz implied_shift={implied_st:+6.2f}st (target={shift_s})")
