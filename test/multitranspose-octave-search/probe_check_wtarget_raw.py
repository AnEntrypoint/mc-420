import numpy as np
import dawdreamer as daw

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SHIPPED_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

DSP = '''
import("stdfaust.lib");
wTarget = hslider("wTarget", 200, 70, 960, 1);
process = wTarget;
'''

test_freqs = [330, 440]
seg_dur = 2.0
seg_n = int(seg_dur * SAMPLE_RATE)
total_n = seg_n * 2

engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
fp = engine.make_faust_processor("fx")
fp.set_dsp_string(DSP)
fp.compile_flags = SHIPPED_FLAGS
fp.compile()
names = [p["name"] for p in fp.get_parameters_description()]
print(names)
wP = names[0]

n_auto = total_n // BLOCK_SIZE + 1
w_auto = np.zeros(n_auto)
blocks_per_seg = seg_n // BLOCK_SIZE
for i, f in enumerate(test_freqs):
    w = max(70.0, min(48000.0 / f, 960.0))
    sb = i * blocks_per_seg
    eb = min(n_auto, sb + blocks_per_seg)
    w_auto[sb:eb] = w
print("w_auto unique values:", np.unique(w_auto))
fp.set_automation(wP, w_auto)

sig = np.zeros((1, total_n))
playback = engine.make_playback_processor("sig_in", sig)
engine.load_graph([(playback, []), (fp, [])])
engine.render(total_n / SAMPLE_RATE)
out = engine.get_audio()[0]
print("raw wTarget output near end:", out[-100:-90])
print("raw wTarget at segment2 start+5000:", out[seg_n+5000])
