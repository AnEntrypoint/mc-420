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
period_samples = SAMPLE_RATE / freq
dur = 2.0
n = int(dur * SAMPLE_RATE)
t = np.arange(n) / SAMPLE_RATE
sig = (np.sin(2 * np.pi * freq * t) * 0.5).reshape(1, -1)

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(XPOSE_DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()


def measure(w, x):
    fp.set_parameter("/dawdreamer/w", w)
    fp.set_parameter("/dawdreamer/x", x)
    fp.set_parameter("/dawdreamer/s", 5.0)
    playback = engine.make_playback_processor("sig_in", sig)
    engine.load_graph([(playback, []), (fp, ["sig_in"])])
    engine.render(dur)
    out = engine.get_audio()[0]
    steady = out[int(1.0 * SAMPLE_RATE):int(1.9 * SAMPLE_RATE)]
    win = np.hanning(len(steady))
    spec = np.abs(np.fft.rfft(steady * win))
    freqs = np.fft.rfftfreq(len(steady), 1.0 / SAMPLE_RATE)
    mask = freqs > 10
    return freqs[mask][np.argmax(spec[mask])]


print(f"period for {freq}Hz = {period_samples:.1f} samples")
expected = freq * 2**(5/12)
for w_mult in [0.25, 0.5, 0.75, 0.9, 1.0, 1.1, 1.5, 2.0, 3.0, 5.0, 8.0, 11.36]:
    w = period_samples * w_mult
    w = max(70, min(w, 960))
    x = max(35, w * 0.5)
    peak = measure(w, x)
    print(f"w={w:7.1f} ({w_mult:.2f}x period) -> peak={peak:8.2f}Hz (target {expected:.2f}Hz)")
