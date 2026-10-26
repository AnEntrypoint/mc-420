import hashlib
import json
import math
import pathlib
import sys

TARGET_HZ = 2093.005
S1_CENTS = 50.0
LISTED = ["vibraphone_mid_C5B5", "piano_low_A1", "xylophone_run_C7B7", "marimba_mid_C5B5", "oboe_mid_C5B5", "cymbal_inharmonic", "crotale_high_C7"]
R5_SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440", "sine_1000"]


def load(root, variant):
    p = pathlib.Path(root) / ("settled-" + variant + ".json")
    if not p.is_file():
        print("RESULT: REFUSED missing " + str(p))
        sys.exit(2)
    print("input " + p.name + " sha256 " + hashlib.sha256(p.read_bytes()).hexdigest())
    return {r["file"]: r for r in json.loads(p.read_text())["rows"]}


def move(a, b):
    if a == 0.0 and b == 0.0:
        return 0.0
    if a == 0.0 or b == 0.0:
        return math.inf
    return 1200.0 * math.log2(a / b)


def fmt(d):
    return "inf" if math.isinf(d) else "%.2f c" % d


def main():
    if len(sys.argv) != 2:
        print("RESULT: REFUSED usage: judge_2093_gated.py <artifact root>")
        sys.exit(2)
    root = sys.argv[1]
    base = load(root, "base")
    gated = load(root, "gated")
    tau = load(root, "gated-tau01")
    fails = []

    def check(name, ok, detail):
        print(name + " " + ("PASS" if ok else "FAIL") + " " + detail)
        if not ok:
            fails.append(name)

    s1_ok = True
    s1_detail = []
    for label, table in (("gated", gated), ("gated-tau01", tau)):
        row = table["sine_2093"]
        d = move(row["settled_hz"], TARGET_HZ)
        ok = abs(d) <= S1_CENTS and row["voiced_blocks"] > 0
        s1_ok = s1_ok and ok
        s1_detail.append("%s %.2f Hz %s" % (label, row["settled_hz"], fmt(d)))
    check("S1", s1_ok, "; ".join(s1_detail))

    listed_ok = True
    listed_detail = []
    for f in LISTED:
        d = move(gated[f]["settled_hz"], base[f]["settled_hz"])
        same_voiced = gated[f]["voiced_blocks"] == base[f]["voiced_blocks"]
        ok = abs(d) <= 5.0 and same_voiced
        listed_ok = listed_ok and ok
        listed_detail.append("%s %s voiced %d to %d%s" % (f, fmt(d), base[f]["voiced_blocks"], gated[f]["voiced_blocks"], "" if ok else " FAIL"))
    check("L", listed_ok, "; ".join(listed_detail))

    r5_ok = True
    r5_detail = []
    for s in R5_SINES:
        d = move(gated[s]["settled_hz"], base[s]["settled_hz"])
        same_voiced = gated[s]["voiced_blocks"] == base[s]["voiced_blocks"]
        ok = abs(d) <= 1.0 and same_voiced
        r5_ok = r5_ok and ok
        r5_detail.append("%s %s" % (s, fmt(d)))
    check("R5", r5_ok, "; ".join(r5_detail))

    print("REPORT-ONLY base to gated (settled Hz, voiced) and gated-tau01 settled Hz")
    for f in sorted(base):
        g = gated.get(f)
        t = tau.get(f)
        if g is None or t is None:
            continue
        d = move(g["settled_hz"], base[f]["settled_hz"])
        print("  %s base %.2f/%d gated %.2f/%d (%s) tau01 %.2f" % (f, base[f]["settled_hz"], base[f]["voiced_blocks"], g["settled_hz"], g["voiced_blocks"], fmt(d), t["settled_hz"]))

    if fails:
        print("RESULT: REJECTED " + ",".join(fails))
    else:
        print("RESULT: ADMIT")


if __name__ == "__main__":
    main()
