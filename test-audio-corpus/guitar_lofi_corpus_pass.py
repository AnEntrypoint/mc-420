import os
import sys
import numpy as np
import dawdreamer as daw

from corpus_common import load_to_48k_mono_f32, find_sustained_segment, TARGET_SR

HERE = os.path.dirname(os.path.abspath(__file__))
DSP_PATH = os.path.join(HERE, "..", "effects", "home", "faust", "guitar_lofi_fx.dsp")
FAUST_LIBS = os.path.join(HERE, "..", "effects", "home", "faust")
INSTR_DIR = os.path.join(HERE, "instruments")
SR = TARGET_SR
BLOCK = 64

PRESETS = {
    "neutral": dict(FLANGEAMT=0.0, TREMOLOAMT=0.0, PHASERAMT=0.0, DISTAMT=0.0,
                     BITCRUSHAMT=0.0, VINYLAMT=0.0, FLUTTERAMT=0.0, GATEAMT=0.0, BANKSPEED=0.5),
    "flanger_max": dict(FLANGEAMT=1.0, BANKSPEED=0.5),
    "tremolo_max": dict(TREMOLOAMT=1.0, BANKSPEED=0.5),
    "phaser_max": dict(PHASERAMT=1.0, BANKSPEED=0.5),
    "dist_max": dict(DISTAMT=1.0),
    "bitcrush_max": dict(BITCRUSHAMT=1.0),
    "vinyl_max": dict(VINYLAMT=1.0),
    "flutter_max": dict(FLUTTERAMT=1.0),
    "gate_max": dict(GATEAMT=1.0),
    "everything_moderate": dict(FLANGEAMT=0.5, TREMOLOAMT=0.5, PHASERAMT=0.5, DISTAMT=0.5,
                                  BITCRUSHAMT=0.5, VINYLAMT=0.5, FLUTTERAMT=0.5, GATEAMT=0.5, BANKSPEED=0.7),
    "everything_max": dict(FLANGEAMT=1.0, TREMOLOAMT=1.0, PHASERAMT=1.0, DISTAMT=1.0,
                             BITCRUSHAMT=1.0, VINYLAMT=1.0, FLUTTERAMT=1.0, GATEAMT=1.0, BANKSPEED=1.0),
}


def roughness(x):
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 3:
        return 0.0
    d2 = x[2:] - 2.0 * x[1:-1] + x[:-2]
    return float(np.sqrt(np.mean(d2 * d2)))


def render(dry, params):
    engine = daw.RenderEngine(SR, BLOCK)
    proc = engine.make_faust_processor("gfx")
    proc.faust_libraries_path = FAUST_LIBS
    ok = proc.set_dsp(DSP_PATH)
    if not ok:
        raise RuntimeError("faust compile failed for guitar_lofi_fx.dsp")
    for pname, pval in params.items():
        key = None
        for full in proc.get_parameters_description():
            if full["name"].endswith(pname):
                key = full["name"]
                break
        if key is None:
            raise RuntimeError("param not found: " + pname)
        proc.set_parameter(key, float(pval))
    engine.load_graph([(proc, [])])
    engine.set_bpm(120.0)
    engine.render(len(dry) / SR)
    out = engine.get_audio()
    if out.shape[0] >= 1:
        return out[0]
    return out


def main():
    files = sorted(f for f in os.listdir(INSTR_DIR) if f.endswith(".wav"))
    fail_rows = []
    total = 0
    for fname in files:
        path = os.path.join(INSTR_DIR, fname)
        dry = load_to_48k_mono_f32(path)
        seg_s, seg_e = find_sustained_segment(dry, SR)
        if seg_e - seg_s < 0.15:
            seg_s, seg_e = 0.0, len(dry) / SR
        m0 = int(seg_s * SR)
        m1 = int(seg_e * SR)
        dry_roughness = roughness(dry[m0:m1])
        if dry_roughness < 1e-9:
            dry_roughness = 1e-9

        for pname, params in PRESETS.items():
            total += 1
            try:
                out = render(dry, params)
            except Exception as e:
                fail_rows.append(dict(file=fname, preset=pname, error=str(e)))
                print("ERROR %-28s %-20s %s" % (fname, pname, e))
                continue
            finite = bool(np.all(np.isfinite(out)))
            max_abs = float(np.max(np.abs(out))) if len(out) else 0.0
            wet_roughness = roughness(out[m0:min(m1, len(out))])
            degr = wet_roughness / dry_roughness
            bad = (not finite) or max_abs > 4.0
            if bad:
                fail_rows.append(dict(file=fname, preset=pname, finite=finite, max_abs=round(max_abs, 3), degr=round(degr, 2)))
                print("BAD   %-28s %-20s finite=%s max_abs=%.3f degr=%.2f" % (fname, pname, finite, max_abs, degr))

        print("%-28s OK (%d presets)" % (fname, len(PRESETS)))

    print("\n=== SUMMARY ===")
    print("total renders:", total, " failures:", len(fail_rows))
    for r in fail_rows:
        print(r)
    return 0 if not fail_rows else 1


if __name__ == "__main__":
    sys.exit(main())
