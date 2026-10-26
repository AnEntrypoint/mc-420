import hashlib
import json
import math
import pathlib
import sys

TARGET_HZ = 2093.005
S1_CENTS = 50.0
L_CENTS = 5.0
R5_CENTS = 1.0
MOVE_CENTS = 1.0
MIN_ROWS = 35
LISTED = ["vibraphone_mid_C5B5", "piano_low_A1", "xylophone_run_C7B7", "marimba_mid_C5B5", "oboe_mid_C5B5", "cymbal_inharmonic", "crotale_high_C7"]
R5_SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440", "sine_1000"]
VARIANTS = ["base", "gated", "gated-tau01", "v2", "v2-tau01"]


def refuse(msg):
    print("RESULT: REFUSED " + msg)
    sys.exit(2)


def num(row, key, label):
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(value):
        refuse(label + " " + key + " is not a number: " + repr(value))
    return float(value)


def load(root, variant):
    p = pathlib.Path(root) / ("settled-" + variant + ".json")
    if not p.is_file():
        refuse("missing " + str(p))
    print("input " + p.name + " sha256 " + hashlib.sha256(p.read_bytes()).hexdigest())
    rows = {r["file"]: r for r in json.loads(p.read_text())["rows"]}
    if len(rows) < MIN_ROWS:
        refuse(variant + " has " + str(len(rows)) + " rows")
    for name in LISTED + R5_SINES + ["sine_2093"]:
        if name not in rows:
            refuse(variant + " lacks " + name)
        num(rows[name], "settled_hz", variant + " " + name)
        num(rows[name], "voiced_blocks", variant + " " + name)
    return rows


def move(a, b):
    if a == 0.0 and b == 0.0:
        return 0.0
    if a == 0.0 or b == 0.0:
        return math.inf
    return 1200.0 * math.log2(a / b)


def fmt(d):
    return "inf" if math.isinf(d) else "%.2f c" % d


def cents(x, b, f):
    return move(num(x[f], "settled_hz", f), num(b[f], "settled_hz", f))


def voiced_same(x, b, f):
    return num(x[f], "voiced_blocks", f) == num(b[f], "voiced_blocks", f)


def moved(x, b, f):
    return abs(cents(x, b, f)) > MOVE_CENTS or not voiced_same(x, b, f)


def main():
    if len(sys.argv) != 2:
        refuse("usage: judge_2093_v2.py <artifact root>")
    root = sys.argv[1]
    t = {v: load(root, v) for v in VARIANTS}
    base, gated, v2 = t["base"], t["gated"], t["v2"]
    names = sorted(base)
    for v in VARIANTS:
        if sorted(t[v]) != names:
            refuse(v + " file set differs from base")
    if sum(num(base[f], "voiced_blocks", f) for f in names) <= 0:
        refuse("base has no voiced block in any file")
    fails = []

    def check(label, ok, detail):
        print(label + " " + ("PASS" if ok else "FAIL") + " " + detail)
        if not ok:
            fails.append(label)

    s1_ok = True
    s1_detail = []
    for label in ("v2", "v2-tau01"):
        row = t[label]["sine_2093"]
        d = move(num(row, "settled_hz", label), TARGET_HZ)
        ok = abs(d) <= S1_CENTS and num(row, "voiced_blocks", label) > 0
        s1_ok = s1_ok and ok
        s1_detail.append("%s %.3f Hz %s" % (label, row["settled_hz"], fmt(d)))
    check("S1", s1_ok, "; ".join(s1_detail))

    l_ok = True
    l_detail = []
    for f in LISTED:
        d = cents(v2, base, f)
        ok = abs(d) <= L_CENTS and voiced_same(v2, base, f)
        l_ok = l_ok and ok
        l_detail.append("%s %s voiced %d to %d" % (f, fmt(d), base[f]["voiced_blocks"], v2[f]["voiced_blocks"]))
    check("L", l_ok, "; ".join(l_detail))

    r5_ok = True
    r5_detail = []
    for s in R5_SINES:
        d = cents(v2, base, s)
        ok = abs(d) <= R5_CENTS and voiced_same(v2, base, s)
        r5_ok = r5_ok and ok
        r5_detail.append("%s %s" % (s, fmt(d)))
    check("R5", r5_ok, "; ".join(r5_detail))

    moved_v2 = {f for f in names if moved(v2, base, f)}
    moved_gated = {f for f in names if moved(gated, base, f)}
    extra = sorted(moved_v2 - moved_gated)
    mid2_detail = "extra " + (", ".join("%s %s" % (f, fmt(cents(v2, base, f))) for f in extra) if extra else "none")
    check("MID2", not extra, mid2_detail + "; base-moved v2 " + str(len(moved_v2)) + " gated " + str(len(moved_gated)))

    changed = [f for f in names if moved(v2, gated, f)]
    print("MID1 reported (v2 versus gated, no threshold): " + str(len(changed)) + " files")
    for f in changed:
        print("  " + f + " gated " + ("%.2f" % gated[f]["settled_hz"]) + "/" + str(gated[f]["voiced_blocks"]) + " v2 " + ("%.2f" % v2[f]["settled_hz"]) + "/" + str(v2[f]["voiced_blocks"]))
    print("REPORT base, gated, v2 (settled Hz / voiced blocks)")
    for f in names:
        print("  %s base %.2f/%d gated %.2f/%d v2 %.2f/%d tau01 %.2f" % (f, base[f]["settled_hz"], base[f]["voiced_blocks"], gated[f]["settled_hz"], gated[f]["voiced_blocks"], v2[f]["settled_hz"], v2[f]["voiced_blocks"], t["v2-tau01"][f]["settled_hz"]))
    if fails:
        print("RESULT: REJECTED " + ",".join(fails))
        sys.exit(1)
    print("RESULT: ADMIT")
    sys.exit(0)


if __name__ == "__main__":
    main()
