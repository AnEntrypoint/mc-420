import re
import sys

NAMES = ["Glass", "Cloud", "Chop", "Shatter"]
FIELDS = ["grainMs", "grainRateHz", "pitchSprayCents", "posJitterMs", "scanRate",
          "reverseProb", "envShape", "liveMix", "toneNorm"]
COLS = ["name"] + FIELDS + ["transposeCents", "quantize", "freeze"]


def fail(why):
    print(f"generate_patches: FAIL: {why}", file=sys.stderr)
    sys.exit(1)


def main(src, dst):
    text = open(src).read()
    m = re.search(r"static const GranPatch kGranPatches\[kGranPatchCount\] = \{(.*?)\n\};", text, re.S)
    if not m:
        fail("kGranPatches table not found in " + src)
    rows = re.findall(r"\{([^{}]*)\}", m.group(1))
    if len(rows) != len(NAMES):
        fail(f"expected {len(NAMES)} patch rows in kGranPatches, found {len(rows)}")

    table = []
    for name, row in zip(NAMES, rows):
        vals = [float(v.strip().rstrip("f")) for v in row.split(",") if v.strip()]
        if len(vals) != len(FIELDS):
            fail(f"patch {name} has {len(vals)} fields, expected {len(FIELDS)}")
        table.append({"name": name, "freeze": 0, "transposeCents": 0.0, "quantize": 0,
                      **dict(zip(FIELDS, vals))})

    cloud = table[NAMES.index("Cloud")]
    table.append({**cloud, "name": "Freeze", "scanRate": 0.0, "freeze": 1})
    table.append({**cloud, "name": "Tape", "transposeCents": -1200.0})

    with open(dst, "w") as f:
        f.write("\t".join(COLS) + "\n")
        for r in table:
            f.write("\t".join(str(r[c]) if c == "name" else f"{float(r[c]):g}" for c in COLS) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        fail("usage: generate_patches.py <apc_grid.cpp> <out.tsv>")
    main(sys.argv[1], sys.argv[2])
