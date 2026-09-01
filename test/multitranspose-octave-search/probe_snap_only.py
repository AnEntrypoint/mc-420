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
wTarget = hslider("wTarget", 200, 70, 960, 1);
xTarget = hslider("xTarget", 100, 35, 480, 1);
sTarget = hslider("sTarget", 5, -48, 48, 0.01);
gate = hslider("gate", 1, 0, 1, 1);
wSmoothed = wTarget : si.smooth(ba.tau2pole(0.02)) : max(70) : int;
xSmoothed = xTarget : si.smooth(ba.tau2pole(0.02)) : max(35) : int;
attackEdge = gate > (gate : mem);
normalGlidePole = ba.tau2pole(0.008);
sStep(prev) = ba.if(attackEdge, sTarget, prev*normalGlidePole + sTarget*(1.0-normalGlidePole));
sSmoothed = sStep ~ _;
process(sig) = xpose(wSmoothed, xSmoothed, sSmoothed, sig), sSmoothed, wSmoothed, xSmoothed;
'''


def measure_zcr(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    return zc / (2.0 * dur) if dur > 0 else 0.0


freq = 65.0
dur = 3.0
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

names = [p["name"] for p in fp.get_parameters_description()]


def find(sub):
    for nm in names:
        if nm.endswith("/" + sub):
            return nm
    return None


gP = find("gate")
n_auto = n // BLOCK_SIZE + 1
g_auto = np.ones(n_auto)
g_auto[0] = 0.0  # single attack edge right at start, then held high forever (like a real sustained note)
fp.set_automation(gP, g_auto)
fp.set_parameter("/dawdreamer/wTarget", w)
fp.set_parameter("/dawdreamer/xTarget", x)
fp.set_parameter("/dawdreamer/sTarget", 5.0)

playback = engine.make_playback_processor("sig_in", sig)
engine.load_graph([(playback, []), (fp, ["sig_in"])])
engine.render(dur)
audio = engine.get_audio()
print("num out channels:", audio.shape[0])
out = audio[0]
steady = out[int(2.5 * SAMPLE_RATE):int(2.9 * SAMPLE_RATE)]
measured = measure_zcr(steady)
print(f"w={w} x={x} freq={freq} SINGLE attack, held gate, LONG settle -> output={measured:.2f}Hz implied={12*np.log2(measured/freq):+.2f}st")

# also print sSmoothed/wSmoothed/xSmoothed channels if present
if audio.shape[0] > 1:
    print("s ch settled value:", audio[1][int(2.9*SAMPLE_RATE)])
if audio.shape[0] > 2:
    print("w ch settled value:", audio[2][int(2.9*SAMPLE_RATE)])
if audio.shape[0] > 3:
    print("x ch settled value:", audio[3][int(2.9*SAMPLE_RATE)])
