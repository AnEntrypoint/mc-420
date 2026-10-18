import sys, math
sys.path.insert(0, '/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad')
from hf_check import read_mono
def decimate(x, k):
    out = []
    for i in range(0, len(x) - k, k):
        out.append(sum(x[i:i+k]) / k)
    return out
def best_pitch(seg, sr, fmin=80, fmax=1000):
    W = 512
    lo, hi = int(sr / fmax), int(sr / fmin)
    best = (0.0, 0.0)
    e0 = sum(v*v for v in seg[:W]) or 1e-30
    for lag in range(lo, min(hi, len(seg) - W - 1)):
        num = sum(seg[i] * seg[i+lag] for i in range(W))
        den = math.sqrt(sum(seg[i]**2 for i in range(W)) * sum(seg[i+lag]**2 for i in range(W))) or 1e-30
        r = num / den
        if r > best[0]:
            best = (r, lag)
    r, lag = best
    return (sr / lag if lag else 0.0), r
for path, target in [('t_marimba_mid_C5B5_n72_r1.wav', 523.25), ('t_vibraphone_mid_C5B5_n72_r1.wav', 523.25), ('t_vibraphone_mid_C5B5_n60_r1.wav', 261.63)]:
    base = '/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/tslogs/'
    sr, x = read_mono(base + path)
    k = 4
    y = decimate(x, k); sr2 = sr // k
    rows = []
    B = int(0.1 * sr2)
    for s in range(int(0.5 * sr2), int(5.5 * sr2) - B, B):
        f, r = best_pitch(y[s:s+B], sr2)
        rows.append((f, r))
    good = [f for f, r in rows if r >= 0.8]
    med = sorted(good)[len(good)//2] if good else 0.0
    cents = 1200 * math.log2(med / target) if med else float('nan')
    print('%-34s target %.2f  blocks=%d  r>=0.8: %d (%.0f%%)  median f0 of good blocks %.2f Hz (%+.1f c)' % (path, target, len(rows), len(good), 100*len(good)/max(1,len(rows)), med, cents))
