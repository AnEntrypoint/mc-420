import csv
import sys
import math

TOL_CENTS = 50.0


def load(path):
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            for k in ("det", "sample", "valid", "peakTau"):
                r[k] = int(r[k])
            for k in ("conf", "periodF", "truePeriod", "errCents", "voicedFrac", "rms", "peakVal"):
                r[k] = float(r[k])
            rows.append(r)
    return rows


rows = load(sys.argv[1] if len(sys.argv) > 1 else "baseline.csv")

print("=== high-confidence BAD voiced frames: what kind of error? ===")
bad = [r for r in rows if r["truePeriod"] > 0.0 and abs(r["errCents"]) > TOL_CENTS]
hibad = [r for r in bad if r["conf"] >= 0.90]
print("bad=%d  bad&conf>=0.90=%d" % (len(bad), len(hibad)))
oct_ = 0
for r in hibad:
    ratio = r["periodF"] / r["truePeriod"]
    n = round(math.log2(ratio))
    print("  %-10s conf=%.3f period=%.1f true=%.1f ratio=%.3f  ~2^%d  err=%.0fc"
          % (r["label"], r["conf"], r["periodF"], r["truePeriod"], ratio, n, r["errCents"]))
    if abs(math.log2(ratio) - n) < 0.15:
        oct_ += 1
print("  of those, %d are ~octave (period x2^k) errors" % oct_)

print()
print("=== noisySine / noisyHarm by confidence band: error rate ===")
for lab in ("noisySine", "noisyHarm"):
    sub = [r for r in rows if r["label"] == lab and r["truePeriod"] > 0.0]
    if not sub:
        continue
    print("  %s (n=%d)" % (lab, len(sub)))
    lo = 0.0
    while lo < 1.0:
        hi = lo + 0.10
        band = [r for r in sub if lo <= r["conf"] < hi]
        if band:
            b = sum(1 for r in band if abs(r["errCents"]) > TOL_CENTS)
            print("    conf [%.2f,%.2f) n=%-4d bad=%-4d (%5.1f%%)"
                  % (lo, hi, len(band), b, 100.0 * b / len(band)))
        lo = hi

print()
print("=== unvoiced frames: confidence inherited from last voiced detection? ===")
unv = [r for r in rows if r["truePeriod"] <= 0.0]
print("  unvoiced n=%d  fraction with conf>=0.65: %.3f"
      % (len(unv), sum(1 for r in unv if r["conf"] >= 0.65) / max(1, len(unv))))
by_lab = {}
for r in unv:
    by_lab.setdefault(r["label"], []).append(r["conf"])
for lab, cs in sorted(by_lab.items()):
    cs.sort()
    print("    %-10s n=%-4d med=%.3f  frac>=0.65=%.3f"
          % (lab, len(cs), cs[len(cs) // 2],
             sum(1 for c in cs if c >= 0.65) / len(cs)))
