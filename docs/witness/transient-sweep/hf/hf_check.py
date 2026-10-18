import wave, struct, math, sys, cmath

def read_mono(path):
    w = wave.open(path, 'rb')
    sr = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth(); n = w.getnframes()
    raw = w.readframes(n)
    w.close()
    fmt = {1: 'b', 2: '<h', 4: '<i'}[sw]
    vals = struct.unpack('<' + fmt[-1] * (len(raw) // sw), raw) if sw != 1 else struct.unpack('b' * len(raw), raw)
    if ch > 1:
        vals = vals[::ch]
    scale = float(2 ** (8 * sw - 1))
    return sr, [v / scale for v in vals]

def fft(a):
    n = len(a)
    if n <= 1:
        return a
    j = 0
    out = list(a)
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            out[i], out[j] = out[j], out[i]
    size = 2
    while size <= n:
        half = size // 2
        w = cmath.exp(-2j * math.pi / size)
        for start in range(0, n, size):
            t = 1
            for k in range(half):
                u = out[start + k]
                v = out[start + k + half] * t
                out[start + k] = u + v
                out[start + k + half] = u - v
                t *= w
        size <<= 1
    return out

BANDS = [(100, 1000), (1000, 3500), (3500, 8000), (8000, 20000)]

def band_fractions(sr, x, t0, t1, N=2048, hop=4096):
    s0, s1 = int(t0 * sr), min(len(x), int(t1 * sr))
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / N) for i in range(N)]
    acc = [0.0] * len(BANDS)
    frames = 0
    p = s0
    while p + N <= s1:
        seg = [x[p + i] * win[i] for i in range(N)]
        X = fft(seg)
        for k in range(1, N // 2):
            f = k * sr / N
            pw = abs(X[k]) ** 2
            for bi, (lo, hi) in enumerate(BANDS):
                if lo <= f < hi:
                    acc[bi] += pw
        frames += 1
        p += hop
    tot = sum(acc) or 1e-30
    return frames, [a / tot for a in acc]

if __name__ == '__main__':
    t0, t1 = float(sys.argv[1]), float(sys.argv[2])
    for path in sys.argv[3:]:
        sr, x = read_mono(path)
        frames, fr = band_fractions(sr, x, t0, t1)
        cells = ' '.join('%s:%5.1f%%' % ('%d-%d' % b, 100 * v) for b, v in zip(BANDS, fr))
        print('%-60s frames=%-3d %s' % (path.split('/')[-1], frames, cells))
