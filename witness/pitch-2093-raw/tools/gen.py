import sys, re, math
src = open(sys.argv[1]).read()
out = sys.argv[2]; F = None if sys.argv[3] == "none" else float(sys.argv[3]); M = float(sys.argv[4]) if len(sys.argv) > 4 else None
def sub1(pat, rep, s):
    n = len(re.findall(pat, s, flags=re.S))
    assert n == 1, (pat[:60], n)
    return re.sub(pat, lambda m: rep, s, flags=re.S)
s = src
ext = []
if F is not None:
    old = s[s.index('refineFreq(x, w, coarseFreq) = refinedFreq'):s.index('peakSpreadK = 1;')]
    new = '''refineFreq(x, w, coarseFreq) = refinedFreq
with {
    P = ma.SR / coarseFreq;
    L0 = int(P) : max(4) : min(3199 - refineSpreadK);
    K = int(P * %s) : max(1) : min(refineSpreadK);
    cLo  = corrAtLagVar(x, w, L0 - K);
    cMid = corrAtLagVar(x, w, L0);
    cHi  = corrAtLagVar(x, w, L0 + K);
    denom = cLo - 2.0*cMid + cHi;
    safeDenom = ba.if(abs(denom) < 1e-6, 1e-6, denom);
    delta = 0.5 * (cLo - cHi) / safeDenom : max(-1.0) : min(1.0);
    delta2 = ba.if(abs(denom) < 1e-6, 0.0, delta);
    refinedLag = float(L0) + delta2 * float(K);
    refinedFreq = ma.SR / max(1.0, refinedLag);
};

''' % repr(F)
    s = s.replace(old, new)
if M is not None:
    r = 1500.0 / 1423.02
    r = 1581.12 / 1500.0
    s = sub1(r'maxTrackHz = 1500\.0;', 'maxTrackHz = %s;' % repr(M), s)
    ext = []
    k = 0
    while 1581.12 * r**k <= M:
        ext.append(1581.12 * r**k); k += 1
    top_nb = 1581.12 * r**k
    existing = [1500.0,1423.02,1350.0,1272.79,1200.0,1095.45,1000.0,938.08,880.0,784.86,700.0,641.01,587.0,508.21,440.0,391.87,349.0,320.32,294.0,277.33,261.6,239.9,220.0,201.74,185.0,169.66,155.6,142.66,130.8,119.95,110.0,100.87,92.5,84.83,77.8,71.33,65.4,62.64,60.0]
    desc = sorted(ext, reverse=True) + existing
    desc = [round(v, 2) for v in desc]
    def c(v): return 'c(%s)' % (repr(float(v)) if '.' in repr(float(v)) else repr(float(v)))
    body = ''
    cnt = len(desc) - 1
    expr = 'ba.if(c(60.0) >= corrThresh, 60.0,\n        60.0)'
    parts = []
    for i in range(len(desc) - 1):
        prev = desc[i-1] if i > 0 else round(top_nb, 2)
        cur = desc[i]; nxt = desc[i+1]
        if cur == 60.0: break
        parts.append('isPeak(%s, %s, %s), %s' % (c(prev), c(cur), c(nxt), repr(cur)))
    chain = ''
    for p in parts[:-0 or None]:
        pass
    text = ''
    for idx, p in enumerate(parts):
        cond, val = p.rsplit(', ', 1)
        text += 'ba.if(%s, %s,\n        ' % (cond, val)
    text += expr + ')' * len(parts)
    head = 'pickFundamental(x) = result\nwith {\n    c(f) = corrAtLagTau(x, lagFor(f), tauFor(f));\n    isPeak(cLo, cMid, cHi) = (cMid >= corrThresh) & (cMid >= cLo) & (cMid >= cHi);\n\n    result =\n        '
    tail = ';\n};\n'
    start = s.index('pickFundamental(x) = result'); end = s.index('};', start) + 3
    s = s[:start] + head + text + tail + s[end:]
open(out, 'w').write(s)
print('written', out)
