import sys, math
sys.path.insert(0, sys.argv[1])
from hf_check import read_mono, band_fractions, BANDS
def abs_db(sr, x, t0, t1, N=2048):
    seg = x[int(t0*sr):int(t1*sr)]
    if not seg: return [float('nan')]*len(BANDS)
    import hf_check
    frames, fr = band_fractions(sr, seg, 0.0, len(seg)/sr, N=N, hop=4096)
    ms = sum(v*v for v in seg)/len(seg)
    tot_db = 10*math.log10(max(ms,1e-30))
    return [tot_db + 10*math.log10(max(f,1e-12)) for f in fr]
for path in sys.argv[2:]:
    sr, x = read_mono(path)
    pre = abs_db(sr, x, 0.0, 0.4)
    note = abs_db(sr, x, 0.5, 5.5)
    cells = ' '.join('%s pre%6.1f note%6.1f' % ('%d-%d' % b, p, n) for b, p, n in zip(BANDS, pre, note))
    print('%-34s %s' % (path.split('/')[-1], cells))
