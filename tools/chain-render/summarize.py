#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", dest="jsonl", required=True)
    a = ap.parse_args()

    rows = []
    with open(a.jsonl) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    print("")
    print("=== SUMMARY (sorted by residual, worst first) ===")
    print("%-34s %8s %9s %10s %9s %8s %7s" % (
        "label", "delay", "gain_dB", "res_rel_dB", "aboveEdge", "flat_hf", "harm%"))
    for r in sorted(rows, key=lambda z: -z["res_rel_db"]):
        ae = r.get("above_edge_delta_db")
        fh = r.get("res_flatness_hf")
        hf = r.get("res_harmonic_fraction")
        print("%-34s %8d %9.4f %10s %9s %8s %7s" % (
            r["label"],
            r["delay_samples"],
            r["gain_db"],
            "exact" if r["res_rel_db"] <= -900.0 else "%.2f" % r["res_rel_db"],
            "n/a" if ae is None else "%+.2f" % ae,
            "n/a" if fh is None else "%.4f" % fh,
            "n/a" if hf is None else "%.1f" % (100.0 * hf),
        ))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
