import numpy as np


def measure_freq(audio_segment, sr, min_hz=40.0, max_hz=2000.0):
    x = np.asarray(audio_segment, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=0) if x.shape[0] < x.shape[-1] else x.mean(axis=-1)
    n = len(x)
    if n < 8:
        return float("nan")

    x = x - np.mean(x)
    rms = float(np.sqrt(np.mean(x * x)))
    if rms < 1e-5:
        return float("nan")

    min_lag = max(1, int(np.floor(sr / max_hz)))
    max_lag = int(np.ceil(sr / min_hz))
    max_lag = min(max_lag, n - 2)
    if max_lag <= min_lag + 1:
        return float("nan")

    full_corr = np.correlate(x, x, mode="full")
    zero_idx = len(full_corr) // 2
    cross = full_corr[zero_idx: zero_idx + max_lag + 2].astype(np.float64)

    sq = x * x
    cumsum_sq = np.cumsum(sq)
    total_energy = cumsum_sq[-1]

    lags = np.arange(len(cross))
    head_end = n - lags - 1
    valid_head = head_end >= 0
    energy_head = np.where(valid_head, cumsum_sq[np.clip(head_end, 0, n - 1)], 0.0)
    prev_lag = lags - 1
    energy_tail = total_energy - np.where(prev_lag >= 0, cumsum_sq[np.clip(prev_lag, 0, n - 1)], 0.0)

    denom = np.sqrt(np.maximum(energy_head * energy_tail, 0.0))
    ncc = np.where(denom > 1e-18, cross / np.where(denom > 1e-18, denom, 1.0), 0.0)

    search = ncc[min_lag: max_lag + 1]
    if len(search) < 3:
        return float("nan")

    best_val = float(np.max(search))
    if best_val <= 0.0:
        return float("nan")

    threshold = max(0.05, 0.85 * best_val)

    local_max_rel = []
    for i in range(1, len(search) - 1):
        if search[i] >= search[i - 1] and search[i] >= search[i + 1] and search[i] >= threshold:
            local_max_rel.append(i)

    if local_max_rel:
        peak_rel = local_max_rel[0]
    else:
        peak_rel = int(np.argmax(search))

    peak_lag = min_lag + peak_rel

    if peak_lag <= 0 or peak_lag >= len(ncc) - 1:
        true_lag = float(peak_lag)
    else:
        y0 = ncc[peak_lag - 1]
        y1 = ncc[peak_lag]
        y2 = ncc[peak_lag + 1]
        denom2 = y0 - 2.0 * y1 + y2
        if abs(denom2) < 1e-12:
            true_lag = float(peak_lag)
        else:
            delta = 0.5 * (y0 - y2) / denom2
            delta = max(-1.0, min(1.0, delta))
            true_lag = peak_lag + delta

    if true_lag <= 0:
        return float("nan")

    freq = sr / true_lag
    if freq < min_hz * 0.5 or freq > max_hz * 2.0:
        return float("nan")

    return freq
