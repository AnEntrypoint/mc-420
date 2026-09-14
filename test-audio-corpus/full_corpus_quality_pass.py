import os
import sys
import json
import subprocess
import numpy as np

from corpus_common import (
    load_to_48k_mono_f32,
    measure_freq_windowed,
    cents_diff,
    find_sustained_segment,
    TARGET_SR,
)

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS_SRC = os.path.join(HERE, "multitranspose_harness.cpp")
HARNESS_BIN = os.path.join(HERE, "multitranspose_harness.exe")
INSTR_DIR = os.path.join(HERE, "instruments")

SR = TARGET_SR
SHIFTS = [-12.0, -7.0, 0.0, 7.0, 12.0]
FORMANTS = [-1.5, 0.0, 1.0, 1.5]
CENTS_FAIL_THRESHOLD = 60.0
DEGRADATION_FAIL_THRESHOLD = 6.0


def ensure_harness():
    if os.path.exists(HARNESS_BIN) and os.path.getmtime(HARNESS_BIN) > os.path.getmtime(HARNESS_SRC):
        return
    effects_dir = os.path.join(HERE, "..", "effects", "home", "faust")
    subprocess.run(
        ["g++", "-std=c++17", "-O2", "-D_USE_MATH_DEFINES", "-I", effects_dir,
         HARNESS_SRC, "-o", HARNESS_BIN],
        cwd=HERE, check=True,
    )


def run_harness(dry, scale, formant_depth, voice_idx=0):
    in_path = os.path.join(HERE, "_fcqp_in.f32")
    out_path = os.path.join(HERE, "_fcqp_out.f32")
    dry.astype(np.float32).tofile(in_path)
    subprocess.run(
        [HARNESS_BIN, in_path, out_path, str(scale), str(formant_depth), str(voice_idx)],
        cwd=HERE, check=True,
    )
    out = np.fromfile(out_path, dtype=np.float32)
    os.remove(in_path)
    os.remove(out_path)
    return out


def roughness(x):
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 3:
        return 0.0
    d2 = x[2:] - 2.0 * x[1:-1] + x[:-2]
    return float(np.sqrt(np.mean(d2 * d2)))


def click_count(x, thresh_mult=25.0):
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 3:
        return 0
    d = np.abs(x[1:] - x[:-1])
    med = np.median(d)
    if med <= 1e-12:
        med = 1e-9
    return int(np.sum(d > med * thresh_mult))


def main():
    ensure_harness()

    files = sorted(f for f in os.listdir(INSTR_DIR) if f.endswith(".wav"))
    if not files:
        print("no instrument corpus files found in", INSTR_DIR)
        return 1

    results = []
    fail_rows = []

    for fname in files:
        path = os.path.join(INSTR_DIR, fname)
        dry_full = load_to_48k_mono_f32(path)

        seg_start_s, seg_end_s = find_sustained_segment(dry_full, SR)
        if seg_end_s - seg_start_s < 0.25:
            seg_start_s, seg_end_s = 0.0, len(dry_full) / SR

        true_hz = measure_freq_windowed(dry_full, SR, seg_start_s, seg_end_s, min_hz=40.0, max_hz=1800.0)
        if not (true_hz == true_hz) or true_hz <= 0:
            print("SKIP (no pitch detected):", fname)
            continue

        lead_n = int(0.15 * SR)
        tail_n = int(0.5 * SR)
        padded = np.zeros(lead_n + len(dry_full) + tail_n, dtype=np.float32)
        padded[lead_n:lead_n + len(dry_full)] = dry_full

        m_start = lead_n + int(seg_start_s * SR) + int(0.05 * SR)
        m_end = lead_n + int(seg_end_s * SR)
        if m_end - m_start < int(0.1 * SR):
            m_end = m_start + int(0.1 * SR)

        dry_window = padded[m_start:m_end]
        dry_roughness = roughness(dry_window)
        if dry_roughness < 1e-9:
            dry_roughness = 1e-9

        for shift in SHIFTS:
            scale = 2.0 ** (shift / 12.0)
            expected_hz = true_hz * scale
            lo = max(20.0, expected_hz * 0.55)
            hi = min(SR / 2.0 - 100.0, expected_hz * 1.8)

            for formant in FORMANTS:
                wet = run_harness(padded, scale, formant)
                wet_window = wet[m_start:m_end]

                measured_hz = measure_freq_windowed(wet, SR, m_start / SR, m_end / SR, min_hz=lo, max_hz=hi)
                cents = cents_diff(measured_hz, expected_hz)

                wet_roughness = roughness(wet_window)
                degradation = wet_roughness / dry_roughness

                clicks = click_count(wet_window)

                finite = bool(np.all(np.isfinite(wet)))
                max_abs = float(np.max(np.abs(wet))) if len(wet) else 0.0

                row = dict(
                    file=fname, true_hz=round(true_hz, 3), shift=shift, formant=formant,
                    expected_hz=round(expected_hz, 3), measured_hz=round(measured_hz, 3) if measured_hz == measured_hz else None,
                    cents=round(cents, 2) if cents == cents else None,
                    degradation=round(degradation, 3), clicks=clicks,
                    finite=finite, max_abs=round(max_abs, 4),
                )
                results.append(row)

                bad = (not finite) or max_abs > 4.5 or (cents == cents and abs(cents) > CENTS_FAIL_THRESHOLD) \
                    or degradation > DEGRADATION_FAIL_THRESHOLD
                if bad:
                    fail_rows.append(row)

        print("%-28s true=%8.2fHz  worst_cents=%+7.2f  worst_degr=%.2f" % (
            fname, true_hz,
            max((r["cents"] for r in results if r["file"] == fname and r["cents"] is not None), key=abs, default=float("nan")),
            max((r["degradation"] for r in results if r["file"] == fname), default=0.0),
        ))

    with open(os.path.join(HERE, "_full_corpus_quality_results.json"), "w") as f:
        json.dump(results, f, indent=2)

    print("\n=== SUMMARY ===")
    print("files:", len(files), " total configs:", len(results), " fail rows:", len(fail_rows))
    if fail_rows:
        print("\n--- FAILURES (cents>%.0f or degradation>%.1f or non-finite/clipped) ---" % (CENTS_FAIL_THRESHOLD, DEGRADATION_FAIL_THRESHOLD))
        for r in fail_rows:
            print(r)
    return 0 if not fail_rows else 1


if __name__ == "__main__":
    sys.exit(main())
