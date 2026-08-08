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

PARAM_INDEX = {
    "collision": 0,
    "damping": 1,
    "decay": 2,
    "level": 3,
    "position": 4,
    "stretch": 5,
    "tone": 6,
    "voice0_gate": 7,
    "voice0_note": 8,
    "voice0_vel": 9,
}


def git_show_head(path):
    rel = path.relative_to(REPO_ROOT)
    out = subprocess.run(
        ["git", "show", f"HEAD~1:{rel.as_posix()}"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    return out.stdout


def compile_processor(engine, dsp_text, name="resonode"):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def render_held_note(dsp_text, decay, damping, note=60, dur=2.0, amp=0.3, seed=1,
                      position=0.35, tone=6000.0, stretch=0.0, collision=0.0, level=0.8):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    rng = np.random.default_rng(seed)
    excite = (rng.uniform(-1.0, 1.0, size=n) * amp).astype(np.float32)
    playback = engine.make_playback_processor("in", excite.reshape(1, -1))
    faust = compile_processor(engine, dsp_text)
    engine.load_graph([(playback, []), (faust, ["in"])])
    faust.set_parameter(PARAM_INDEX["decay"], decay)
    faust.set_parameter(PARAM_INDEX["damping"], damping)
    faust.set_parameter(PARAM_INDEX["position"], position)
    faust.set_parameter(PARAM_INDEX["tone"], tone)
    faust.set_parameter(PARAM_INDEX["stretch"], stretch)
    faust.set_parameter(PARAM_INDEX["collision"], collision)
    faust.set_parameter(PARAM_INDEX["level"], level)
    faust.set_parameter(PARAM_INDEX["voice0_note"], float(note))
    faust.set_parameter(PARAM_INDEX["voice0_vel"], 1.0)
    faust.set_parameter(PARAM_INDEX["voice0_gate"], 1.0)
    engine.render(dur)
    return engine.get_audio()[0]


def main():
    baseline_text = git_show_head(DSP_PATH)
    fixed_text = DSP_PATH.read_text()

    print("=== gain-normalization A/B: real held note (note=60, gate=1), 0.3-amp noise excitation ===")
    for decay in (0.05, 0.15, 1.2, 3.0, 7.0):
        damping = 0.85
        b = render_held_note(baseline_text, decay, damping)
        f = render_held_note(fixed_text, decay, damping)
        bp, br = float(np.max(np.abs(b))), float(np.sqrt(np.mean(b.astype(np.float64) ** 2)))
        fp, fr = float(np.max(np.abs(f))), float(np.sqrt(np.mean(f.astype(np.float64) ** 2)))
        bclip = float(np.mean(np.abs(b) > 0.98))
        fclip = float(np.mean(np.abs(f) > 0.98))
        print(
            f"decay={decay:5.2f}  BASELINE peak={bp:.4f} rms={br:.4f} clipfrac={bclip:.3f}   "
            f"FIXED peak={fp:.4f} rms={fr:.4f} clipfrac={fclip:.3f}"
        )

    print()
    print("=== same, at the 4 shipped named patches (position/decay/damping/stretch/collision) ===")
    patches = {
        "Percussive":  (0.08, 0.15, 0.80, -0.10, 0.55),
        "Metal/Glass": (0.08, 7.00, 0.97, 1.20, 0.15),
        "Strings":     (0.08, 7.00, 0.97, -0.10, 0.00),
        "Dance Bass":  (0.42, 7.00, 0.15, -0.10, 0.30),
    }
    for name, (position, decay, damping, stretch, collision) in patches.items():
        b = render_held_note(baseline_text, decay, damping, position=position, stretch=stretch, collision=collision, dur=1.5)
        f = render_held_note(fixed_text, decay, damping, position=position, stretch=stretch, collision=collision, dur=1.5)
        bp, br = float(np.max(np.abs(b))), float(np.sqrt(np.mean(b.astype(np.float64) ** 2)))
        fp, fr = float(np.max(np.abs(f))), float(np.sqrt(np.mean(f.astype(np.float64) ** 2)))
        bclip = float(np.mean(np.abs(b) > 0.98))
        fclip = float(np.mean(np.abs(f) > 0.98))
        print(
            f"{name:12s}  BASELINE peak={bp:.4f} rms={br:.4f} clipfrac={bclip:.3f}   "
            f"FIXED peak={fp:.4f} rms={fr:.4f} clipfrac={fclip:.3f}"
        )


if __name__ == "__main__":
    sys.exit(main())
