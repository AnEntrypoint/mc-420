import("stdfaust.lib");

SR   = 48000.0;
MAXD = 52000;
SLEW = 0.0001;

DELAYAMT = hslider("DELAYAMT", 0.0, 0.0, 1.0, 0.001);
REVAMT   = hslider("REVAMT",   0.0, 0.0, 2.0, 0.001);
TIME     = hslider("TIME",     0.5, 0.0, 1.0, 0.001);

MIN_DELAY_MS = 1000.0 / SR;

targetSamples(t) = max(1.0, min(MAXD - 1.0, (t*(1000.0 - MIN_DELAY_MS) + MIN_DELAY_MS) * SR / 1000.0));

curStep(target, c) = c + (target - c)*SLEW;
curDelayRec(target) = c letrec { 'c = curStep(target, c); };
newDelayFrom(target, c) = c + (target - c)*SLEW;

fracDelay(len, w) = tap0*(1.0 - fr) + tap1*fr
with {
    i0  = int(len);
    fr  = len - float(i0);
    tap0 = de.delay(MAXD, i0, w);
    tap1 = de.delay(MAXD, i0 + 1, w);
};

FEEDBACK_STATE_LIMIT = 8.0;

delayFC(amount, t, x) = x + amount * d
with {
    fb     = amount * 1.05;
    target = targetSamples(t);
    cd     = curDelayRec(target);
    len    = newDelayFrom(target, cd);
    d   = (loop ~ _) : fracDelay(len)
    with {
        loop(w) = (x + fb * fracDelay(len, w)) : max(-FEEDBACK_STATE_LIMIT) : min(FEEDBACK_STATE_LIMIT);
    };
};

lens = (2473, 2767, 3217, 3571, 3907, 4057, 2143, 1933);
lenAt(i) = ba.take(i + 1, lens);

decayC(amt, t) = min(0.998, 0.70 + t*0.25 + amt*amt*0.05);
dampC(amt)     = max(0.3, 0.7 - amt*0.4);

clip4(x) = max(-4.0, min(4.0, x));

dampFilter(damp) = *(1.0 - damp) : (+ ~ *(damp));

combLineExact(L, decay, damp, input) = dampedOut
with {
    tap(f)    = f : de.delay(8192, L) : dampFilter(damp);
    combGen(f) = clip4(input + tap(f)*decay);
    fed       = combGen ~ _;
    dampedOut = tap(fed);
};

reverb(amt, t, x) = x + revL * amt * 0.25
with {
    decay = decayC(amt, t);
    damp  = dampC(amt);
    input = x * 0.15;
    line(i) = combLineExact(lenAt(i), decay, damp, input);
    revL    = line(0) + line(1) + line(2) + line(3);
};

process = delayFC(DELAYAMT, TIME) : reverb(REVAMT, TIME);
