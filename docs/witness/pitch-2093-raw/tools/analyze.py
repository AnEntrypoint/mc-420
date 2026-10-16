import sys, os, statistics, glob
S = os.path.dirname(os.path.abspath(__file__))
variants = sys.argv[1].split(',')
inputs = [os.path.basename(p)[:-4] for p in sorted(glob.glob('/config/workspace/mc-420/test-audio-corpus/instruments/*.wav'))] + ['sine_220','sine_440','sine_1000','sine_1500','sine_2093','sine_3000']
def settled(path):
    rows = [l.split() for l in open(path) if l.strip()]
    if not rows: return None
    tmax = float(rows[-1][0])
    vals = [float(v) for t, v in rows if float(t) >= 0.5 * tmax]
    return statistics.median(vals)
res = {}
for v in variants:
    for i in inputs:
        res[(v,i)] = settled(f'{S}/out/trace_{v}_{i}.txt')
base = 'base'
changed = {}
for v in variants:
    ch = []
    for i in inputs:
        b = res[(base,i)]; x = res[(v,i)]
        if b is None or x is None: ch.append((i,'missing')); continue
        if b == 0: d = 0 if x == 0 else 999
        else: d = abs(x-b)/abs(b)*100
        if d > 1.0: ch.append((i, round(b,3), round(x,3), round(d,2)))
    changed[v] = ch
for v in variants:
    print('VARIANT', v, '2093', res[(v,'sine_2093')], '1000', res[(v,'sine_1000')], '440', res[(v,'sine_440')], '220', res[(v,'sine_220')], '1500', res[(v,'sine_1500')], '3000', res[(v,'sine_3000')])
    print('  files_changed_gt1pct', len([c for c in changed[v] if c[0] not in [x for x in inputs if x.startswith('sine')]]), 'sines', [c[0] for c in changed[v] if c[0].startswith('sine')])
    for c in changed[v]:
        print('   ', c)
