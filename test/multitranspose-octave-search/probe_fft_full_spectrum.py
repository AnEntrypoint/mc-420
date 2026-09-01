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
W = hslider("w", 300, 70, 960, 1);
X = hslider("x", 150, 35, 480, 1);
S = hslider("s", 5, -48, 48, 0.01);
process(sig) = xpose(W, X, S, sig);
'''

freq = 65.0
dur = 2.0
n = int(dur * SAMPLE_RATE)
t = np.arange(n) / SAMPLE_RATE
sig = (np.sin(2 * np.pi * freq * t) * 0.5).reshape(1, -1)

w = max(70.0, min(48000.0 / freq, 960.0))
x = max(35.0, w * 0.5)

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()
fp.set_parameter("/dawdreamer/w", w)
fp.set_parameter("/dawdreamer/x", x)
fp.set_parameter("/dawdreamer/s", 5.0)
playback = engine.make_playback_processor("sig_in", sig)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(dur)
out = engine.get_audio()[0]

steady = out[int(1.0*SAMPLE_RATE):int(1.9*SAMPLE_RATE)]
win = np.hanning(len(steady))
spec = np.abs(np.fft.rfft(steady*win))
freqs = np.fft.rfftfreq(len(steady), 1.0/SAMPLE_RATE)
top10 = np.argsort(spec)[::-1][:10]
print(f"input freq={freq}, w={w:.1f}, x={x:.1f}, target shift=5st -> expected output={freq*2**(5/12):.2f}Hz")
print("top spectral peaks (freq, magnitude):")
for idx in sorted(top10):
    if freqs[idx] > 10:
        print(f"  {freqs[idx]:8.2f}Hz  mag={spec[idx]:.1f}")
