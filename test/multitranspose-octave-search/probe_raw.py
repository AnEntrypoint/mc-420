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

freq = 220.0
dur = 1.0
n = int(dur * SAMPLE_RATE)
t = np.arange(n) / SAMPLE_RATE
sig = (np.sin(2 * np.pi * freq * t) * 0.5).reshape(1, -1)

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()
w = max(70.0, min(48000.0 / freq, 960.0))
x = max(35.0, w * 0.5)
print("w,x =", w, x, file=sys.stderr)
fp.set_parameter("/dawdreamer/w", w)
fp.set_parameter("/dawdreamer/x", x)
fp.set_parameter("/dawdreamer/s", 5.0)
playback = engine.make_playback_processor("sig_in", sig)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(dur)
out = engine.get_audio()[0]
print("out range", out.min(), out.max(), file=sys.stderr)
steady = out[int(0.5 * SAMPLE_RATE):int(0.5 * SAMPLE_RATE) + 300]
print(list(np.round(steady, 3)))
