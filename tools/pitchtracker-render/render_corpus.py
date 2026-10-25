import argparse
import json
import math
import pathlib
import subprocess
import tempfile
import wave

import numpy as np

SR = 48000
BLOCK = 64
SETTLE_S = 1.0
PHRASE_FILES = {"vibraphone_mid_C5B5", "marimba_mid_C5B5"}


def read_reference(path):
    peaks = {}
    reliable = False
    for line in pathlib.Path(path).read_text().splitlines():
        if line.startswith("## "):
            reliable = line.startswith("## Reliable")
            continue
        if not reliable or not line.startswith("|") or "PHRASE" in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] in PHRASE_FILES:
            continue
        try:
            peaks[cells[0]] = float(cells[2])
        except ValueError:
            continue
    return peaks


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getframerate() != SR:
            raise SystemExit(f"{path.name}: expected mono {SR} Hz")
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    raise SystemExit(f"{path.name}: unsupported sample width {width}")


def render(binary, x, work):
    src = work / "in.f32"
    dst = work / "out.f32"
    x.astype("<f4").tofile(src)
    subprocess.run([binary, f"in={src}", f"out={dst}", f"sr={SR}", f"block={BLOCK}", "channels=1"], check=True)
    return np.fromfile(dst, dtype="<f4")


def settle(y):
    ends = y[BLOCK - 1::BLOCK]
    times = (np.arange(ends.size) * BLOCK + BLOCK) / SR
    voiced = ends[(times >= SETTLE_S) & (ends > 0.0)]
    if voiced.size == 0:
        return 0.0, 0, ends
    return float(np.median(voiced)), int(voiced.size), ends


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--reference", required=True)
    ap.add_argument("--variant", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    peaks = read_reference(args.reference)
    files = sorted(pathlib.Path(args.corpus).glob("*.wav"))
    if not files:
        raise SystemExit(f"no wav files under {args.corpus}")
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    traces = {}
    with tempfile.TemporaryDirectory() as td:
        work = pathlib.Path(td)
        for f in files:
            settled, n, ends = settle(render(args.render, read_wav(f), work))
            peak = peaks.get(f.stem)
            cents = 1200.0 * math.log2(settled / peak) if peak and settled > 0.0 else None
            rows.append({
                "file": f.stem,
                "peak_hz": peak,
                "settled_hz": round(settled, 3),
                "voiced_blocks": n,
                "cents": None if cents is None else round(cents, 2),
            })
            traces[f.stem] = ends.astype(np.float32)
    np.savez_compressed(out_dir / f"traces-{args.variant}.npz", **traces)
    (out_dir / f"settled-{args.variant}.json").write_text(json.dumps({"variant": args.variant, "rows": rows}, indent=2) + "\n")
    for r in rows:
        print(f"{args.variant} {r['file']} peak={r['peak_hz']} settled={r['settled_hz']} voiced={r['voiced_blocks']} cents={r['cents']}")


if __name__ == "__main__":
    main()
