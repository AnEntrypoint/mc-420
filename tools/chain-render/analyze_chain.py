#!/usr/bin/env python3
import argparse
import json
import math
import struct
import sys

import numpy as np


def read_wav(path):
    with open(path, "rb") as f:
        raw = f.read()
    if raw[0:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file: %s" % path)
    pos = 12
    fmt = None
    data = None
    while pos + 8 <= len(raw):
        cid = raw[pos:pos + 4]
        (sz,) = struct.unpack("<I", raw[pos + 4:pos + 8])
        body = raw[pos + 8:pos + 8 + sz]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            data = body
        pos += 8 + sz + (sz & 1)
    if fmt is None or data is None:
        raise ValueError("missing fmt or data chunk: %s" % path)
    wformat, channels, sr, _, _, bits = fmt
    if channels < 1:
        channels = 1
    bps = bits // 8
    if wformat == 3 and bits == 32:
        a = np.frombuffer(data, dtype="<f4").astype(np.float64)
    elif wformat == 3 and bits == 64:
        a = np.frombuffer(data, dtype="<f8").astype(np.float64)
    elif wformat == 1 and bits == 16:
        a = np.frombuffer(data, dtype="<i2").astype(np.float64) / 32768.0
    elif wformat == 1 and bits == 32:
        a = np.frombuffer(data, dtype="<i4").astype(np.float64) / 2147483648.0
    elif wformat == 1 and bits == 8:
        a = (np.frombuffer(data, dtype="<u1").astype(np.float64) - 128.0) / 128.0
    else:
        raise ValueError("unsupported wav format=%d bits=%d" % (wformat, bits))
    frames = len(a) // channels
    a = a[:frames * channels].reshape(frames, channels)
    return sr, a.mean(axis=1)


def db(v):
    if v <= 0.0:
        return -999.0
    return 20.0 * math.log10(v)


def rms(x):
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


def best_lag(x, y, maxd):
    n = len(x) + len(y)
    m = 1
    while m < n:
        m *= 2
    X = np.fft.rfft(x, m)
    Y = np.fft.rfft(y, m)
    c = np.fft.irfft(Y * np.conj(X), m)
    idx = np.concatenate([np.arange(0, maxd + 1), np.arange(m - maxd, m)])
    lags = np.concatenate([np.arange(0, maxd + 1), np.arange(-maxd, 0)])
    k = int(np.argmax(np.abs(c[idx])))
    return int(lags[k]), float(c[idx][k])


def welch(x, sr, nperseg=16384):
    if len(x) < nperseg:
        nperseg = 1 << int(math.floor(math.log2(len(x))))
    w = np.hanning(nperseg + 1)[:nperseg]
    step = nperseg // 2
    starts = range(0, max(1, len(x) - nperseg + 1), step)
    acc = None
    count = 0
    for s in starts:
        seg = x[s:s + nperseg]
        if len(seg) < nperseg:
            break
        S = np.fft.rfft(seg * w)
        P = (np.abs(S) ** 2)
        acc = P if acc is None else acc + P
        count += 1
    if acc is None or count == 0:
        return None, None
    acc /= float(count)
    acc /= (float(np.sum(w * w)) * float(nperseg))
    freqs = np.fft.rfftfreq(nperseg, 1.0 / sr)
    return freqs, acc


def band_edge_db(freqs, pxx, drop_db=60.0):
    if pxx is None:
        return 0.0
    peak = float(np.max(pxx))
    if peak <= 0:
        return 0.0
    thr = peak * (10.0 ** (-drop_db / 10.0))
    above = np.nonzero(pxx >= thr)[0]
    if len(above) == 0:
        return 0.0
    return float(freqs[int(above[-1])])


def band_energy(freqs, pxx, lo, hi):
    sel = (freqs >= lo) & (freqs < hi)
    if not np.any(sel):
        return 0.0
    return float(np.sum(pxx[sel]))


def flatness(freqs, pxx, lo, hi):
    sel = (freqs >= lo) & (freqs < hi) & (pxx > 0)
    if np.count_nonzero(sel) < 4:
        return None
    p = pxx[sel]
    return float(math.exp(np.mean(np.log(p))) / np.mean(p))


def estimate_f0(freqs, pxx, lo=50.0, hi=2000.0):
    sel = (freqs >= lo) & (freqs < hi)
    if not np.any(sel):
        return None
    sub = pxx[sel]
    k = int(np.argmax(sub))
    fs = freqs[sel]
    if 0 < k < len(sub) - 1:
        a, b, c = sub[k - 1], sub[k], sub[k + 1]
        denom = (a - 2.0 * b + c)
        d = 0.5 * (a - c) / denom if denom != 0 else 0.0
        d = float(np.clip(d, -1.0, 1.0))
        step = fs[1] - fs[0]
        return float(fs[k] + d * step)
    return float(fs[k])


def cents_from_harmonic(f, f0):
    if f0 is None or f0 <= 0 or f <= 0:
        return None
    n = max(1, int(round(f / f0)))
    return 1200.0 * math.log2(f / (n * f0))


def analyze(in_path, out_path, label, skip_s=0.25, maxd=4096, nperseg=16384):
    sr_x, x = read_wav(in_path)
    sr_y, y = read_wav(out_path)
    if sr_x != sr_y:
        raise ValueError("sample rate mismatch %d vs %d" % (sr_x, sr_y))

    sk = int(skip_s * sr_x)
    x = x[sk:]
    y = y[sk:]
    n = min(len(x), len(y))
    x = x[:n]
    y = y[:n]
    if n < 8192:
        raise ValueError("too few samples after trim: %d" % n)

    lag, corr = best_lag(x, y, maxd)
    L = abs(lag)
    m = n - L
    if lag >= 0:
        xs = x[0:m]
        ys = y[lag:lag + m]
    else:
        xs = x[-lag:-lag + m]
        ys = y[0:m]

    denom = float(np.dot(xs, xs))
    g = float(np.dot(xs, ys) / denom) if denom > 0 else 0.0
    r = ys - g * xs

    res = {}
    res["label"] = label
    res["sr"] = sr_x
    res["samples"] = int(m)
    res["delay_samples"] = int(lag)
    res["delay_ms"] = float(lag) / float(sr_x) * 1000.0
    res["corr"] = corr
    res["gain"] = g
    res["gain_db"] = db(abs(g))
    res["in_rms_dbfs"] = db(rms(xs))
    res["out_rms_dbfs"] = db(rms(ys))
    res["res_rms_dbfs"] = db(rms(r))
    res["res_rel_db"] = db(rms(r) / rms(xs)) if rms(xs) > 0 else -999.0
    res["res_peak_dbfs"] = db(float(np.max(np.abs(r))))
    res["out_peak_dbfs"] = db(float(np.max(np.abs(ys))))
    res["null_depth_db"] = -res["res_rel_db"] if res["res_rel_db"] > -900 else 999.0
    res["nonfinite"] = int(np.count_nonzero(~np.isfinite(ys)))

    fx, px = welch(xs, sr_x, nperseg)
    fy, py = welch(ys, sr_x, nperseg)
    fr, pr = welch(r, sr_x, nperseg)

    fmax = 0.45 * sr_x
    edge = band_edge_db(fx, px, 60.0)
    res["in_band_edge_hz"] = edge

    if edge > 0 and edge < fmax:
        ex = band_energy(fx, px, edge, fmax)
        ey = band_energy(fy, py, edge, fmax)
        res["above_edge_in_db"] = db(ex)
        res["above_edge_out_db"] = db(ey)
        res["above_edge_delta_db"] = db(ey) - db(ex) if ex > 0 and ey > 0 else None
        res["above_edge_out_rel_db"] = db(ey / float(np.sum(px))) if ey > 0 else -999.0
        res["above_edge_in_rel_db"] = db(ex / float(np.sum(px))) if ex > 0 else -999.0
    else:
        res["above_edge_in_db"] = None
        res["above_edge_out_db"] = None
        res["above_edge_delta_db"] = None

    res["res_flatness_full"] = flatness(fr, pr, 20.0, fmax)
    res["res_flatness_hf"] = flatness(fr, pr, max(edge, 1000.0), fmax) if edge > 0 else None
    res["res_centroid_hz"] = float(np.sum(fr * pr) / np.sum(pr)) if pr is not None and np.sum(pr) > 0 else None

    f0 = estimate_f0(fx, px)
    res["f0_hz"] = f0

    if f0 and pr is not None:
        sel = (fr > 20.0) & (fr < fmax)
        tot = float(np.sum(pr[sel]))
        harm = 0.0
        for f, p in zip(fr[sel], pr[sel]):
            c = cents_from_harmonic(float(f), f0)
            if c is not None and abs(c) <= 50.0:
                harm += float(p)
        res["res_harmonic_fraction"] = harm / tot if tot > 0 else None
        res["res_inharmonic_fraction"] = 1.0 - (harm / tot) if tot > 0 else None
        top = np.argsort(pr[sel])[::-1][:8]
        fs_sel = fr[sel]
        ps_sel = pr[sel]
        peak_ref = float(ps_sel[top[0]])
        peaks = []
        for i in top:
            p = float(ps_sel[i])
            c = cents_from_harmonic(float(fs_sel[i]), f0)
            peaks.append({
                "hz": round(float(fs_sel[i]), 1),
                "db_rel_res_peak": -999.0 if peak_ref <= 0 else round(db(p / peak_ref), 1),
                "cents_from_harmonic": None if c is None else round(c, 1),
            })
        res["res_top_peaks"] = peaks

    return res


def fmt(v, nd=2, suffix=""):
    if v is None:
        return "n/a"
    if isinstance(v, float) and v <= -900.0:
        return "0 (exact)"
    return ("%." + str(nd) + "f%s") % (v, suffix)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="outp", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--skip", type=float, default=0.25)
    ap.add_argument("--maxd", type=int, default=4096)
    ap.add_argument("--nperseg", type=int, default=16384)
    ap.add_argument("--json", dest="jsonl", default="")
    a = ap.parse_args()

    r = analyze(a.inp, a.outp, a.label, a.skip, a.maxd, a.nperseg)

    print("=== %s ===" % r["label"])
    print("  sr=%d samples=%d delay=%+d smp (%+.3f ms) gain=%.6f (%+.4f dB)" % (
        r["sr"], r["samples"], r["delay_samples"], r["delay_ms"], r["gain"], r["gain_db"]))
    print("  in_rms=%s dBFS   out_rms=%s dBFS   out_peak=%s dBFS" % (
        fmt(r["in_rms_dbfs"]), fmt(r["out_rms_dbfs"]), fmt(r["out_peak_dbfs"])))
    print("  RESIDUAL rms=%s dBFS   rel_to_signal=%s dB   null_depth=%s dB   peak=%s dBFS   nonfinite=%d" % (
        fmt(r["res_rms_dbfs"]), fmt(r["res_rel_db"]), fmt(r["null_depth_db"]), fmt(r["res_peak_dbfs"]), r["nonfinite"]))
    print("  input -60dB band edge = %s Hz" % fmt(r["in_band_edge_hz"], 1, " Hz"))
    if r["above_edge_delta_db"] is not None:
        print("  energy above that edge: in %s dB -> out %s dB  (delta %+.2f dB)" % (
            fmt(r["above_edge_in_db"]), fmt(r["above_edge_out_db"]), r["above_edge_delta_db"]))
        print("  above-edge share of total: in %s dB -> out %s dB" % (
            fmt(r["above_edge_in_rel_db"]), fmt(r["above_edge_out_rel_db"])))
    else:
        print("  energy above that edge: n/a")
    print("  residual spectral flatness: full-band %s   hf-band %s" % (
        fmt(r["res_flatness_full"], 4), fmt(r["res_flatness_hf"], 4)))
    print("  residual centroid = %s Hz   f0 = %s Hz" % (
        fmt(r["res_centroid_hz"], 1), fmt(r["f0_hz"], 2)))
    if r.get("res_harmonic_fraction") is not None:
        print("  residual energy at f0 harmonics (+-50 cents): %.1f%%   elsewhere: %.1f%%" % (
            100.0 * r["res_harmonic_fraction"], 100.0 * r["res_inharmonic_fraction"]))
        print("  residual top peaks (Hz / dB rel res peak / cents from nearest harmonic):")
        for p in r["res_top_peaks"]:
            print("     %10.1f Hz  %8.1f dB  %s" % (
                p["hz"], p["db_rel_res_peak"], "n/a" if p["cents_from_harmonic"] is None else "%+.1f c" % p["cents_from_harmonic"]))
    sys.stdout.flush()

    if a.jsonl:
        with open(a.jsonl, "a") as f:
            f.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    main()
