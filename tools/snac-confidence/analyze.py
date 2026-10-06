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


def split(rows):
    voiced = [r for r in rows if r["truePeriod"] > 0.0]
    unvoiced = [r for r in rows if r["truePeriod"] <= 0.0]
    return voiced, unvoiced


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "baseline.csv"
    rows = load(path)
    voiced, unvoiced = split(rows)

    print("rows=%d voiced=%d unvoiced=%d" % (len(rows), len(voiced), len(unvoiced)))

    good = [r for r in voiced if abs(r["errCents"]) <= TOL_CENTS]
    bad = [r for r in voiced if abs(r["errCents"]) > TOL_CENTS]
    print("voiced good(|err|<=%g)=%d  voiced bad=%d (%.1f%% bad)"
          % (TOL_CENTS, len(good), len(bad), 100.0 * len(bad) / max(1, len(voiced))))

    def stats(name, xs):
        if not xs:
            print("%-28s n=0" % name)
            return
        xs = sorted(xs)
        n = len(xs)
        print("%-28s n=%-5d min=%.3f p10=%.3f p25=%.3f med=%.3f p75=%.3f p90=%.3f max=%.3f mean=%.3f"
              % (name, n, xs[0], xs[n // 10], xs[n // 4], xs[n // 2], xs[3 * n // 4],
                 xs[9 * n // 10], xs[-1], sum(xs) / n))

    stats("conf GOOD voiced", [r["conf"] for r in good])
    stats("conf BAD voiced", [r["conf"] for r in bad])
    stats("conf UNVOICED", [r["conf"] for r in unvoiced])

    print()
    print("per-case voiced error rate and median confidence:")
    labels = sorted(set(r["label"] for r in rows))
    for lab in labels:
        sub = [r for r in rows if r["label"] == lab]
        v = [r for r in sub if r["truePeriod"] > 0.0]
        u = [r for r in sub if r["truePeriod"] <= 0.0]
        if v:
            b = sum(1 for r in v if abs(r["errCents"]) > TOL_CENTS)
            cs = sorted(r["conf"] for r in v)
            print("  %-11s voiced n=%-4d bad=%-4d (%5.1f%%)  medConf=%.3f"
                  % (lab, len(v), b, 100.0 * b / len(v), cs[len(cs) // 2]))
        if u:
            cs = sorted(r["conf"] for r in u)
            print("  %-11s UNVOIC n=%-4d                      medConf=%.3f"
                  % (lab, len(u), cs[len(cs) // 2]))

    print()
    print("threshold sweep (accept when conf >= T):")
    print("   %-6s %-9s %-9s %-11s %-11s %-9s" %
          ("T", "recall", "garbage", "garbRate", "unvoicAcc", "score"))
    best = None
    T = 0.0
    while T <= 1.0001:
        acc = [r for r in voiced if r["conf"] >= T]
        if acc:
            keep = sum(1 for r in acc if abs(r["errCents"]) <= TOL_CENTS)
            garb = len(acc) - keep
            recall = keep / len(good) if good else 0.0
        else:
            keep = 0
            garb = 0
            recall = 0.0
        ua = sum(1 for r in unvoiced if r["conf"] >= T)
        urate = ua / len(unvoiced) if unvoiced else 0.0
        grate = garb / len(acc) if acc else 0.0
        score = recall - grate - urate
        if best is None or score > best[1]:
            best = (T, score)
        if abs(T * 100 - round(T * 100)) < 1e-6 and round(T * 100) % 5 == 0:
            print("   %-6.2f %-9.3f %-9d %-11.3f %-11.3f %-9.3f"
                  % (T, recall, garb, grate, urate, score))
        T += 0.01
    print("   best T=%.2f score=%.3f" % (best[0], best[1]))


main()
