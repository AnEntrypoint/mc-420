import os
import sys
import json
import subprocess
import numpy as np

from corpus_common import load_to_48k_mono_f32, measure_freq_windowed, cents_diff

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS_SRC = os.path.join(HERE, "multitranspose_harness.cpp")
HARNESS_BIN = os.path.join(HERE, "multitranspose_harness")

SR = 48000
LOCK_SHIFT_SEMITONES = 7.0
LEAD_IN_S = 0.15
TAIL_S = 1.0
MEASURE_START_S = LEAD_IN_S + 0.3
MEASURE_END_S = LEAD_IN_S + 0.9

REAL_FILES = {
    "Guitar.mf.sulE.E2.aiff": 80.616,
    "Xylophone.rosewood.mf.C6.aiff": 1053.841,
    "Crotale.C7.ff.aiff": 2128.390,
    "Crotale.C8.ff.aiff": 4266.999,
    "Tuba.mf.C2.aiff": 66.087,
    "Bassoon.mf.Bb1.aiff": 58.778,
    "Bass.arco.sulC.mf.C1.aiff": 32.537,
    "Vocal.m2.long_straight_a.aiff": 125.157,
    "Vocal.f7.long_forte_a.aiff": 262.296,
    "Vocal.f6.long_trill_a.aiff": 264.468,
}


def ensure_harness():
    if os.path.exists(HARNESS_BIN) and os.path.getmtime(HARNESS_BIN) > os.path.getmtime(HARNESS_SRC):
        return
    subprocess.run(
        ["g++", "-O2", "-std=c++17", HARNESS_SRC, "-o", HARNESS_BIN],
        cwd=HERE, check=True,
    )


def run_harness(dry, scale, formant_depth=0.0, voice_idx=0):
    in_path = os.path.join(HERE, "_rxv_in.f32")
    out_path = os.path.join(HERE, "_rxv_out.f32")
    dry.astype(np.float32).tofile(in_path)
    subprocess.run(
        [HARNESS_BIN, in_path, out_path, str(scale), str(formant_depth), str(voice_idx)],
        cwd=HERE, check=True,
    )
    out = np.fromfile(out_path, dtype=np.float32)
    os.remove(in_path)
    os.remove(out_path)
    return out


def run_lock_test(filename, true_hz, shift_semitones=LOCK_SHIFT_SEMITONES, formant_depth=0.0):
    path = os.path.join(HERE, filename)
    dry = load_to_48k_mono_f32(path)
    lead_n = int(LEAD_IN_S * SR)
    tail_n = int(TAIL_S * SR)
    n = lead_n + len(dry) + tail_n
    padded = np.zeros(n, dtype=np.float32)
    padded[lead_n:lead_n + len(dry)] = dry

    scale = 2.0 ** (shift_semitones / 12.0)
    wet = run_harness(padded, scale, formant_depth)

    expected_hz = float(true_hz) * scale
    lo = max(20.0, expected_hz * 0.55)
    hi = min(SR / 2.0 - 100.0, expected_hz * 1.8)
    measured_hz = measure_freq_windowed(
        wet, SR, MEASURE_START_S, MEASURE_END_S, min_hz=lo, max_hz=hi
    )
    cents = cents_diff(measured_hz, expected_hz)

    return dict(
        file=filename,
        true_hz=true_hz,
        shift_semitones=shift_semitones,
        formant_depth=formant_depth,
        expected_hz=expected_hz,
        measured_hz=measured_hz,
        cents=cents,
    )


def main():
    print("Testing the polyphonic key-lock shifter engine (EngineSoladSnac x6, "
          "pitch_poly_ffi.h) directly via a standalone C++ harness -- DawDreamer's "
          "JIT can no longer compile multitranspose.dsp directly since it pulls in "
          "pitch_poly.dsp's ffunction (see AGENTS.md's multitranspose.dsp section).")
    ensure_harness()

    results = []
    for fname, true_hz in REAL_FILES.items():
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            print("SKIP (missing file):", fname)
            continue
        r = run_lock_test(fname, true_hz)
        results.append(r)
        print(
            "%-32s true=%9.3fHz target=+%dst expected=%9.3fHz measured=%9.3fHz  %+8.2f cents"
            % (fname, r["true_hz"], r["shift_semitones"], r["expected_hz"], r["measured_hz"], r["cents"])
        )

    if not results:
        print("no corpus .aiff files present locally; nothing to verify")
        return 0

    with open(os.path.join(HERE, "_real_audio_cross_verify_results.json"), "w") as f:
        json.dump(results, f, indent=2)

    worst = max(results, key=lambda r: abs(r["cents"]))
    print("\nworst case: %s at %.2f cents" % (worst["file"], worst["cents"]))

    n_fail = sum(1 for r in results if abs(r["cents"]) > 60.0)
    print("files tested: %d, files over 60 cents: %d" % (len(results), n_fail))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
