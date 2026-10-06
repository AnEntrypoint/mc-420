import sys
from pathlib import Path

import numpy as np

import pt_render

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "pitchtracker-src" / "pitchtracker_ac.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
SEGMENT_S = 3.4
FREQS = (110.0, 220.0, 440.0)

DEMOTE_POLE_LINE = "demotePole = ba.tau2pole(demoteTau);\n"
DUTY_LINE = "    demoteDuty = demoteNow : *(1.0-demotePole) : + ~ *(demotePole);\n"
PROMOTE_LINE = "    promotion = subharmonicPromote(xh, w, coarseFreq, demoteNow);\n"
REFINED_DEMOTE = "               ba.if(demoteNow, refinedH, refined1)));\n"
TAKE_NEW = "    takeNew = (demoteNow > 0.5) | (demoteDuty <= 0.5);\n"

CONFIRM_CONSTS = "confirmPeriods = %s;\nconfirmFloorSamples = 128.0;\noctaveSemitone = 0.06;\n"
CONFIRM_TAKE = ("    candDelta = abs(refinedNow - heldFreq);\n"
                "    candFar = candDelta > max(0.5, octaveSemitone * heldFreq);\n"
                "    confirmSamples = max(confirmFloorSamples, "
                "confirmPeriods * ma.SR / max(60.0, heldFreq));\n"
                "    countFar(prev) = min(confirmSamples, prev + 1.0);\n"
                "    farRun = ba.if(candFar, countFar, 0.0) ~ _;\n"
                "    takeNew = ((1.0 - candFar) | (farRun >= confirmSamples)) & "
                "((demoteNow > 0.5) | (demoteDuty <= 0.5));\n")


def schmitt(text, tau, hi, lo):
    src = text.replace(DEMOTE_POLE_LINE, DEMOTE_POLE_LINE
                       + "demoteFastTau = %s;\ndemoteFastPole = ba.tau2pole(demoteFastTau);\n" % tau)
    src = src.replace(DUTY_LINE, DUTY_LINE
                      + "    demoteFast = demoteNow : *(1.0-demoteFastPole) : + ~ *(demoteFastPole);\n"
                      + "    demoteSel = demoteFast > %s;\n" % hi
                      + "    clearSel = demoteFast < %s;\n" % lo)
    src = src.replace(PROMOTE_LINE,
                      "    promotion = subharmonicPromote(xh, w, coarseFreq, demoteSel);\n")
    src = src.replace(REFINED_DEMOTE, "               ba.if(demoteSel, refinedH, refined1)));\n")
    src = src.replace(TAKE_NEW,
                      "    takeNew = demoteSel | (clearSel & (demoteDuty <= 0.5));\n")
    return src


def confirm(text, periods):
    return (text.replace(DEMOTE_POLE_LINE, DEMOTE_POLE_LINE + CONFIRM_CONSTS % periods)
                .replace(TAKE_NEW, CONFIRM_TAKE))


def variant_dsp(name):
    src = DSP_PATH.read_text(encoding="utf-8")
    for line in (DEMOTE_POLE_LINE, DUTY_LINE, PROMOTE_LINE, REFINED_DEMOTE, TAKE_NEW):
        if src.count(line) != 1:
            raise RuntimeError("anchor not found once: %r (%d)" % (line, src.count(line)))
    if name == "shipped":
        return src
    if name.startswith("confirm"):
        periods = "0.75"
        for p in name.split("_")[1:]:
            if p.startswith("p"):
                periods = p[1:]
        return confirm(src, periods)
    if name.startswith("schmitt"):
        parts = name.split("_")
        tau, hi, lo = "0.02", "0.8", "0.2"
        for p in parts[1:]:
            if p.startswith("t"):
                tau = p[1:]
            elif p.startswith("h"):
                hi = p[1:]
            elif p.startswith("l"):
                lo = p[1:]
        return schmitt(src, tau, hi, lo)
    raise RuntimeError("unknown variant %r" % name)


def timbre_shift_tone(n, f0_hz, f0_start=1.0, f0_end=0.05, h2_start=0.3, h2_end=1.0,
                      ramp_start=0.2, ramp_end=3.0):
    t = np.arange(n) / SAMPLE_RATE
    frac = np.clip((t - ramp_start) / (ramp_end - ramp_start), 0.0, 1.0)
    a0 = f0_start + (f0_end - f0_start) * frac
    a2 = h2_start + (h2_end - h2_start) * frac
    sig = a0 * np.sin(2 * np.pi * f0_hz * t) + a2 * np.sin(2 * np.pi * f0_hz * 2.0 * t)
    sig = sig / np.max(np.abs(sig)) * 0.7
    attack = int(0.01 * SAMPLE_RATE)
    env = np.ones(n)
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return sig * env


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "shipped"
    seg = int(SEGMENT_S * SAMPLE_RATE)
    sig = np.concatenate([timbre_shift_tone(seg, f) for f in FREQS]).astype(np.float32)
    out = pt_render.render(variant_dsp(name), sig, sr=SAMPLE_RATE, block=BLOCK_SIZE)[0]

    gate = int(0.2 * SAMPLE_RATE)
    print("variant %s" % name)
    worst_all = 0.0
    for k, f0 in enumerate(FREQS):
        base = k * seg
        cells = []
        s = int(0.10 * SAMPLE_RATE)
        while s + gate <= seg:
            mean_hz = float(out[base + s:base + s + gate].mean())
            cents = 1200.0 * np.log2(mean_hz / f0)
            worst_all = max(worst_all, abs(cents))
            cells.append(f"t{(s + gate / 2) / SAMPLE_RATE:.1f}={mean_hz:6.1f}Hz({cents:+.0f}c)")
            s += gate
        print(f"  f0={f0:6.1f}Hz: " + " ".join(cells))
    print("  worst=%.1fc" % worst_all)
    return 0


if __name__ == "__main__":
    sys.exit(main())
