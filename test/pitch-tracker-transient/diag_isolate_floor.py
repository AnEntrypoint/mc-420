import sys
from pathlib import Path

import numpy as np

import pt_render

SAMPLE_RATE = 48000
BLOCK_SIZE = 64

DIAG_DSP = """
import("stdfaust.lib");
coarseTrackerTau = 0.003;
fastTrackerTau = 0.0015;
process(x) = xHighpassed : an.zcr(fastTrackerTau) * ma.SR * .5
with {
    xHighpassed = fi.highpass(1, 20.0, x);
};
"""


def sine_transient(n, freq_hz, attack_samples=64, amp=0.9):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, attack_samples)
    env[:attack_samples] = ramp
    return tone * env


def render_floor(freq_hz, dur=0.15):
    n = int(dur * SAMPLE_RATE)
    dry = sine_transient(n, freq_hz)
    return pt_render.render(DIAG_DSP, dry, sr=SAMPLE_RATE, block=BLOCK_SIZE)[0]


def main():
    print("Isolated fastHz floor (no main recursive lowpass loop) convergence check")
    for freq_hz in (196.0, 880.0, 1318.5):
        out = render_floor(freq_hz)
        t35 = int(0.035 * SAMPLE_RATE)
        t50 = int(0.050 * SAMPLE_RATE)
        t100 = int(0.100 * SAMPLE_RATE)
        v35 = out[t35]
        v50 = out[t50]
        v100 = out[t100]
        print(f"  {freq_hz}Hz: floor@35ms={v35:.1f}Hz floor@50ms={v50:.1f}Hz "
              f"floor@100ms={v100:.1f}Hz (true={freq_hz}Hz)")


if __name__ == "__main__":
    main()
