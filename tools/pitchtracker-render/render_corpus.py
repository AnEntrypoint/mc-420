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
PINNED_HZ = (60.0, 192.0)
PIN_TOL_HZ = 0.001


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


def median_and_count(values):
    if values.size == 0:
        return 0.0, 0
    return float(np.median(values)), int(values.size)


def settle(y):
    ends = y[BLOCK - 1::BLOCK]
    times = (np.arange(ends.size) * BLOCK + BLOCK) / SR
    live = (times >= SETTLE_S) & (ends > 0.0)
    pinned = np.isclose(ends[:, None], np.array(PINNED_HZ)[None, :], rtol=0.0, atol=PIN_TOL_HZ).any(axis=1)
    settled, n = median_and_count(ends[live & ~pinned])
    raw_settled, raw_n = median_and_count(ends[live])
    blocks = y[: (y.size // BLOCK) * BLOCK].reshape(-1, BLOCK)
    sample_live = ((np.arange(blocks.size) + 1) / SR >= SETTLE_S).reshape(blocks.shape)
    sample_positive = blocks > 0.0
    sample_pinned = np.isclose(blocks[:, :, None], np.array(PINNED_HZ)[None, None, :], rtol=0.0, atol=PIN_TOL_HZ).any(axis=2)
    sub_raw = (sample_live & sample_positive).any(axis=1)
    sub_pin = (sample_live & sample_positive & ~sample_pinned).any(axis=1)
    stats = {
        "settled": settled,
        "voiced": n,
        "pinned": int(np.count_nonzero(live & pinned)),
        "raw_settled": raw_settled,
        "raw_voiced": raw_n,
        "subblock_raw_voiced": int(np.count_nonzero(sub_raw)),
        "subblock_voiced": int(np.count_nonzero(sub_pin)),
    }
    return stats, ends


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
            stats, ends = settle(render(args.render, read_wav(f), work))
            settled = stats["settled"]
            peak = peaks.get(f.stem)
            cents = 1200.0 * math.log2(settled / peak) if peak and settled > 0.0 else None
            rows.append({
                "file": f.stem,
                "peak_hz": peak,
                "settled_hz": round(settled, 3),
                "voiced_blocks": stats["voiced"],
                "pinned_blocks": stats["pinned"],
                "settled_raw_hz": round(stats["raw_settled"], 3),
                "voiced_raw_blocks": stats["raw_voiced"],
                "voiced_subblock_raw_blocks": stats["subblock_raw_voiced"],
                "voiced_subblock_blocks": stats["subblock_voiced"],
                "cents": None if cents is None else round(cents, 2),
            })
            traces[f.stem] = ends.astype(np.float32)
    np.savez_compressed(out_dir / f"traces-{args.variant}.npz", **traces)
    (out_dir / f"settled-{args.variant}.json").write_text(json.dumps({"variant": args.variant, "rows": rows}, indent=2) + "\n")
    for r in rows:
        print(f"{args.variant} {r['file']} peak={r['peak_hz']} settled={r['settled_hz']} voiced={r['voiced_blocks']} cents={r['cents']}")


if __name__ == "__main__":
    main()
