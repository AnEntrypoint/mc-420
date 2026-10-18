import glob
import math
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SETTLE_S = 1.0
R1_CENTS = 5.0
HIGH = ["flute_high_C7", "piano_high_C7", "crotale_high_C7", "glockenspiel_high_C7", "xylophone_run_C7B7"]
CLAMP_FILES = ["cello_low_sulC_A2", "vocal_male_baritone_scale"]
CLAMP_HZ = 4199.0
NOTES = ["note_change", "note_change_harm", "note_change_inharm_freeFreeBeam", "note_change_inharm_quoted1x4x10"]
SINES = ["sine_55.69", "sine_110", "sine_220", "sine_440", "sine_1000"]


def fail(why):
    print(f"compare: FAIL: {why}", file=sys.stderr)
    sys.exit(1)


def load(path):
    if not os.path.isfile(path):
        fail(f"missing file {path}")
    rows = []
    with open(path) as f:
        for line in f:
            p = line.split()
            if len(p) != 2:
                continue
            t, hz = float(p[0]), float(p[1])
            if math.isnan(t) or math.isnan(hz):
                fail(f"NaN in {path}")
            rows.append((t, hz))
    if not rows:
        fail(f"empty file {path}")
    return rows


def settled(rows):
    return [hz for t, hz in rows if t >= SETTLE_S - 1e-9]


def stats(values):
    n = len(values)
    if n == 0:
        fail("no settled blocks")
    zero = sum(1 for v in values if v == 0.0)
    nonzero = sorted(v for v in values if v > 0.0)
    med = nonzero[len(nonzero) // 2] if nonzero else None
    return zero / n, len(nonzero) / n, med


def names():
    corpus = sorted(os.path.splitext(os.path.basename(p))[0]
                    for p in glob.glob(os.path.join(REPO, "test-audio-corpus", "instruments", "*.wav")))
    if len(corpus) != 34:
        fail(f"expected 34 corpus files, found {len(corpus)}")
    return corpus + SINES + NOTES


def base_path(name):
    if name in SINES:
        return os.path.join(REPO, "docs", "witness", "hv-corpus", name + ".base.txt")
    if name in NOTES:
        return os.path.join(REPO, "docs", "witness", "pitch-ceiling", "base__" + name + ".txt")
    return os.path.join(REPO, "docs", "witness", "hv-corpus", "base__" + name + ".txt")


def main(outdir, summary):
    rows_out = []
    overall = True
    for name in names():
        cand = settled(load(os.path.join(outdir, "dedup__" + name + ".txt")))
        base = settled(load(base_path(name)))
        cz, cnz, cmed = stats(cand)
        bz, bnz, bmed = stats(base)
        cents = None
        r1 = "NA"
        if cmed is not None and bmed is not None:
            cents = 1200.0 * math.log2(cmed / bmed)
            r1 = "PASS" if abs(cents) <= R1_CENTS else "FAIL"
        r2 = "PASS" if cz <= bz + 1e-12 else "FAIL"
        r3 = "NA"
        if name in HIGH:
            r3 = "PASS" if cnz > bnz else "FAIL"
        r4 = "NA"
        runaway = 0
        if name in CLAMP_FILES:
            runaway = sum(1 for v in cand if v >= CLAMP_HZ)
            r4 = "PASS" if runaway == 0 else "FAIL"
        for r in (r1, r2, r3, r4):
            if r == "FAIL":
                overall = False
        rows_out.append((name, bz, cz, bnz, cnz, bmed, cmed, cents, r1, r2, r3, r4, runaway))

    cols = ["name", "base_zero", "cand_zero", "base_nonzero", "cand_nonzero", "base_median_hz",
            "cand_median_hz", "cents_vs_base", "R1_5cents", "R2_zero_not_up", "R3_high_gain",
            "R4_no_clamp", "clamp_blocks"]
    with open(summary, "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows_out:
            vals = []
            for v in r:
                if v is None:
                    vals.append("-")
                elif isinstance(v, float):
                    vals.append(f"{v:.6g}")
                else:
                    vals.append(str(v))
            f.write("\t".join(vals) + "\n")
        f.write("VERDICT\t" + ("PASS" if overall else "FAIL") + "\n")
    print(f"compare: VERDICT {'PASS' if overall else 'FAIL'}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        fail("usage: compare.py <outdir> <summary.tsv>")
    main(sys.argv[1], sys.argv[2])
