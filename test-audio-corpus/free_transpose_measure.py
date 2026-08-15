import json
import numpy as np

from corpus_common import measure_freq_windowed, cents_diff, TARGET_SR

SR = TARGET_SR

REAL_FILES = {
    "Guitar.mf.sulE.E2": 80.616,
    "Xylophone.rosewood.mf.C6": 1053.841,
    "Crotale.C7.ff": 2128.390,
    "Crotale.C8.ff": 4266.999,
    "Tuba.mf.C2": 66.087,
    "Bassoon.mf.Bb1": 58.778,
    "Bass.arco.sulC.mf.C1": 32.537,
    "Vocal.m2.long_straight_a": 125.157,
    "Vocal.f7.long_forte_a": 262.296,
    "Vocal.f6.long_trill_a": 264.468,
}

PITCH_SCALE = 0.5

MEASURE_WINDOWS = {
    "default": [(0.2, 0.5), (0.4, 0.7), (0.6, 0.9)],
    "Guitar.mf.sulE.E2": [(0.7, 0.9), (0.9, 1.1), (1.1, 1.3)],
    "Xylophone.rosewood.mf.C6": [(0.04, 0.19), (0.08, 0.23), (0.12, 0.27)],
    "Crotale.C7.ff": [(0.3, 0.6), (0.6, 0.9), (0.9, 1.2)],
    "Crotale.C8.ff": [(0.3, 0.5), (0.5, 0.7), (0.7, 0.9)],
    "Bassoon.mf.Bb1": [(0.4, 0.55), (0.5, 0.65), (0.6, 0.75)],
    "Bass.arco.sulC.mf.C1": [(0.15, 0.3), (0.2, 0.35), (0.25, 0.4)],
    "Vocal.m2.long_straight_a": [(0.3, 0.5), (0.5, 0.7), (0.6, 0.8)],
    "Vocal.f7.long_forte_a": [(0.04, 0.14), (0.05, 0.15), (0.06, 0.16)],
    "Vocal.f6.long_trill_a": [(0.08, 0.14), (0.1, 0.16), (0.12, 0.18)],
}


def main():
    results = []
    for base, true_hz in REAL_FILES.items():
        out_path = base + "_ft.f32"
        out = np.fromfile(out_path, dtype=np.float32)
        expected_hz = true_hz * PITCH_SCALE

        windows = MEASURE_WINDOWS.get(base, MEASURE_WINDOWS["default"])
        lo = max(15.0, expected_hz * 0.55)
        hi = expected_hz * 1.8

        cents_list = []
        for (a, b) in windows:
            m = measure_freq_windowed(out, SR, a, b, min_hz=lo, max_hz=hi)
            c = cents_diff(m, expected_hz)
            cents_list.append(c)

        worst = max(cents_list, key=lambda c: abs(c))
        mean_measured = expected_hz * (2.0 ** (np.mean(cents_list) / 1200.0))

        r = dict(
            file=base, true_hz=true_hz, expected_hz=expected_hz,
            cents_per_window=cents_list, worst_cents=worst,
        )
        results.append(r)
        print(
            "%-28s true=%9.3fHz expected(-12)=%9.3fHz  cents=%s  worst=%+7.2f"
            % (base, true_hz, expected_hz, ["%+.2f" % c for c in cents_list], worst)
        )

    with open("_free_transpose_results.json", "w") as f:
        json.dump(results, f, indent=2)

    n_fail = sum(1 for r in results if abs(r["worst_cents"]) > 100.0)
    print("\nfiles tested: %d, files over 100 cents worst-case: %d" % (len(results), n_fail))


if __name__ == "__main__":
    main()
