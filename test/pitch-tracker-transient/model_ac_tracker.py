import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"

SR = 48000
MIN_TRACK_HZ = 60.0
MAX_TRACK_HZ = 1500.0
CORR_THRESH = 0.85
SUBHARM_MARGIN = 0.004
PEAK_SPREAD = 1
PEAK_CEIL = 1.0
DEMOTE_TAU = 0.03
RELEASE_FRAC = 0.35
EXCLUSIVE = False

HOLD_SIGNALS = {}
REFINE_SPREAD = 16

CANDIDATES = (
    1581.12, 1500.0, 1423.02, 1350.0, 1272.79, 1200.0, 1095.45, 1000.0, 938.08, 880.0,
    784.86, 700.0, 641.01, 587.0, 508.21, 440.0, 391.87, 349.0, 320.32, 294.0,
    277.33, 261.6, 239.9, 220.0, 201.74, 185.0, 169.66, 155.6, 142.66, 130.8,
    119.95, 110.0, 100.87, 92.5, 84.83, 77.8, 71.33, 65.4, 62.64, 60.0,
)


def highpass1(x, fc):
    a = np.exp(-2.0 * np.pi * fc / SR)
    y = np.zeros(len(x))
    prev_x = 0.0
    prev_y = 0.0
    for i, v in enumerate(x):
        y[i] = a * (prev_y + v - prev_x)
        prev_x = v
        prev_y = y[i]
    return y


def one_pole(x, pole):
    k = int(np.ceil(np.log(1e-9) / np.log(pole)))
    h = (1.0 - pole) * pole ** np.arange(k + 1)
    nfft = 1 << int(np.ceil(np.log2(len(x) + len(h) - 1)))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[: len(x)]


def corr_at_lag_var(x, lag):
    lag = int(min(3200, max(1, lag)))
    d = np.zeros(len(x))
    if lag < len(x):
        d[lag:] = x[: len(x) - lag]
    pole = np.exp(-1.0 / (0.01 * SR))
    num = one_pole(x * d, pole)
    den = np.maximum(1e-9, one_pole(x * x, pole))
    return num / den


def corr_at_lag_tau(x, lag, tau):
    lag = int(lag)
    d = np.zeros(len(x))
    if lag < len(x):
        d[lag:] = x[: len(x) - lag]
    pole = np.exp(-1.0 / (tau * SR))
    num = one_pole(x * d, pole)
    den = np.maximum(1e-9, one_pole(x * x, pole))
    return num / den


def corr_peak_at(x, freq):
    freq = np.asarray(freq, dtype=float)
    l0 = np.array([int(min(3199 - PEAK_SPREAD, max(2 + PEAK_SPREAD, int(SR / f))))
                   for f in np.atleast_1d(freq).ravel()])
    pool = {}
    for L in np.unique(l0):
        pool[L] = (corr_at_lag_var(x, int(L) - PEAK_SPREAD),
                   corr_at_lag_var(x, int(L)),
                   corr_at_lag_var(x, int(L) + PEAK_SPREAD))
    c_lo = np.array([pool[L][0][i] for i, L in enumerate(l0)])
    c_mid = np.array([pool[L][1][i] for i, L in enumerate(l0)])
    c_hi = np.array([pool[L][2][i] for i, L in enumerate(l0)])
    denom = c_lo - 2.0 * c_mid + c_hi
    safe = np.where(denom > -1e-9, -1e-9, denom)
    vertex = c_mid - (c_lo - c_hi) ** 2 / (8.0 * safe)
    return np.clip(vertex, -1.0, PEAK_CEIL).reshape(np.shape(freq))


def pick_fundamental(x, n):
    cache = {}

    def c(f):
        if f not in cache:
            tau = 0.02 if f >= 700.0 else 0.01
            cache[f] = corr_at_lag_tau(x, int(SR / f), tau)
        return cache[f]

    out = np.full(n, CANDIDATES[-1])
    decided = np.zeros(n, dtype=bool)
    for idx in range(len(CANDIDATES) - 2):
        c_hi = c(CANDIDATES[idx])
        c_mid = c(CANDIDATES[idx + 1])
        c_lo = c(CANDIDATES[idx + 2])
        hit = (
            (c_mid >= CORR_THRESH)
            & (c_mid >= c_hi)
            & (c_mid >= c_lo)
            & (~decided)
        )
        out[hit] = CANDIDATES[idx + 1]
        decided = decided | hit
    return out


def refine_freq(x, coarse):
    l0 = np.array([int(min(3199 - REFINE_SPREAD, max(2 + REFINE_SPREAD, int(SR / f))))
                   for f in coarse])
    got_lo = {}
    got_mid = {}
    got_hi = {}
    out = np.zeros(len(x))
    for L in np.unique(l0):
        got_lo[L] = corr_at_lag_var(x, int(L) - REFINE_SPREAD)
        got_mid[L] = corr_at_lag_var(x, int(L))
        got_hi[L] = corr_at_lag_var(x, int(L) + REFINE_SPREAD)
    c_lo = np.array([got_lo[L][i] for i, L in enumerate(l0)])
    c_mid = np.array([got_mid[L][i] for i, L in enumerate(l0)])
    c_hi = np.array([got_hi[L][i] for i, L in enumerate(l0)])
    denom = c_lo - 2.0 * c_mid + c_hi
    safe = np.where(np.abs(denom) < 1e-6, 1e-6, denom)
    delta = np.clip(0.5 * (c_lo - c_hi) / safe, -1.0, 1.0)
    delta2 = np.where(np.abs(denom) < 1e-6, 0.0, delta)
    refined_lag = l0.astype(float) + delta2 * REFINE_SPREAD
    return SR / np.maximum(1.0, refined_lag)


def corr_raw_at(x, freq):
    freq = np.asarray(freq, dtype=float)
    flat = np.atleast_1d(freq).ravel()
    l0 = np.array([int(min(3200, max(1, int(SR / f + 0.5)))) for f in flat])
    pool = {}
    for L in np.unique(l0):
        pool[L] = corr_at_lag_var(x, int(L))
    out = np.array([pool[L][i] for i, L in enumerate(l0)])
    return out.reshape(np.shape(freq))


def subharmonic_promote(x, coarse, raw=False):
    demote_flag = None
    if raw == "asym":
        r_coarse = corr_raw_at(x, coarse)
        freq_h = coarse * 0.5
        p_coarse = corr_peak_at(x, coarse)
        p_h = corr_peak_at(x, freq_h)
        r_h = corr_raw_at(x, freq_h)
        fired = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        duty = one_pole(fired.astype(float), np.exp(-1.0 / (DEMOTE_TAU * SR)))
        demote = fired | (duty > RELEASE_FRAC)
        demote_flag = demote
        base = np.where(demote, freq_h, coarse)
        p_base = np.where(demote, r_h, r_coarse)
    elif raw == "smooth":
        r_coarse = corr_raw_at(x, coarse)
        freq_h = coarse * 0.5
        p_coarse = corr_peak_at(x, coarse)
        p_h = corr_peak_at(x, freq_h)
        r_h = corr_raw_at(x, freq_h)
        fired = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        demote = one_pole(fired.astype(float), np.exp(-1.0 / (DEMOTE_TAU * SR))) > 0.5
        demote_flag = demote
        base = np.where(demote, freq_h, coarse)
        p_base = np.where(demote, r_h, r_coarse)
    elif raw == "latch":
        r_coarse = corr_raw_at(x, coarse)
        freq_h = coarse * 0.5
        p_coarse = corr_peak_at(x, coarse)
        p_h = corr_peak_at(x, freq_h)
        r_h = corr_raw_at(x, freq_h)
        fired = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        held = p_h > p_coarse - SUBHARM_MARGIN
        latched = np.zeros(len(fired))
        prev = 0
        for i in range(len(fired)):
            if fired[i]:
                prev = 1
            elif prev and held[i]:
                prev = 1
            else:
                prev = 0
            latched[i] = prev
        base = np.where(latched > 0.5, freq_h, coarse)
        p_base = np.where(latched > 0.5, r_h, r_coarse)
    elif raw == "hold":
        r_coarse = corr_raw_at(x, coarse)
        freq_h = coarse * 0.5
        p_coarse = corr_peak_at(x, coarse)
        p_h = corr_peak_at(x, freq_h)
        r_h = corr_raw_at(x, freq_h)
        fired = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        duty = one_pole(fired.astype(float), np.exp(-1.0 / (DEMOTE_TAU * SR)))
        demote = fired
        demote_flag = demote
        base = np.where(demote, freq_h, coarse)
        p_base = np.where(demote, r_h, r_coarse)
        HOLD_SIGNALS["fired"] = fired
        HOLD_SIGNALS["duty"] = duty
    elif raw == "mixed":
        r_coarse = corr_raw_at(x, coarse)
        freq_h = coarse * 0.5
        p_coarse = corr_peak_at(x, coarse)
        p_h = corr_peak_at(x, freq_h)
        r_h = corr_raw_at(x, freq_h)
        demote = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        demote_flag = demote
        base = np.where(demote, freq_h, coarse)
        p_base = np.where(demote, r_h, r_coarse)
    elif raw:
        base = coarse
        p_base = corr_raw_at(x, coarse)
    else:
        p_coarse = corr_peak_at(x, coarse)
        freq_h = coarse * 0.5
        p_h = corr_peak_at(x, freq_h)
        demote = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
        demote_flag = demote
        base = np.where(demote, freq_h, coarse)
        p_base = np.where(demote, p_h, p_coarse)
    f2 = base * 2.0
    f3 = base * 3.0
    use_raw = raw is True or raw in ("mixed", "latch", "smooth", "asym", "hold")
    p2 = corr_raw_at(x, f2) if use_raw else corr_peak_at(x, f2)
    p3 = corr_raw_at(x, f3) if use_raw else corr_peak_at(x, f3)
    dom3 = (f3 <= MAX_TRACK_HZ) & (p3 >= CORR_THRESH) & (p3 > p_base + SUBHARM_MARGIN) & (p3 >= p2)
    dom2 = (f2 <= MAX_TRACK_HZ) & (p2 >= CORR_THRESH) & (p2 > p_base + SUBHARM_MARGIN)
    if EXCLUSIVE and demote_flag is not None:
        dom3 = dom3 & ~demote_flag
        dom2 = dom2 & ~demote_flag
    promoted = np.where(dom3, f3, np.where(dom2, f2, base))
    confidence = np.where(dom3, p3, np.where(dom2, p2, p_base))
    return promoted, confidence


def hold_damped(refined, fired, duty, rel):
    out = np.empty_like(refined)
    prev = 0.0
    for i in range(len(refined)):
        if fired[i] or duty[i] <= rel:
            prev = refined[i]
        out[i] = prev
    return out


def detected_freq(x, raw=False):
    xh = highpass1(x, 20.0)
    coarse = pick_fundamental(xh, len(x))
    corrected, confidence = subharmonic_promote(xh, coarse, raw=raw)
    refined = refine_freq(xh, corrected)
    if raw == "hold":
        refined = hold_damped(refined, HOLD_SIGNALS["fired"], HOLD_SIGNALS["duty"], RELEASE_FRAC)
    return np.clip(refined, MIN_TRACK_HZ, MAX_TRACK_HZ), confidence >= CORR_THRESH


def timbre_shift_tone(n, f0_hz, f0_start=1.0, f0_end=0.05, h2_start=0.3, h2_end=1.0,
                      ramp_start=0.2, ramp_end=3.0):
    t = np.arange(n) / SR
    frac = np.clip((t - ramp_start) / (ramp_end - ramp_start), 0.0, 1.0)
    a0 = f0_start + (f0_end - f0_start) * frac
    a2 = h2_start + (h2_end - h2_start) * frac
    sig = a0 * np.sin(2 * np.pi * f0_hz * t) + a2 * np.sin(2 * np.pi * f0_hz * 2.0 * t)
    sig = sig / np.max(np.abs(sig)) * 0.7
    attack = int(0.01 * SR)
    env = np.ones(n)
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return sig * env


def harmonic_tone(n, freq_hz, n_harmonics=6, amp=0.7, attack=200):
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for k in range(1, n_harmonics + 1):
        sig += (1.0 / k) * np.sin(2 * np.pi * freq_hz * k * t)
    sig = sig / np.max(np.abs(sig)) * amp
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, min(attack, n))
    env[: len(ramp)] = ramp
    return sig * env


def window_means(y, f0_hz, window_s=0.2, settle_s=0.10):
    win = int(window_s * SR)
    start = int(settle_s * SR)
    rows = []
    i = start
    while i + win <= len(y):
        seg = y[i:i + win]
        mean_hz = float(np.mean(seg))
        rows.append(((i + win / 2) / SR, mean_hz, 1200.0 * np.log2(mean_hz / f0_hz)))
        i += win
    return rows


def diag(freq_hz, dur=1.0, raw=False):
    n = int(dur * SR)
    x = highpass1(harmonic_tone(n, freq_hz), 20.0)
    coarse = pick_fundamental(x, n)
    p_coarse = corr_peak_at(x, coarse)
    freq_h = coarse * 0.5
    p_h = corr_peak_at(x, freq_h)
    demote = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
    promoted, conf = subharmonic_promote(x, coarse, raw=raw)
    refined = refine_freq(x, promoted)
    print(f"diag {freq_hz}Hz")
    for t in (0.2, 0.5, 0.9):
        i = int(t * SR)
        print(f"  t={t}s coarse={coarse[i]:9.2f} pCoarse={p_coarse[i]:.6f} "
              f"freqH={freq_h[i]:9.2f} pH={p_h[i]:.6f} demote={int(demote[i])} "
              f"promoted={promoted[i]:9.2f} conf={conf[i]:.6f} refined={refined[i]:9.2f}")


def diag_timbre(freq_hz, dur=3.4, raw=False):
    n = int(dur * SR)
    x = highpass1(timbre_shift_tone(n, freq_hz), 20.0)
    coarse = pick_fundamental(x, n)
    p_coarse = corr_peak_at(x, coarse)
    freq_h = coarse * 0.5
    p_h = corr_peak_at(x, freq_h)
    r_coarse = corr_raw_at(x, coarse)
    r_h = corr_raw_at(x, freq_h)
    demote = (freq_h >= MIN_TRACK_HZ) & (p_h >= CORR_THRESH) & (p_h > p_coarse + SUBHARM_MARGIN)
    promoted, _ = subharmonic_promote(x, coarse, raw=raw)
    refined = refine_freq(x, promoted)
    print(f"timbre diag f0={freq_hz}Hz raw={raw}")
    for t in (2.2, 2.4, 2.6, 2.8, 3.0, 3.2):
        i = int(t * SR)
        print(f"  t={t}s coarse={coarse[i]:9.2f} pCoarse={p_coarse[i]:.6f} pH={p_h[i]:.6f} "
              f"rCoarse={r_coarse[i]:.6f} rH={r_h[i]:.6f} demote={int(demote[i])} "
              f"promoted={promoted[i]:9.2f} refined={refined[i]:9.2f}")


def main():
    global PEAK_CEIL, SUBHARM_MARGIN, DEMOTE_TAU, RELEASE_FRAC, EXCLUSIVE
    for arg in sys.argv[1:]:
        if arg.startswith("ceil="):
            PEAK_CEIL = float(arg[5:])
        elif arg.startswith("m="):
            SUBHARM_MARGIN = float(arg[2:])
        elif arg.startswith("dtau="):
            DEMOTE_TAU = float(arg[5:])
        elif arg.startswith("rel="):
            RELEASE_FRAC = float(arg[4:])
        elif arg == "excl":
            EXCLUSIVE = True
    raw = True if "raw" in sys.argv else ("mixed" if "mixed" in sys.argv else ("smooth" if "smooth" in sys.argv else ("latch" if "latch" in sys.argv else ("asym" if "asym" in sys.argv else "hold"))))
    if raw in ("asym", "hold"):
        EXCLUSIVE = True
        DEMOTE_TAU = 0.2
        RELEASE_FRAC = 0.5
    if "timbre" in sys.argv:
        for a in sys.argv[2:]:
            try:
                diag_timbre(float(a), raw=raw)
            except ValueError:
                pass
        return 0
    if "diag" in sys.argv:
        for a in sys.argv[2:]:
            try:
                diag(float(a), raw=raw)
            except ValueError:
                pass
        return 0
    print("software model of pitchtracker_ac.dsp")
    print(f"DSP: {DSP_PATH}")
    worst_overall = 0.0
    all_ok = True

    for f0 in (110.0, 220.0, 440.0):
        dur = 3.4
        n = int(dur * SR)
        y, _ = detected_freq(timbre_shift_tone(n, f0), raw=raw)
        rows = window_means(y, f0)
        worst = max(abs(r[2]) for r in rows)
        worst_overall = max(worst_overall, worst)
        ok = worst < 100.0
        all_ok = all_ok and ok
        cells = " ".join(f"t{t:.1f}={hz:.1f}Hz({c:+.0f}c)" for t, hz, c in rows)
        print(f"  timbre f0={f0:6.1f}Hz: {cells}")
        print(f"    -> worst={worst:.1f}c ({'OK' if ok else 'FAIL'})")

    for f in (82.0, 110.0, 130.8, 164.8, 196.0, 220.0, 246.9, 440.0, 880.0, 1318.5, 1046.5):
        n = int(1.0 * SR)
        y, _ = detected_freq(harmonic_tone(n, f), raw=raw)
        i0, i1 = int(0.15 * SR), int(1.0 * SR)
        mean_hz = float(np.mean(y[i0:i1]))
        err = 1200.0 * np.log2(mean_hz / f)
        ok = abs(err) < 30.0
        all_ok = all_ok and ok
        print(f"  steady {f:8.1f}Hz -> {err:+7.1f}c ({'OK' if ok else 'FAIL'})")

    print()
    print("MODEL PASSED" if all_ok else "MODEL FAILED")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
