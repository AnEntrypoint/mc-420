import csv
import glob
import os
import statistics

SPEECH = ["voice_", "real_vocal"]


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


allrows = []
for p in sorted(glob.glob("voice_*.csv")) + sorted(glob.glob("real_vocal*.csv")):
    rs = load(p)
    for r in rs:
        r["src"] = os.path.basename(p)
    allrows += rs

print("total detections across %d voice files: %d"
      % (len(set(r["src"] for r in allrows)), len(allrows)))

NB = 40
hist = [0] * NB
for r in allrows:
    b = int(r["conf"] * NB)
    if b >= NB:
        b = NB - 1
    hist[b] += 1
print()
print("confidence histogram over ALL real-voice detections (bin width 0.025):")
peak = max(hist)
for b in range(NB):
    lo = b / float(NB)
    bar = "#" * int(60.0 * hist[b] / peak)
    print("  %.3f-%.3f %6d %s" % (lo, lo + 1.0 / NB, hist[b], bar))

print()
print("audible-only (rms > 0.15*globalRms) histogram:")
aud = [r for r in allrows if r["voicedFrac"] > 0.5]
hist = [0] * NB
for r in aud:
    b = int(r["conf"] * NB)
    if b >= NB:
        b = NB - 1
    hist[b] += 1
peak = max(hist)
for b in range(NB):
    lo = b / float(NB)
    bar = "#" * int(60.0 * hist[b] / peak)
    print("  %.3f-%.3f %6d %s" % (lo, lo + 1.0 / NB, hist[b], bar))

print()
print("fraction of audible voice frames accepted, by threshold:")
for T in (0.80, 0.85, 0.88, 0.90, 0.92, 0.95, 0.97):
    print("   T=%.2f  accept=%.3f" % (T, sum(1 for r in aud if r["conf"] >= T) / len(aud)))

print()
print("per-file audible acceptance:")
for src in sorted(set(r["src"] for r in aud)):
    sub = [r for r in aud if r["src"] == src]
    print("   %-40s n=%-4d  f>=0.90=%.3f  f>=0.95=%.3f"
          % (src, len(sub),
             sum(1 for r in sub if r["conf"] >= 0.90) / len(sub),
             sum(1 for r in sub if r["conf"] >= 0.95) / len(sub)))
