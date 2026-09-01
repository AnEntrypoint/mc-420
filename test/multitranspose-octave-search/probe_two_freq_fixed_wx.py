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

freq1, freq2 = 65.0, 65.0  # SAME frequency both segments -- isolates "does concatenation alone break it"
seg_dur = 2.0
seg_n = int(seg_dur * SAMPLE_RATE)
t = np.arange(seg_n) / SAMPLE_RATE
sig1 = np.sin(2 * np.pi * freq1 * t) * 0.5
sig2 = np.sin(2 * np.pi * freq2 * t) * 0.5
sig = np.concatenate([sig1, sig2]).reshape(1, -1)

w = 300.0
x = 150.0

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
engine.render(sig.shape[1] / SAMPLE_RATE)
out = engine.get_audio()[0]


def fft_peak(seg):
    win = np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(seg * win))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / SAMPLE_RATE)
    mask = freqs > 10
    return freqs[mask][np.argmax(spec[mask])]


seg1_steady = out[int(1.0*SAMPLE_RATE):int(1.9*SAMPLE_RATE)]
seg2_steady = out[seg_n + int(1.0*SAMPLE_RATE):seg_n + int(1.9*SAMPLE_RATE)]
print("SAME freq both segments (65Hz), fixed w/x, ONE continuous render:")
print(f"  segment1 peak: {fft_peak(seg1_steady):.2f}Hz (expect ~86.76)")
print(f"  segment2 peak: {fft_peak(seg2_steady):.2f}Hz (expect ~86.76)")
