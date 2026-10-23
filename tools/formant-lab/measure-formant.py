#!/usr/bin/env python3
"""Render the corpus through the SOLA engine's formant layer and score it.

Metrics, gates and thresholds are pre-registered on PRD row means-formant-layer-measured.
  ENV(x)   = log2(spectral centroid of render x / spectral centroid of the dry source), octaves
  M1 ECS(d) = ENV(d) - ENV(0)                       control authority + monotonicity
  M2 L(d)   = 20*log10(rms(d)/rms(0))               loudness neutrality
  M3 AM     = p95-p5 of 20 ms frame RMS, dB         added amplitude modulation
  M4 SEE(d) = |ECS(d) - d|                          formant accuracy in octaves
  M5 RIPPLE = peak-to-trough of the 1/3-octave log magnitude envelope, 200-4000 Hz, dB
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from statistics import median

SEMIS = [-12.0, 0.0, 12.0]
DIALS = [-1.0, 0.0, 1.0]

GATE_ECS_MIN = 0.15
GATE_L_MEDIAN = 1.5
GATE_L_WORST = 3.0
GATE_AM_MEDIAN = 2.0
GATE_SEE_MEDIAN = 1.00
STRETCH_SEE_MEDIAN = 0.50
GATE_RIPPLE_MEDIAN = 3.0
GATE_MONOTONE_FRAC = 0.80


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def meter(meter_bin, label, path):
    r = run([meter_bin, label, path])
    if r.returncode != 0:
        sys.exit("meter failed on %s: %s" % (path, r.stderr.strip()))
    out = {}
    for line in r.stdout.strip().splitlines():
        f = line.split("\t")
        vals = dict(p.split("=") for p in f[2:])
        out[f[0]] = {
            "centroid": float(vals["centroid"]),
            "rms": float(vals["rms"]),
            "am": float(vals["am"]),
            "ripple": float(vals["ripple"]),
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsp-cli", required=True)
    ap.add_argument("--meter", required=True)
    ap.add_argument("--corpus", default="test-audio-corpus/instruments")
    ap.add_argument("--out", default=None)
    ap.add_argument("--semis", default=",".join(str(int(s)) for s in SEMIS))
    ap.add_argument("--dials", default=",".join(str(int(d)) for d in DIALS))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--enforce",
                    default="authority,monotone,lmedian,lworst,am,see,ripple",
                    help="comma-separated gate names to fail on")
    args = ap.parse_args()

    enforce = set(g.strip() for g in args.enforce.split(",") if g.strip())

    semis = [float(v) for v in args.semis.split(",")]
    dials = [float(v) for v in args.dials.split(",")]
    files = sorted(p for p in os.listdir(args.corpus) if p.endswith(".wav"))
    if args.limit:
        files = files[: args.limit]
    if not files:
        sys.exit("no corpus wavs in %s" % args.corpus)

    work = args.out or tempfile.mkdtemp(prefix="formant-lab-")
    os.makedirs(work, exist_ok=True)
    owned = args.out is None

    try:
        rows = []
        for name in files:
            src = os.path.join(args.corpus, name)
            stem = name[:-4]
            dry = meter(args.meter, "dry", src)["dry"]
            if dry["centroid"] <= 0.0:
                print("skip %s: no usable dry centroid" % name)
                continue
            meas = {}
            for s in semis:
                for d in dials:
                    tag = "s%+.0f_d%+.0f" % (s, d)
                    wav = os.path.join(work, "%s_%s.wav" % (stem, tag))
                    r = run([args.dsp_cli, "--solad", "in=" + src, "out=" + wav,
                             "semis=%g" % s, "formant=%g" % d])
                    if r.returncode != 0 or not os.path.exists(wav):
                        sys.exit("render failed %s %s: %s" % (name, tag, r.stderr.strip()))
                    meas[(s, d)] = meter(args.meter, tag, wav)[tag]
            for s in semis:
                base = meas[(s, 0.0)]
                env0 = log2ratio(base["centroid"], dry["centroid"])
                for d in dials:
                    if d == 0.0:
                        continue
                    m = meas[(s, d)]
                    env = log2ratio(m["centroid"], dry["centroid"])
                    rows.append({
                        "file": stem,
                        "semis": s,
                        "dial": d,
                        "ecs": env - env0,
                        "L": m["rms"] - base["rms"],
                        "am": m["am"] - base["am"],
                        "ripple": m["ripple"] - base["ripple"],
                    })

        print("%-28s %6s %5s %8s %8s %8s %8s" % ("file", "semis", "dial", "ECS(oct)", "L(dB)", "dAM(dB)", "dRip(dB)"))
        for r in rows:
            print("%-28s %+6.0f %+5.0f %+8.3f %+8.2f %+8.2f %+8.2f"
                  % (r["file"], r["semis"], r["dial"], r["ecs"], r["L"], r["am"], r["ripple"]))

        print("\n-- aggregate (median over %d file/dial cases) --" % len(rows))
        pos = [r for r in rows if r["dial"] > 0]
        neg = [r for r in rows if r["dial"] < 0]
        checks = []
        ecs_pos = median(abs(r["ecs"]) for r in pos)
        ecs_neg = median(abs(r["ecs"]) for r in neg)
        print("  median |ECS(+1)|            %.3f oct   gate >= %.2f" % (ecs_pos, GATE_ECS_MIN))
        print("  median |ECS(-1)|            %.3f oct   gate >= %.2f" % (ecs_neg, GATE_ECS_MIN))
        checks.append(("M1 authority +1", "authority", ecs_pos >= GATE_ECS_MIN))
        checks.append(("M1 authority -1", "authority", ecs_neg >= GATE_ECS_MIN))

        mono = sum(1 for r in rows if (r["dial"] < 0 and r["ecs"] < 0) or (r["dial"] > 0 and r["ecs"] > 0))
        mono_frac = mono / float(len(rows))
        print("  monotone sign fraction      %.3f       gate >= %.2f" % (mono_frac, GATE_MONOTONE_FRAC))
        checks.append(("M1 monotonicity", "monotone", mono_frac >= GATE_MONOTONE_FRAC))

        l_med = median(abs(r["L"]) for r in rows)
        l_max = max(abs(r["L"]) for r in rows)
        print("  median |L|                  %.2f dB    gate <= %.2f" % (l_med, GATE_L_MEDIAN))
        print("  worst  |L|                  %.2f dB    gate <= %.2f" % (l_max, GATE_L_WORST))
        checks.append(("M2 loudness median", "lmedian", l_med <= GATE_L_MEDIAN))
        checks.append(("M2 loudness worst", "lworst", l_max <= GATE_L_WORST))

        am_med = median(r["am"] for r in rows)
        print("  median dAM                  %+.2f dB   gate <= %.2f" % (am_med, GATE_AM_MEDIAN))
        checks.append(("M3 added modulation", "am", am_med <= GATE_AM_MEDIAN))

        see_med = median(abs(r["ecs"] - r["dial"]) for r in rows)
        print("  median SEE                  %.3f oct   gate <= %.2f  stretch <= %.2f"
              % (see_med, GATE_SEE_MEDIAN, STRETCH_SEE_MEDIAN))
        checks.append(("M4 accuracy gate", "see", see_med <= GATE_SEE_MEDIAN))

        rip_med = median(r["ripple"] for r in rows)
        print("  median dRIPPLE              %+.2f dB   gate <= %.2f" % (rip_med, GATE_RIPPLE_MEDIAN))
        checks.append(("M5 added ripple", "ripple", rip_med <= GATE_RIPPLE_MEDIAN))

        print()
        failed = [n for n, key, ok in checks if not ok and key in enforce]
        for n, key, ok in checks:
            print("  %-24s %-8s %s" % (n, "PASS" if ok else "FAIL",
                                       "enforced" if key in enforce else "reported"))
        print()
        if failed:
            print("FAILED: " + ", ".join(failed))
            return 1
        print("PASSED: all pre-registered formant-layer gates met.")
        return 0
    finally:
        if owned:
            shutil.rmtree(work, ignore_errors=True)


def log2ratio(a, b):
    if a <= 0.0 or b <= 0.0:
        return 0.0
    from math import log2
    return log2(a / b)


if __name__ == "__main__":
    sys.exit(main())
