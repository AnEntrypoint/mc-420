import wave, math, struct, sys
w = wave.open(sys.argv[1], 'rb')
sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
raw = w.readframes(n); w.close()
vals = struct.unpack('<%dh' % (n*ch), raw)
x = [vals[i*ch]/32768.0 for i in range(n)]
print('sr', sr, 'ch', ch, 'frames', n)
p = math.exp(-1.0/(0.003*sr))
H = int(35.0*0.001*sr)
env = 0.0; hc = 0; prev_ready = 0
trans = []
blockmax = {}
for i, s in enumerate(x):
    env = s*s*(1.0-p) + p*env
    hc = min(H, hc+1) if env > 1e-6 else 0
    r = 1 if hc >= H else 0
    if r != prev_ready:
        trans.append((i/sr, r, env))
        prev_ready = r
for t, r, e in trans:
    print('ready->%d at t=%.4f s env=%.3e sqrtenv=%.5f' % (r, t, e, math.sqrt(e)))
on = sum(1 for i in range(n) if False)
