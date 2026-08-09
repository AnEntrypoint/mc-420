import("stdfaust.lib");

SR   = 48000.0;

REVAMT = 0.0;
TIME   = 0.5;

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

process = _ <: select2(REVAMT > 0.001, _, reverb(REVAMT, TIME));
