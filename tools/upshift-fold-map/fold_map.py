#!/usr/bin/env python3
import argparse
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

FFT_SIZE = 4096
HOP = FFT_SIZE // 2


def read_wav_mono(path):
    with open(path, "rb") as f:
        raw = f.read()
    if raw[0:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file: %s" % path)
    pos = 12
    fmt = None
    data = None
    while pos + 8 <= len(raw):
        cid = raw[pos:pos + 4]
        csz = struct.unpack_from("<I", raw, pos + 4)[0]
        body = pos + 8
        if cid == b"fmt ":
            fmt = raw[body:body + csz]
        elif cid == b"data":
            data = raw[body:body + csz]
        pos = body + csz + (csz & 1)
    if fmt is None or data is None:
        raise ValueError("missing fmt or data chunk: %s" % path)
    audio_format, channels, sample_rate = struct.unpack_from("<HHI", fmt, 0)
    bits = struct.unpack_from("<H", fmt, 14)[0]
    if channels < 1:
        raise ValueError("no channels: %s" % path)
    frame_bytes = (bits // 8) * channels
    nframes = len(data) // frame_bytes
    out = [0.0] * nframes
    if audio_format == 3 and bits == 32:
        for i in range(nframes):
            acc = 0.0
            base = i * frame_bytes
            for c in range(channels):
                acc += struct.unpack_from("<f", data, base + 4 * c)[0]
            out[i] = acc / channels
    elif audio_format == 3 and bits == 64:
        for i in range(nframes):
            acc = 0.0
            base = i * frame_bytes
            for c in range(channels):
                acc += struct.unpack_from("<d", data, base + 8 * c)[0]
            out[i] = acc / channels
    elif audio_format == 1 and bits == 16:
        unpack = struct.Struct("<%dh" % (nframes * channels)).unpack_from
        ints = unpack(data, 0)
        for i in range(nframes):
            acc = 0
            for c in range(channels):
                acc += ints[i * channels + c]
            out[i] = (acc / channels) / 32768.0
    elif audio_format == 1 and bits == 32:
        unpack = struct.Struct("<%di" % (nframes * channels)).unpack_from
        ints = unpack(data, 0)
        for i in range(nframes):
            acc = 0
            for c in range(channels):
                acc += ints[i * channels + c]
            out[i] = (acc / channels) / 2147483648.0
    elif audio_format == 1 and bits == 24:
        for i in range(nframes):
            acc = 0
            base = i * frame_bytes
            for c in range(channels):
                b0, b1, b2 = data[base + 3 * c], data[base + 3 * c + 1], data[base + 3 * c + 2]
                v = b0 | (b1 << 8) | (b2 << 16)
                if v & 0x800000:
                    v -= 1 << 24
                acc += v
            out[i] = (acc / channels) / 8388608.0
    else:
        raise ValueError("unsupported wav format %d/%d bit: %s" % (audio_format, bits, path))
    return out, sample_rate


def fft_inplace(re, im):
    n = len(re)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
    size = 2
    while size <= n:
        half = size >> 1
        step = -2.0 * math.pi / size
        for i in range(0, n, size):
            for k in range(half):
                ang = step * k
                wr = math.cos(ang)
                wi = math.sin(ang)
                a = i + k
                b = a + half
                tr = re[b] * wr - im[b] * wi
                ti = re[b] * wi + im[b] * wr
                re[b] = re[a] - tr
                im[b] = im[a] - ti
                re[a] = re[a] + tr
                im[a] = im[a] + ti
        size <<= 1


def out_of_band_fraction(samples, sample_rate, cutoffs):
    n = FFT_SIZE
    window = [0.5 - 0.5 * math.cos(2.0 * math.pi * i / n) for i in range(n)]
    spec = [0.0] * (n // 2 + 1)
    frames = 0
    for start in range(0, len(samples) - n + 1, HOP):
        re = [samples[start + i] * window[i] for i in range(n)]
        im = [0.0] * n
        fft_inplace(re, im)
        for k in range(n // 2 + 1):
            spec[k] += re[k] * re[k] + im[k] * im[k]
        frames += 1
    if frames == 0:
        raise ValueError("file shorter than one fft frame")
    total = sum(spec)
    if total <= 0.0:
        return [0.0] * len(cutoffs), frames
    bin_hz = sample_rate / float(n)
    prefix = [0.0] * (len(spec) + 1)
    for k, v in enumerate(spec):
        prefix[k + 1] = prefix[k] + v
    fracs = []
    for fc in cutoffs:
        exact = fc / bin_hz
        lo = int(math.floor(exact))
        lo = max(0, min(lo, len(spec) - 1))
        below = prefix[lo] + (exact - lo) * spec[lo + 1] if lo + 1 < len(spec) else prefix[len(spec)]
        fracs.append(max(0.0, min(1.0, (total - below) / total)))
    return fracs, frames


def parse_kv_row(row):
    out = {}
    for field in row.strip().split(","):
        if "=" in field:
            k, v = field.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return float("nan")
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0.0 or syy <= 0.0:
        return float("nan")
    return sxy / math.sqrt(sxx * syy)


def main():
    ap = argparse.ArgumentParser(description="map upward-transpose fold-back aliasing against source out-of-band energy")
    ap.add_argument("--dsp-cli", default="/tmp/dsp_cli")
    ap.add_argument("--corpus", default="test-audio-corpus/instruments")
    ap.add_argument("--semis", default="0,12,19,24,36")
    ap.add_argument("--out", default=None)
    ap.add_argument("--threshold", default="0.25")
    ap.add_argument("--min-gap-ms", default="5")
    ap.add_argument("--normrms", default="0.21")
    ap.add_argument("--json", default=None)
    ap.add_argument("--skip-render", action="store_true",
                    help="reuse the wav files already in --out instead of rendering again")
    args = ap.parse_args()

    semis = [int(s) for s in args.semis.split(",") if s.strip()]
    corpus = args.corpus
    names = sorted(p for p in os.listdir(corpus) if p.lower().endswith(".wav"))
    if not names:
        print("no wav files under %s" % corpus, file=sys.stderr)
        return 2

    keep = args.out is not None
    workdir = args.out
    if workdir is None:
        tmp = tempfile.mkdtemp(prefix="upshift-fold-map-")
        workdir = tmp
    os.makedirs(workdir, exist_ok=True)

    cutoffs = [48000.0 / (2.0 * (2.0 ** (s / 12.0))) for s in semis]
    results = []
    for name in names:
        src = os.path.join(corpus, name)
        samples, sr = read_wav_mono(src)
        fracs, frames = out_of_band_fraction(samples, sr, cutoffs)
        row = {"file": name, "sr": sr, "frames": frames, "oob": {}, "cells": {}}
        for s, fc, frac in zip(semis, cutoffs, fracs):
            row["oob"][s] = {"cutoff_hz": fc, "fraction": frac}
        for s in semis:
            dst = os.path.join(workdir, "%s_s%+d.wav" % (name[:-4], s))
            if not (args.skip_render and os.path.exists(dst)):
                rc, out, err = run([args.dsp_cli, "--solad",
                                    "in=" + src, "out=" + dst,
                                    "semis=%d" % s, "normrms=" + args.normrms])
                if rc != 0:
                    print("solad failed %s semis=%d: %s" % (name, s, err.strip()), file=sys.stderr)
                    continue
            else:
                out = ""
            kv = parse_kv_row(out.strip().splitlines()[-1]) if out.strip() else {}
            rc2, out2, err2 = run([args.dsp_cli, "--glitch-check", dst,
                                   "threshold=" + args.threshold, "minGapMs=" + args.min_gap_ms])
            glitches = None
            for line in out2.splitlines():
                if line.strip().startswith("glitches="):
                    glitches = int(line.strip().split("=", 1)[1])
            if glitches is None:
                print("glitch-check gave no count %s semis=%d rc=%d: %s" % (
                    name, s, rc2, err2.strip()), file=sys.stderr)
            row["cells"][s] = {
                "glitches": glitches,
                "peakStep": float(kv.get("peakStep", "nan")),
                "gapMax": float(kv.get("gapMax", "nan")),
                "rms": float(kv.get("rms", "nan")),
                "achievedSemis": float(kv.get("achievedSemis", "nan")),
                "splices": int(kv.get("splices", "-1")),
            }
            if not keep:
                os.unlink(dst)
        results.append(row)
        print("measured %s" % name, file=sys.stderr)

    hdr_semis = "".join("%12s" % ("+%d" % s) for s in semis)
    print("")
    print("GLITCH COUNT  (rows = source, cols = requested semitones)")
    print("%-32s%s" % ("source", hdr_semis))
    for r in results:
        print("%-32s%s" % (r["file"], "".join("%12s" % r["cells"][s]["glitches"] for s in semis)))
    print("")
    print("OUT-OF-BAND ENERGY FRACTION above fs/(2s)")
    print("%-32s%s" % ("source", "".join("%12s" % (">%.1fk" % (r["oob"][s]["cutoff_hz"] / 1000.0)) for s in semis)))
    for r in results:
        print("%-32s%s" % (r["file"], "".join("%12.4f" % r["oob"][s]["fraction"] for s in semis)))
    print("")
    print("PEAKSTEP")
    print("%-32s%s" % ("source", hdr_semis))
    for r in results:
        print("%-32s%s" % (r["file"], "".join("%12.4f" % r["cells"][s]["peakStep"] for s in semis)))
    print("")
    print("GAPMAX (samples)")
    print("%-32s%s" % ("source", hdr_semis))
    for r in results:
        print("%-32s%s" % (r["file"], "".join("%12.0f" % r["cells"][s]["gapMax"] for s in semis)))
    print("")
    print("ACHIEVED SEMIS (tracker lock, not requested)")
    print("%-32s%s" % ("source", hdr_semis))
    for r in results:
        print("%-32s%s" % (r["file"], "".join("%12.2f" % r["cells"][s]["achievedSemis"] for s in semis)))
    print("")
    print("CORRELATION glitches vs out-of-band fraction")
    for s in semis:
        pairs = [(r["oob"][s]["fraction"], float(r["cells"][s]["glitches"]))
                 for r in results if r["cells"][s]["glitches"] is not None]
        if len(pairs) < 2:
            continue
        print("  +%-3d cutoff %6.0f Hz  n=%d  pearson r = %+.4f" % (
            s, cutoffs[semis.index(s)], len(pairs),
            pearson([p[0] for p in pairs], [p[1] for p in pairs])))
    pairs = [(r["oob"][s]["fraction"], float(r["cells"][s]["glitches"]))
             for r in results for s in semis if r["cells"][s]["glitches"] is not None]
    print("  pooled over all cells            n=%d  pearson r = %+.4f" % (
        len(pairs), pearson([p[0] for p in pairs], [p[1] for p in pairs])))

    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
