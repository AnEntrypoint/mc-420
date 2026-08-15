import aifc
import wave
import struct
import numpy as np

TARGET_SR = 48000


def _read_aiff(path):
    with aifc.open(path, "rb") as f:
        nchannels = f.getnchannels()
        sampwidth = f.getsampwidth()
        framerate = f.getframerate()
        nframes = f.getnframes()
        raw = f.readframes(nframes)
    if sampwidth == 2:
        fmt = ">%dh" % (nframes * nchannels)
        ints = struct.unpack(fmt, raw)
        arr = np.array(ints, dtype=np.float64) / 32768.0
    elif sampwidth == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        vals = (b[:, 0].astype(np.int32) << 16) | (b[:, 1].astype(np.int32) << 8) | b[:, 2].astype(np.int32)
        vals = np.where(vals >= (1 << 23), vals - (1 << 24), vals)
        arr = vals.astype(np.float64) / float(1 << 23)
    elif sampwidth == 4:
        fmt = ">%di" % (nframes * nchannels)
        ints = struct.unpack(fmt, raw)
        arr = np.array(ints, dtype=np.float64) / float(1 << 31)
    else:
        raise ValueError("unsupported AIFF sample width %d in %s" % (sampwidth, path))
    arr = arr.reshape(-1, nchannels)
    mono = arr.mean(axis=1)
    return mono.astype(np.float64), framerate


def _read_wav(path):
    with wave.open(path, "rb") as f:
        nchannels = f.getnchannels()
        sampwidth = f.getsampwidth()
        framerate = f.getframerate()
        nframes = f.getnframes()
        raw = f.readframes(nframes)
    if sampwidth == 2:
        ints = np.frombuffer(raw, dtype="<i2")
        arr = ints.astype(np.float64) / 32768.0
    elif sampwidth == 4:
        ints = np.frombuffer(raw, dtype="<i4")
        arr = ints.astype(np.float64) / float(1 << 31)
    elif sampwidth == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        vals = b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)
        vals = np.where(vals >= (1 << 23), vals - (1 << 24), vals)
        arr = vals.astype(np.float64) / float(1 << 23)
    else:
        raise ValueError("unsupported WAV sample width %d in %s" % (sampwidth, path))
    arr = arr.reshape(-1, nchannels)
    mono = arr.mean(axis=1)
    return mono.astype(np.float64), framerate


def load_audio_mono(path):
    lower = path.lower()
    if lower.endswith(".wav"):
        mono, sr = _read_wav(path)
    else:
        mono, sr = _read_aiff(path)
    return mono, sr


def resample_linear(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x.astype(np.float64)
    n_in = len(x)
    dur = n_in / sr_in
    n_out = int(round(dur * sr_out))
    t_in = np.arange(n_in) / sr_in
    t_out = np.arange(n_out) / sr_out
    return np.interp(t_out, t_in, x)


def load_to_48k_mono_f32(path):
    mono, sr = load_audio_mono(path)
    mono48 = resample_linear(mono, sr, TARGET_SR)
    return mono48.astype(np.float32)


def write_aiff16(path, samples_float, sr=TARGET_SR):
    clipped = np.clip(samples_float, -1.0, 1.0)
    ints = np.round(clipped * 32767.0).astype(">i2")
    with aifc.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(ints.tobytes())


def measure_freq(samples, sr, min_hz=50.0, max_hz=2000.0):
    """Autocorrelation-based fundamental frequency estimate with parabolic
    sub-sample refinement over a whole windowed segment."""
    x = np.asarray(samples, dtype=np.float64)
    n = len(x)
    if n < 32:
        return float("nan")
    x = x - np.mean(x)
    win = np.hanning(n)
    xw = x * win
    max_lag = int(sr / min_hz)
    min_lag = max(1, int(sr / max_hz))
    max_lag = min(max_lag, n - 1)
    if max_lag <= min_lag:
        return float("nan")

    nfft = 1
    while nfft < 2 * n:
        nfft *= 2
    spec = np.fft.rfft(xw, n=nfft)
    ac = np.fft.irfft(spec * np.conj(spec), n=nfft)[:n]
    ac0 = ac[0]
    if ac0 <= 0:
        return float("nan")
    ac = ac / ac0

    search = ac[min_lag:max_lag + 1]
    if len(search) < 3:
        return float("nan")
    global_max = float(np.max(search))
    peak_idx_local = int(np.argmax(search))
    # Prefer the SHORTEST-lag (highest-frequency) local maximum that still
    # clears 90% of the window's own global-max correlation, rather than
    # the bare global argmax -- a periodic tone correlates near-perfectly
    # at every integer multiple of its true period too, so an unqualified
    # argmax silently locks onto a subharmonic half as often as the true
    # fundamental. Mirrors this project's own documented "first-strong-peak"
    # discipline (see AGENTS.md's pitchtracker_ac.dsp history) rather than
    # inventing a new heuristic.
    thresh = global_max * 0.90
    for i in range(1, len(search) - 1):
        if search[i] >= thresh and search[i] >= search[i - 1] and search[i] >= search[i + 1]:
            peak_idx_local = i
            break
    peak_lag = min_lag + peak_idx_local
    if peak_lag <= 0 or peak_lag >= len(ac) - 1:
        return sr / peak_lag if peak_lag > 0 else float("nan")

    y0, y1, y2 = ac[peak_lag - 1], ac[peak_lag], ac[peak_lag + 1]
    denom = (y0 - 2.0 * y1 + y2)
    if abs(denom) < 1e-12:
        delta = 0.0
    else:
        delta = 0.5 * (y0 - y2) / denom
        if delta > 1.0 or delta < -1.0:
            delta = 0.0
    refined_lag = peak_lag + delta
    if refined_lag <= 0:
        return float("nan")
    return sr / refined_lag


def measure_freq_windowed(samples, sr, start_s, end_s, min_hz=50.0, max_hz=2000.0):
    i0 = int(start_s * sr)
    i1 = int(end_s * sr)
    i0 = max(0, i0)
    i1 = min(len(samples), i1)
    if i1 <= i0:
        return float("nan")
    return measure_freq(samples[i0:i1], sr, min_hz=min_hz, max_hz=max_hz)


def cents_diff(measured_hz, target_hz):
    if measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def envelope_rms(samples, sr, win_ms=20.0):
    win = max(1, int(sr * win_ms / 1000.0))
    x = np.asarray(samples, dtype=np.float64)
    n = len(x)
    out = np.zeros(n)
    csum = np.cumsum(x * x)
    for i in range(n):
        lo = max(0, i - win)
        s = csum[i] - (csum[lo - 1] if lo > 0 else 0.0)
        cnt = i - lo + 1
        out[i] = (s / cnt) ** 0.5
    return out


def find_sustained_segment(samples, sr, min_dur_s=0.3, silence_ratio=0.15, win_ms=20.0):
    """Scan a file end-to-end and return (start_s, end_s) of the longest
    contiguous region whose RMS envelope stays above silence_ratio of the
    file's own peak RMS -- used to locate a genuinely sustained note inside
    a longer recording (a scale run, an onset/decay envelope, or a file that
    starts/ends in silence) before trusting any single measured frequency."""
    win = max(1, int(sr * win_ms / 1000.0))
    x = np.asarray(samples, dtype=np.float64)
    n = len(x)
    hop = win
    n_frames = n // hop
    frame_rms = np.zeros(n_frames)
    for i in range(n_frames):
        seg = x[i * hop:(i + 1) * hop]
        frame_rms[i] = float(np.sqrt(np.mean(seg * seg))) if len(seg) else 0.0
    if n_frames == 0:
        return 0.0, n / sr
    peak = np.max(frame_rms)
    thresh = peak * silence_ratio
    active = frame_rms > thresh

    best_len = 0
    best_start = 0
    cur_start = None
    for i, a in enumerate(active):
        if a and cur_start is None:
            cur_start = i
        if (not a or i == len(active) - 1) and cur_start is not None:
            cur_end = i if not a else i + 1
            length = cur_end - cur_start
            if length > best_len:
                best_len = length
                best_start = cur_start
            cur_start = None

    start_s = best_start * hop / sr
    end_s = (best_start + best_len) * hop / sr
    if end_s - start_s < min_dur_s:
        return start_s, end_s
    return start_s, end_s
