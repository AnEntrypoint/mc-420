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
process(sig) = xpose(wTarget, xTarget, sTarget, sig);
'''

# Two segments: 40Hz then 440Hz, back to back, NO reset of d.
test_freqs = [40, 440]
seg_dur = 1.0
seg_n = int(seg_dur * SAMPLE_RATE)

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
s_auto = np.full(n_auto, 5.0)
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
audio = engine.get_audio()
out = audio[0]
d_ch = audio[1]

print("d value right at 440Hz segment start (samples around boundary):")
b = seg_n
print(d_ch[b-5:b+20])
print("w for 440Hz segment:", max(70.0, min(48000.0/440, 960.0)))


def measure_zcr(seg, sr=SAMPLE_RATE):
    seg = seg - np.mean(seg)
    zc = np.sum(np.diff(np.sign(seg)) != 0)
    dur = len(seg) / sr
    return zc / (2.0 * dur) if dur > 0 else 0.0


steady440 = out[b + int(0.5*SAMPLE_RATE):b + int(0.9*SAMPLE_RATE)]
m = measure_zcr(steady440)
print(f"440Hz segment (following 40Hz) settled output: {m:.2f}Hz implied={12*np.log2(m/440):+.2f}st")
