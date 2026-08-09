import subprocess
import sys

import numpy as np

from harness import DSP_PATH, REPO_ROOT, SAMPLE_RATE, render


def git_show(path, revision):
    rel = path.relative_to(REPO_ROOT)
    out = subprocess.run(
        ["git", "show", f"{revision}:{rel.as_posix()}"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    return out.stdout


def render_held_note(dsp_text, decay, damping, note=60, dur=2.0, amp=0.3, seed=1,
                      position=0.35, tone=6000.0, stretch=0.0, collision=0.0, level=0.8):
    n = int(dur * SAMPLE_RATE)
    rng = np.random.default_rng(seed)
    excite = (rng.uniform(-1.0, 1.0, size=n) * amp).astype(np.float32)
    params = {
        "fx_resonode_decay": decay, "fx_resonode_damping": damping, "fx_resonode_position": position,
        "fx_resonode_tone": tone, "fx_resonode_stretch": stretch, "fx_resonode_collision": collision,
        "fx_resonode_level": level, "fx_resonodevoice0_note": float(note),
        "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0,
    }
    return render(dsp_text, excite, dur, params=params)


def report(label, baseline_text, fixed_text, **kwargs):
    b = render_held_note(baseline_text, **kwargs)
    f = render_held_note(fixed_text, **kwargs)
    bp, br = float(np.max(np.abs(b))), float(np.sqrt(np.mean(b.astype(np.float64) ** 2)))
    fp, fr = float(np.max(np.abs(f))), float(np.sqrt(np.mean(f.astype(np.float64) ** 2)))
    bclip = float(np.mean(np.abs(b) > 0.98))
    fclip = float(np.mean(np.abs(f) > 0.98))
    print(
        f"{label:12s}  BASELINE peak={bp:.4f} rms={br:.4f} clipfrac={bclip:.3f}   "
        f"FIXED peak={fp:.4f} rms={fr:.4f} clipfrac={fclip:.3f}"
    )


def main():
    pre_fix_rev = "dff21b4~2"
    baseline_text = git_show(DSP_PATH, pre_fix_rev)
    fixed_text = DSP_PATH.read_text()

    print("=== gain-normalization A/B: real held note (note=60, gate=1), 0.3-amp noise excitation ===")
    for decay in (0.05, 0.15, 1.2, 3.0, 7.0):
        report(f"decay={decay:.2f}", baseline_text, fixed_text, decay=decay, damping=0.85)

    print()
    print("=== same, at the 4 shipped named patches (position/decay/damping/stretch/collision) ===")
    patches = {
        "Percussive":  (0.08, 0.15, 0.80, -0.10, 0.55),
        "Metal/Glass": (0.08, 7.00, 0.97, 1.20, 0.15),
        "Strings":     (0.08, 7.00, 0.97, -0.10, 0.00),
        "Dance Bass":  (0.42, 7.00, 0.15, -0.10, 0.30),
    }
    for name, (position, decay, damping, stretch, collision) in patches.items():
        report(name, baseline_text, fixed_text, decay=decay, damping=damping,
               position=position, stretch=stretch, collision=collision, dur=1.5)


if __name__ == "__main__":
    sys.exit(main())
