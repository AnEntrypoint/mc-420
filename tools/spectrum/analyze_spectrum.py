import sys
import wave
import numpy as np

kSeg = 16384
kHop = 8192
kBands = [(0, 100), (100, 1000), (1000, 5000), (5000, 10000), (10000, 16000), (16000, 20000), (20000, 24000)]


def db(v):
    return float('-inf') if v <= 0 else 20.0 * np.log10(v)


def main():
    path = sys.argv[1]
    w = wave.open(path, 'rb')
    nch = w.getnchannels()
    sw = w.getsampwidth()
    sr = w.getframerate()
    raw = w.readframes(w.getnframes())
    print('file %s  ch %d  width %d  sr %d  frames %d' % (path, nch, sw, sr, len(raw) // (sw * nch)))

    x = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    if nch > 1:
        x = x.reshape(-1, nch).mean(axis=1)

    nonzero = int(np.count_nonzero(x))
    rms = float(np.sqrt(np.mean(x * x)))
    peak = float(np.max(np.abs(x)))
    print('nonzero samples %d / %d (%.3f%%)' % (nonzero, x.size, 100.0 * nonzero / x.size))
    print('peak %.6f (%.2f dBFS)   rms %.8f (%.2f dBFS)' % (peak, db(peak), rms, db(rms)))

    win = np.hanning(kSeg)
    acc = np.zeros(kSeg // 2 + 1)
    count = 0
    for start in range(0, max(1, x.size - kSeg), kHop):
        blk = x[start:start + kSeg]
        if blk.size < kSeg:
            break
        acc += np.abs(np.fft.rfft(blk * win)) ** 2
        count += 1
    if count == 0:
        acc = np.abs(np.fft.rfft(np.zeros(kSeg))) ** 2
        count = 1
    psd = acc / count
    freqs = np.fft.rfftfreq(kSeg, 1.0 / sr)
    psd_db = 10 * np.log10(psd / (np.sum(win ** 2) * sr) + 1e-30)

    print('\nband energy (dBFS per band, %d segments of %d samples):' % (count, kSeg))
    for lo, hi in kBands:
        sel = (freqs >= lo) & (freqs < hi)
        if not np.any(sel):
            continue
        print('  %6d-%6d Hz  %8.2f dB' % (lo, hi, 10 * np.log10(np.sum(psd[sel]) + 1e-30)))

    print('\nspectral shape (median floor vs peaks):')
    med = float(np.median(psd_db))
    print('  median bin  %8.2f dB' % med)
    order = np.argsort(psd_db)[::-1]
    seen = []
    for i in order:
        f = float(freqs[i])
        if any(abs(f - s) < 60 for s in seen):
            continue
        seen.append(f)
        print('  peak %8.1f Hz  %8.2f dB  (+%.1f over median)' % (f, psd_db[i], psd_db[i] - med))
        if len(seen) >= 12:
            break

    print('\ncoarse spectrum every 1 kHz:')
    for lo in range(0, 24000, 1000):
        sel = (freqs >= lo) & (freqs < lo + 1000)
        if not np.any(sel):
            continue
        print('  %5d kHz  %8.2f dB' % (lo // 1000, 10 * np.log10(np.sum(psd[sel]) + 1e-30)))


main()
