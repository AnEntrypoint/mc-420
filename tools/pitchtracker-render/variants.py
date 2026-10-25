import pathlib
import sys

PATCHES = {
    "base": [],
    "coarse-gate": [
        ("octaveSemitone = 0.06;", "octaveSemitone = 0.03;", 1),
    ],
    "energy-norm": [
        ("den = max(1e-9, smoo(x*x));", "den = max(1e-9, sqrt(smoo(x*x) * smoo(d*d)));", 2),
    ],
    "corr-tau-0.02": [
        ("    energyTau = 0.01;", "    energyTau = 0.02;", 1),
    ],
}


def apply(name, src, dst):
    text = pathlib.Path(src).read_text()
    for old, new, count in PATCHES[name]:
        found = text.count(old)
        if found != count:
            sys.exit(f"variants: {old!r} occurs {found} times, expected {count}")
        text = text.replace(old, new)
    out = pathlib.Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in PATCHES:
        sys.exit("usage: variants.py {" + "|".join(PATCHES) + "} <src.dsp> <dst.dsp>")
    apply(sys.argv[1], sys.argv[2], sys.argv[3])
