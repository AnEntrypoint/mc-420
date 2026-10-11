#!/usr/bin/env python3
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyze_chain import best_lag, db, read_wav, rms


def compare(a_path, b_path, skip_s=0.25, maxd=4096):
    sr_a, a = read_wav(a_path)
    sr_b, b = read_wav(b_path)
    if sr_a != sr_b:
        raise ValueError("sample rate mismatch %d vs %d" % (sr_a, sr_b))

    sk = int(skip_s * sr_a)
    a = a[sk:]
    b = b[sk:]
    n = min(len(a), len(b))
    a = a[:n]
    b = b[:n]
    if n < 8192:
        raise ValueError("too few samples after trim: %d" % n)

    lag, corr = best_lag(a, b, maxd)
    L = abs(lag)
    m = n - L
    if lag >= 0:
        xs = a[0:m]
        ys = b[lag:lag + m]
    else:
        xs = a[-lag:-lag + m]
        ys = b[0:m]

    denom = float(np.dot(xs, xs))
    g = float(np.dot(xs, ys) / denom) if denom > 0 else 0.0

    r_nofit = ys - xs
    r_fit = ys - g * xs

    ref = rms(xs)
    out = {
        "samples": int(m),
        "lag": int(lag),
        "corr": corr,
        "gain": g,
        "gain_db": db(abs(g)) if abs(g) > 0 else -999.0,
        "a_rms_dbfs": db(rms(xs)),
        "b_rms_dbfs": db(rms(ys)),
        "nofit_rel_db": db(rms(r_nofit) / ref) if ref > 0 else -999.0,
        "fit_rel_db": db(rms(r_fit) / ref) if ref > 0 else -999.0,
        "nofit_rms_dbfs": db(rms(r_nofit)),
        "b_nonfinite": int(np.count_nonzero(~np.isfinite(ys))),
    }
    return out


def decide(value, rule, thresh):
    if rule == "le":
        return value <= thresh
    if rule == "ge":
        return value >= thresh
    raise ValueError("unknown rule %s" % rule)


def fmt(v, nd=2):
    if v is None:
        return "n/a"
    if v <= -900.0:
        return "0 (exact)"
    return ("%." + str(nd) + "f") % v


def main():
    if len(sys.argv) != 2:
        print("usage: parity.py <manifest.tsv>")
        return 2
    man_path = sys.argv[1]

    rows = []
    with open(man_path) as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            rows.append(line.split("\t"))

    failures = 0
    observes = 0
    print("%-9s %-14s %-12s %-22s %-10s" % ("KIND", "CASE", "RULE", "RESIDUAL (no gain fit)", "VERDICT"))
    print("-" * 96)

    for row in rows:
        kind, case, probe, pa, pb, rule, thresh = row[0], row[1], row[2], row[3], row[4], row[5], float(row[6])
        if not os.path.exists(pa):
            print("%-9s %-14s missing %s" % (kind, case, pa))
            failures += 1
            continue
        if not os.path.exists(pb):
            print("%-9s %-14s missing %s" % (kind, case, pb))
            failures += 1
            continue

        r = compare(pa, pb)
        if r["b_nonfinite"] > 0:
            print("%-9s %-14s nonfinite samples in %s: %d" % (kind, case, pb, r["b_nonfinite"]))
            failures += 1
            continue

        value = r["nofit_rel_db"]
        ok = decide(value, rule, thresh)
        label = "%s %+.1f dB" % (rule, thresh)

        if kind == "observe":
            observes += 1
            verdict = "observed"
        else:
            verdict = "PASS" if ok else "FAIL"
            if not ok:
                failures += 1

        print("%-9s %-14s %-12s %-22s %-10s" % (kind, case, label, fmt(value), verdict))
        print("           probe=%s  lag=%+d  gain=%+.4f dB  a_rms=%s dBFS  b_rms=%s dBFS  gainfit_residual=%s" % (
            probe, r["lag"], r["gain_db"], fmt(r["a_rms_dbfs"]), fmt(r["b_rms_dbfs"]), fmt(r["fit_rel_db"])))

    print("-" * 96)
    print("cases=%d  observed=%d  gated=%d  failures=%d" % (
        len(rows), observes, len(rows) - observes, failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
