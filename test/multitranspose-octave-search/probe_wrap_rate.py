import numpy as np
import dawdreamer as daw

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

XPOSE_DSP = '''
import("stdfaust.lib");
xposeMaxDelay = 2000;
xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*crossfadeGain +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-crossfadeGain), d
with {
    i = 1 - pow(2, s/12);
    d = i : (+ : +(w) : fmod(_,w)) ~ _;
    crossfadePos = ma.fmin(d/x,1);
    crossfadeGain = crossfadePos*crossfadePos*(3-2*crossfadePos);
};
wTarget = hslider("wTarget", 200, 70, 960, 1);
xTarget = hslider("xTarget", 100, 35, 480, 1);
sTarget = hslider("sTarget", 5, -48, 48, 0.01);
wSmoothed = wTarget : si.smooth(ba.tau2pole(0.02)) : max(70) : int;
xSmoothed = xTarget : si.smooth(ba.tau2pole(0.02)) : max(35) : int;
process(sig) = xpose(wSmoothed, xSmoothed, sTarget, sig);
'''

freq = 440.0
w_target = max(70.0, min(48000.0 / freq, 960.0))
x_target = max(35.0, w_target * 0.5)
s_val = 5.0
i_val = 1 - 2**(s_val/12)
expected_wrap_period = w_target / abs(i_val)
print(f"w={w_target} i={i_val:.5f} expected_wrap_period={expected_wrap_period:.2f} samples")

dur = 3.0
n = int(dur * SAMPLE_RATE)
t = np.arange(n) / SAMPLE_RATE
sig = (np.sin(2 * np.pi * freq * t) * 0.5).reshape(1, -1)

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()
fp.set_parameter("/dawdreamer/wTarget", w_target)
fp.set_parameter("/dawdreamer/xTarget", x_target)
fp.set_parameter("/dawdreamer/sTarget", s_val)
playback = engine.make_playback_processor("sig_in", sig)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(dur)
audio = engine.get_audio()
d_ch = audio[1]

# count actual wraps (d resets from near-w down toward 0) in steady state (after 1s)
steady_start = int(1.0 * SAMPLE_RATE)
d_steady = d_ch[steady_start:]
diffs = np.diff(d_steady)
wraps = np.sum(np.abs(diffs) > w_target * 0.5)
measured_period = len(d_steady) / wraps if wraps > 0 else float("inf")
print(f"measured wraps: {wraps} over {len(d_steady)} samples -> measured_period={measured_period:.2f} samples")
print(f"ratio measured/expected = {measured_period/expected_wrap_period:.4f}")
