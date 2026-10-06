import csv
import sys
import glob
import os
import statistics


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


FRAC = 0.06

for path in sorted(glob.glob("real_*.csv")):
    rows = load(path)
    aud = [r for r in rows if r["voicedFrac"] > 0.5 and r["valid"] == 1]
    if len(aud) < 20:
        continue
    med_p = statistics.median(r["periodF"] for r in aud)
    clean, garb = [], []
    for r in aud:
        rel = abs(r["periodF"] - med_p) / med_p
        (garb if rel > FRAC else clean).append(r)
    name = os.path.basename(path)[5:-4]
    print("%-30s medPeriod=%.1f (%.1f Hz)  clean=%d garb=%d" %
          (name, med_p, 48000.0 / med_p, len(clean), len(garb)))
    for tag, grp in (("CLEAN", clean), ("GARB", garb)):
        if not grp:
            print("    %-5s n=0" % tag)
            continue
        cs = sorted(r["conf"] for r in grp)
        n = len(cs)
        print("    %-5s n=%-4d confP10=%.3f med=%.3f  f>=0.90=%.3f f>=0.95=%.3f"
              % (tag, n, cs[n // 10], cs[n // 2],
                 sum(1 for c in cs if c >= 0.90) / n,
                 sum(1 for c in cs if c >= 0.95) / n))
    print()

print("=== where do the low-confidence audible frames sit in time? (baritone scale) ===")
rows = load("real_vocal_male_baritone_scale.csv")
aud = [r for r in rows if r["voicedFrac"] > 0.5]
med_p = statistics.median(r["periodF"] for r in aud if r["valid"] == 1)
for r in aud:
    rel = abs(r["periodF"] - med_p) / med_p
    mark = "GARB" if rel > FRAC else "    "
    flag = "LOWCONF" if r["conf"] < 0.90 else "       "
    print("  s=%-8d conf=%.3f period=%-7.1f hz=%-7.1f %s %s"
          % (r["sample"], r["conf"], r["periodF"], 48000.0 / r["periodF"], mark, flag))
