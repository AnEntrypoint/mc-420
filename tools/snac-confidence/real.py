import csv
import sys
import glob
import os


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


print("%-34s %6s %8s %8s %8s %8s %8s %8s" %
      ("file", "nAud", "confP10", "confMed", "f>=0.90", "f>=0.95", "f>=0.98", "medErr"))
for path in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "real_*.csv")):
    rows = load(path)
    aud = [r for r in rows if r["voicedFrac"] > 0.5]
    if not aud:
        continue
    cs = sorted(r["conf"] for r in aud)
    n = len(cs)
    errs = [r["errCents"] for r in aud if r["truePeriod"] > 0.0]
    errs.sort()
    medErr = errs[len(errs) // 2] if errs else float("nan")
    print("%-34s %6d %8.3f %8.3f %8.3f %8.3f %8.3f %8.1f" %
          (os.path.basename(path)[5:-4], n, cs[n // 10], cs[n // 2],
           sum(1 for c in cs if c >= 0.90) / n,
           sum(1 for c in cs if c >= 0.95) / n,
           sum(1 for c in cs if c >= 0.98) / n,
           medErr))

print()
print("silence / non-audible frames (want LOW confidence):")
for path in sorted(glob.glob("real_*.csv")):
    rows = load(path)
    sil = [r for r in rows if r["voicedFrac"] <= 0.5]
    if not sil:
        continue
    cs = sorted(r["conf"] for r in sil)
    n = len(cs)
    print("  %-32s n=%-4d med=%.3f  frac>=0.90=%.3f  frac>=0.95=%.3f" %
          (os.path.basename(path)[5:-4], n, cs[n // 2],
           sum(1 for c in cs if c >= 0.90) / n,
           sum(1 for c in cs if c >= 0.95) / n))
