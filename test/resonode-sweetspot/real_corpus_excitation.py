import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import SAMPLE_RATE, render

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "resonode_synth.dsp"
INSTR_DIR = REPO_ROOT / "test-audio-corpus" / "instruments"

sys.path.insert(0, str(REPO_ROOT / "test-audio-corpus"))
from corpus_common import load_to_48k_mono_f32

DSP_TEXT = DSP_PATH.read_text()

def _p(name):
    return "fx_resonode_" + name


PATCHES = {
    "metal_glass": {_p("position"): 0.08, _p("decay"): 7.00, _p("damping"): 0.97, _p("stretch"): 1.20, _p("collision"): 0.15},
    "strings": {_p("position"): 0.08, _p("decay"): 7.00, _p("damping"): 0.97, _p("stretch"): -0.10, _p("collision"): 0.00},
}
COUPLE_SETTINGS = {"couple_full": 1.0}
REPRESENTATIVE_FILES = {
    "piano_low_A1.wav", "violin_high_sulE_C7E7.wav", "vocal_female_vibrato.wav",
    "trumpet_low_A3.wav", "marimba_mid_C5B5.wav", "bassoon_low_C2B2.wav",
}


def roughness(x):
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 3:
        return 0.0
    d2 = x[2:] - 2.0 * x[1:-1] + x[:-2]
    return float(np.sqrt(np.mean(d2 * d2)))


def main():
    files = sorted(f for f in INSTR_DIR.iterdir() if f.suffix == ".wav" and f.name in REPRESENTATIVE_FILES)
    fail_rows = []
    total = 0
    for path in files:
        dry = load_to_48k_mono_f32(str(path))
        dur = len(dry) / SAMPLE_RATE
        if dur < 0.5:
            continue
        dry_roughness = roughness(dry)
        if dry_roughness < 1e-9:
            dry_roughness = 1e-9

        for patch_name, patch_params in PATCHES.items():
            for couple_name, couple_val in COUPLE_SETTINGS.items():
                total += 1
                params = dict(patch_params)
                params[_p("couple")] = couple_val
                params[_p("level")] = 25.0
                params[_p("tone")] = 6000.0
                params[_p("shape_string")] = 1.0
                params["fx_resonodevoice0_note"] = 52.0
                params["fx_resonodevoice0_gate"] = 1.0
                params["fx_resonodevoice0_vel"] = 1.0
                try:
                    out = render(DSP_TEXT, dry, dur, params=params)
                except Exception as e:
                    fail_rows.append(dict(file=path.name, patch=patch_name, couple=couple_name, error=str(e)))
                    print("ERROR %-28s %-14s %-12s %s" % (path.name, patch_name, couple_name, e))
                    continue
                finite = bool(np.all(np.isfinite(out)))
                max_abs = float(np.max(np.abs(out))) if len(out) else 0.0
                out_roughness = roughness(out)
                degr = out_roughness / dry_roughness
                bad = (not finite) or max_abs > 50.0
                if bad:
                    fail_rows.append(dict(file=path.name, patch=patch_name, couple=couple_name,
                                           finite=finite, max_abs=round(max_abs, 3), degr=round(degr, 2)))
                    print("BAD   %-28s %-14s %-12s finite=%s max_abs=%.3f degr=%.2f" % (
                        path.name, patch_name, couple_name, finite, max_abs, degr))
        print("%-28s OK (%d configs)" % (path.name, len(PATCHES) * len(COUPLE_SETTINGS)))

    print("\n=== SUMMARY ===")
    print("total renders:", total, " failures:", len(fail_rows))
    for r in fail_rows:
        print(r)
    return 0 if not fail_rows else 1


if __name__ == "__main__":
    sys.exit(main())
