import math
import os
import struct
import sys
import wave

SR = 48000
DUR = 6.0
PEAK = 0.7
SUSTAIN = 0.15


def sustain_env(t, attack, decay):
    if t < 0.0:
        return 0.0
    rise = 1.0 if attack <= 0.0 else min(1.0, t / attack)
    fall = SUSTAIN + (1.0 - SUSTAIN) * math.exp(-t / decay)
    return rise * fall


def formant_gain(f, formants):
    g = 0.0
    for fc, width, amp in formants:
        d = (f - fc) / (width * fc)
        g += amp * math.exp(-d * d)
    return g


def render_note(f0, partials, attack, decay, vibrato_hz=0.0, vibrato_cents=0.0, delay_s=0.0, tremolo_hz=0.0, tremolo_depth=0.0):
    n = int(SR * DUR)
    start = int(delay_s * SR)
    phase = 0.0
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        f = f0
        if vibrato_hz > 0.0:
            f *= 2.0 ** (vibrato_cents / 1200.0 * math.sin(2.0 * math.pi * vibrato_hz * t))
        phase += f / SR
        s = 0.0
        for h, amp in partials:
            s += amp * math.sin(2.0 * math.pi * h * phase)
        e = sustain_env(t - delay_s, attack, decay)
        if tremolo_hz > 0.0:
            e *= 1.0 + tremolo_depth * math.sin(2.0 * math.pi * tremolo_hz * t)
        out[i] += s * e if i >= start else 0.0
    return out


def sum_signals(*signals):
    n = int(SR * DUR)
    out = [0.0] * n
    for s in signals:
        for i, v in enumerate(s):
            out[i] += v
    return out


def normalize(x):
    m = max(abs(v) for v in x) or 1.0
    g = PEAK / m
    return [v * g for v in x]


def harmonics(count, rolloff, inharmonicity=0.0):
    return [(h * math.sqrt(1.0 + inharmonicity * h * h), 1.0 / (h ** rolloff)) for h in range(1, count + 1)]


def formant_partials(f0, count, rolloff, formants):
    ps = []
    for h in range(1, count + 1):
        f = f0 * h
        if f > 0.45 * SR:
            break
        ps.append((h, (1.0 / (h ** rolloff)) * formant_gain(f, formants)))
    return ps


def piano():
    return render_note(261.626, harmonics(10, 1.4, 0.0001), 0.005, 2.0)


def marimba():
    return sum_signals(
        render_note(523.251, harmonics(6, 2.0), 0.002, 0.8, delay_s=0.0),
        render_note(987.767, harmonics(6, 2.0), 0.002, 0.8, delay_s=3.0),
    )


def vocal():
    formants = ((800.0, 0.12, 1.0), (1150.0, 0.10, 0.8), (2900.0, 0.08, 0.5))
    ps = formant_partials(220.0, 40, 0.9, formants)
    return render_note(220.0, ps, 0.08, 4.0, vibrato_hz=5.5, vibrato_cents=35.0)


def cello():
    return render_note(110.0, harmonics(24, 1.1), 0.12, 4.0, tremolo_hz=4.5, tremolo_depth=0.06)


CLIPS = (
    ("piano_mid_C4", piano),
    ("marimba_mid_C5B5", marimba),
    ("vocal_female_vibrato", vocal),
    ("cello_low_sulC_A2", cello),
)


def write_wav(path, samples):
    frames = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in samples)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames)


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else "test-audio-corpus/instruments"
    os.makedirs(outdir, exist_ok=True)
    for name, fn in CLIPS:
        path = os.path.join(outdir, name + ".wav")
        write_wav(path, normalize(fn()))
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))


main()
