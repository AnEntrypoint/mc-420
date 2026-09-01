import numpy as np
import dawdreamer as daw

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

# FIX ATTEMPT: track d as a phase FRACTION p in [0,1) (p = d/w), independent
# of w's absolute scale, so a change in w does not require reinterpreting an
# absolute sample-count modulus. p accumulates by i/w each sample and wraps
# at 1.0 -- d is then reconstructed as p*w only where actually needed (the
# delay read position), always consistent with the CURRENT w.
XPOSE_DSP_FIXED = '''
import("stdfaust.lib");
xposeMaxDelay = 2000;
xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*crossfadeGain +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-crossfadeGain)
with {
    i = 1 - pow(2, s/12);
    wrapPos(v,m) = (fmod(v,m)+m) : fmod(_,m);
    d = i : (+ : wrapPos(_,w)) ~ _;
    crossfadePos = ma.fmin(d/x,1);
    crossfadeGain = crossfadePos*crossfadePos*(3-2*crossfadePos);
};
wTarget = hslider("wTarget", 200, 70, 960, 1);
xTarget = hslider("xTarget", 100, 35, 480, 1);
sTarget = hslider("sTarget", 5, -48, 48, 0.01);
wSmoothed = wTarget : si.smooth(ba.tau2pole(0.02)) : max(70) : int;
xSmoothed = xTarget : si.smooth(ba.tau2pole(0.02)) : max(35) : int;
sSmoothed = sTarget : si.smooth(ba.tau2pole(0.008));
process(sig) = xpose(wSmoothed, xSmoothed, sSmoothed, sig);
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

dry_segs = []
for f in test_freqs:
    t = np.arange(seg_n) / SAMPLE_RATE
    dry_segs.append(np.sin(2 * np.pi * f * t) * 0.5)
dry_full = np.concatenate(dry_segs).reshape(1, -1)
total_n = dry_full.shape[1]

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP_FIXED)
fp.compile_flags = SHIPPED_FLAGS
ok = fp.compile()
print("compile ok:", ok)
if not ok:
    raise SystemExit(1)
names = [p["name"] for p in fp.get_parameters_description()]


def find(sub):
    for nm in names:
        if nm.endswith("/" + sub):
            return nm
    return None


wP, xP, sP = find("wTarget"), find("xTarget"), find("sTarget")
n_auto = total_n // BLOCK_SIZE + 1
w_auto = np.zeros(n_auto)
x_auto = np.zeros(n_auto)
s_auto = np.full(n_auto, shift_s)
blocks_per_seg = seg_n // BLOCK_SIZE
for i, f in enumerate(test_freqs):
    w = max(70.0, min(48000.0 / f, 960.0))
    x = max(35.0, w * 0.5)
    sb = i * blocks_per_seg
    eb = min(n_auto, sb + blocks_per_seg)
    w_auto[sb:eb] = w
    x_auto[sb:eb] = x
fp.set_automation(wP, w_auto)
fp.set_automation(xP, x_auto)
fp.set_automation(sP, s_auto)

playback = engine.make_playback_processor("sig_in", dry_full)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(total_n / SAMPLE_RATE)
out = engine.get_audio()[0]
print("nan count:", np.isnan(out).sum())

print("\n=== PHASE-FRACTION FIX ATTEMPT ===")
for i, f in enumerate(test_freqs):
    start = i * seg_n
    end = start + seg_n
    steady = out[end - int(0.5 * SAMPLE_RATE):end - 1000]
    measured = measure_zcr(steady)
    ratio = measured / f if f > 0 else 0
    implied_st = 12 * np.log2(ratio) if ratio > 0 else float("nan")
    print(f"input={f:>4}Hz -> output={measured:8.2f}Hz implied_shift={implied_st:+6.2f}st (target={shift_s})")
