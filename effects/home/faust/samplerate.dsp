import("stdfaust.lib");

SRRAMT = hslider("SRRAMT", 0.0, 0.0, 1.0, 0.01);

N_MAX = 32.0;

holdN = int(pow(N_MAX, SRRAMT));

cnt = counter ~ _
with {
    counter(prev) = (prev + 1) % max(1, holdN);
};
refresh = (cnt == 0);

srHold(x) = held
with {
    held = (loop ~ _)
    with {
        loop(prev) = ba.if(refresh, x, prev);
    };
};

process = _ <: srHold;
