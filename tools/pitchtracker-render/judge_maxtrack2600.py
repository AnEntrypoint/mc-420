import hashlib
import json
import math
import pathlib
import sys

VARIANTS = ("base1500", "ceil2600", "ceil2600-tau01")
CORPUS = ["piano_low_A1", "piano_mid_C4", "piano_high_C7", "violin_low_sulG_G3B3", "violin_high_sulE_C7E7", "cello_low_sulC_A2", "marimba_low_C2B2", "marimba_mid_C5B5", "vibraphone_mid_C5B5", "trumpet_low_A3", "trumpet_high_C6", "oboe_mid_C5B5", "bassoon_low_C2B2", "clarinet_high_C6B6", "vocal_female_vibrato", "vocal_male_baritone_scale", "flute_trill_high_C7", "flute_high_C7", "soprano_sax_high_C6", "xylophone_roll_AM_C6B6", "marimba_roll_AM_C5B5", "bells_glock_run_C6B6", "xylophone_run_C7B7", "glockenspiel_high_C7", "crotale_high_C7", "cymbal_inharmonic", "tamtam_inharmonic", "balloon_pop_transient", "guitar_pluck_C4B4", "tuba_run_C2B2", "vocal_soprano_range_PD", "vocal_tenor_range_PD", "vocal_tenor_operatic_PD", "vocal_melody_twinkle_CC0"]
SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440", "sine_1000", "sine_2093"]
NAMED = ["vibraphone_mid_C5B5", "piano_low_A1", "marimba_mid_C5B5", "oboe_mid_C5B5", "cymbal_inharmonic", "flute_trill_high_C7"]
R4_FILES = ["cello_low_sulC_A2", "vocal_male_baritone_scale"]
R5_SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440", "sine_1000"]
CRANGE_SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440"]
TARGET_HZ = 2093.005
FAMILY_CENTS = 1200.0 * math.log2(3.0)
UNVOICED = "unvoiced"


def voiced(x):
    return x is not None and x > 0.0


def cents(a, b):
    if not voiced(a) and not voiced(b):
        return UNVOICED
    if not voiced(a) or not voiced(b):
        return math.inf
    return 1200.0 * math.log2(a / b)


def magnitude(d):
    return 0.0 if d == UNVOICED else abs(d)


def absolute(d):
    return d if d == UNVOICED else abs(d)


def unit(d):
    return "" if d == UNVOICED else " c"


def load(root):
    tables = {}
    for v in VARIANTS:
        p = pathlib.Path(root) / ("settled-" + v + ".json")
        if not p.is_file():
            print("RESULT: REFUSED missing " + str(p))
            sys.exit(2)
        print("input " + p.name + " sha256 " + hashlib.sha256(p.read_bytes()).hexdigest())
        rows = {r["file"]: r for r in json.loads(p.read_text())["rows"]}
        absent = [n for n in CORPUS + SINES if n not in rows]
        if absent:
            print("RESULT: REFUSED " + v + " lacks " + ",".join(absent))
            sys.exit(2)
        tables[v] = rows
    return tables


def fmt(x):
    if x == UNVOICED:
        return "unvoiced"
    return "inf" if math.isinf(x) else "%.2f" % x


def main():
    if len(sys.argv) != 2:
        print("RESULT: REFUSED usage: judge_maxtrack2600.py <render-out dir>")
        sys.exit(2)
    t = load(sys.argv[1])
    base, cand, tau = t["base1500"], t["ceil2600"], t["ceil2600-tau01"]
    fails = []

    def check(name, ok, detail):
        print(name + " " + ("PASS" if ok else "FAIL") + " " + detail)
        if not ok:
            fails.append(name)

    s1_ok = True
    s1_detail = []
    for label, table in (("ceil2600", cand), ("ceil2600-tau01", tau)):
        row = table["sine_2093"]
        d = cents(row["settled_hz"], TARGET_HZ)
        good = magnitude(d) <= 50.0 and row["voiced_blocks"] > 0
        s1_ok = s1_ok and good
        s1_detail.append(label + " " + str(row["settled_hz"]) + " Hz " + fmt(d) + unit(d))
    check("S1", s1_ok, "; ".join(s1_detail))

    worst_peak = []
    r1_peak_ok = True
    for f in CORPUS:
        peak = base[f]["peak_hz"]
        if peak is None:
            continue
        dc = cents(cand[f]["settled_hz"], peak)
        db = cents(base[f]["settled_hz"], peak)
        ok = magnitude(dc) <= magnitude(db) + 5.0
        r1_peak_ok = r1_peak_ok and ok
        worst_peak.append(f + " base " + fmt(absolute(db)) + " cand " + fmt(absolute(dc)) + (" ok" if ok else " FAIL"))
    check("R1-reliable-peak", r1_peak_ok, "; ".join(worst_peak))

    r1_nopeak_ok = True
    nopeak_detail = []
    for f in CORPUS:
        if base[f]["peak_hz"] is not None:
            continue
        d = cents(cand[f]["settled_hz"], base[f]["settled_hz"])
        within = magnitude(d) <= 5.0
        family = (base[f]["voiced_blocks"] > 0 and cand[f]["voiced_blocks"] > 0
                  and d != UNVOICED
                  and abs(d - FAMILY_CENTS) <= 50.0
                  and magnitude(cents(cand[f]["settled_hz"], TARGET_HZ)) <= 50.0)
        ok = within or family
        r1_nopeak_ok = r1_nopeak_ok and ok
        if not ok or family:
            nopeak_detail.append(f + " " + fmt(d) + unit(d) + (" family" if family and not within else "") + ("" if ok else " FAIL"))
    check("R1-no-peak", r1_nopeak_ok, "; ".join(nopeak_detail) if nopeak_detail else "all within 5 c")

    r2_bad = [f for f in CORPUS if cand[f]["voiced_blocks"] < base[f]["voiced_blocks"]]
    check("R2", not r2_bad, "voiced cand<base: " + (",".join(r2_bad) if r2_bad else "none"))

    r4_bad = [f for f in R4_FILES if not (0.0 < cand[f]["settled_hz"] < 1000.0)]
    check("R4", not r4_bad, "cello and baritone below 1000 Hz: " + (",".join(r4_bad) if r4_bad else "yes"))

    r5_detail = []
    r5_ok = True
    for s in R5_SINES:
        d = cents(cand[s]["settled_hz"], base[s]["settled_hz"])
        ok = magnitude(d) <= 1.0
        r5_ok = r5_ok and ok
        r5_detail.append(s + " " + fmt(d) + unit(d))
    check("R5", r5_ok, "; ".join(r5_detail))

    crange_bad = [s for s in CRANGE_SINES
                  if cand[s]["settled_hz"] != base[s]["settled_hz"] or cand[s]["voiced_blocks"] != base[s]["voiced_blocks"]]
    check("C-RANGE", not crange_bad, "identical settled and voiced: " + ("yes" if not crange_bad else "differs " + ",".join(crange_bad)))

    nr_detail = []
    nr_ok = True
    for f in NAMED:
        d = cents(cand[f]["settled_hz"], base[f]["settled_hz"])
        ok = magnitude(d) <= 5.0 and cand[f]["voiced_blocks"] >= base[f]["voiced_blocks"]
        nr_ok = nr_ok and ok
        nr_detail.append(f + " " + fmt(d) + unit(d) + ("" if ok else " FAIL"))
    check("NR", nr_ok, "; ".join(nr_detail))

    print("PER-FILE base1500 settled/voiced vs ceil2600 settled/voiced")
    for f in CORPUS + SINES:
        d = cents(cand[f]["settled_hz"], base[f]["settled_hz"])
        print("  " + f + " " + str(base[f]["settled_hz"]) + "/" + str(base[f]["voiced_blocks"]) + " -> " + str(cand[f]["settled_hz"]) + "/" + str(cand[f]["voiced_blocks"]) + " " + fmt(d) + unit(d))

    if fails:
        print("RESULT: REJECTED " + ",".join(fails))
    else:
        print("RESULT: ADMIT")


if __name__ == "__main__":
    main()
