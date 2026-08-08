import subprocess
import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "resonode_synth.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]


def git_show_head(path):
    rel = path.relative_to(REPO_ROOT)
    out = subprocess.run(
        ["git", "show", f"HEAD:{rel.as_posix()}"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    return out.stdout


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def voice_inputs(n, note0=60.0, gate0=1.0, vel0=1.0, excite=None):
    if excite is None:
        excite = np.zeros(n)
    zero = np.zeros(n)
    note_sig = np.full(n, float(note0))
    gate_sig = np.full(n, float(gate0))
    vel_sig = np.full(n, float(vel0))
    return np.stack(
        [excite, note_sig, gate_sig, vel_sig, zero, zero, zero, zero, zero, zero, zero, zero, zero],
        axis=0,
    )


def render(dsp_text, inputs, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "resonode")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def sustained_tone_test(dsp_text, decay, damping, note, dur=2.0, amp=0.3, seed=1):
    text = dsp_text
    import re
    text = re.sub(r'hslider\("fx/resonode/decay", [^,]+,', f'hslider("fx/resonode/decay", {decay},', text)
    text = re.sub(r'hslider\("fx/resonode/damping", [^,]+,', f'hslider("fx/resonode/damping", {damping},', text)
    n = int(dur * SAMPLE_RATE)
    rng = np.random.default_rng(seed)
    excite = rng.uniform(-1.0, 1.0, size=n) * amp
    inputs = voice_inputs(n, note0=note, gate0=1.0, vel0=1.0, excite=excite)
    audio = render(text, inputs, dur)
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    tail = audio[-2000:].astype(np.float64)
    clip_frac = float(np.mean(np.abs(audio) > 0.98))
    return peak, rms, clip_frac


def main():
    baseline_text = git_show_head(DSP_PATH)
    fixed_text = DSP_PATH.read_text()

    print("=== gain-normalization A/B: peak / RMS / fraction-of-samples-near-clip(|x|>0.98) ===")
    print("input excitation amplitude is a modest 0.3 peak (typical mic level), gate held 2s")
    for decay in (0.05, 0.15, 1.2, 3.0, 7.0):
        for damping in (0.85,):
            note = 60
            bp, br, bc = sustained_tone_test(baseline_text, decay, damping, note)
            fp, fr, fc = sustained_tone_test(fixed_text, decay, damping, note)
            print(
                f"decay={decay:5.2f} damping={damping:.2f}  "
                f"BASELINE peak={bp:.4f} rms={br:.4f} clipfrac={bc:.3f}   "
                f"FIXED peak={fp:.4f} rms={fr:.4f} clipfrac={fc:.3f}"
            )


if __name__ == "__main__":
    sys.exit(main())
