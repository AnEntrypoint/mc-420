import("stdfaust.lib");

SR   = 48000.0;
MAXD = 52000;
SLEW = 0.0001;

DELAYAMT = 0.0;
TIME     = 0.5;

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

process = delayFC(DELAYAMT, TIME);
