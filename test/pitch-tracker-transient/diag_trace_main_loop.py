import numpy as np
import dawdreamer as daw

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

BASELINE_DSP = """
import("stdfaust.lib");
trackerHarmonics = 4;
trackerTau = 0.02;
minTrackHz = 60.0;
coarseTrackerTau = 0.003;
fastTrackerTau = 0.0015;

trackPitchHz(N, t, x) = loop ~ _
with {
    xHighpassed = fi.highpass(1, 20.0, x);
    coarseHz = an.zcr(coarseTrackerTau, xHighpassed) * ma.SR * .5;
    fastHz   = an.zcr(fastTrackerTau, xHighpassed) * ma.SR * .5;
    loop(y) = an.zcr(t, fi.lowpass(N, cutoff, xHighpassed)) * ma.SR * .5
    with {
        cutoff = max(minTrackHz, max(y, max(coarseHz * .5, fastHz * .8)));
    };
};
process(x) = x : trackPitchHz(trackerHarmonics, trackerTau);
"""

FREQSCALED_MAIN_DSP = """
import("stdfaust.lib");
trackerHarmonics = 4;
trackerTau = 0.02;
minTrackHz = 60.0;
coarseTrackerTau = 0.003;
fastTrackerTau = 0.0015;
minFloorCoeffHz = 60.0;

freqScaledPole(baseTau, freqHz) = ba.tau2pole(baseTau * minFloorCoeffHz / max(minFloorCoeffHz, freqHz));

onePoleZc(baseTau, freqHz, x) = loop ~ _
with {
    loop(prev) = ma.zc(x) * (1.0 - pole) + prev * pole
    with {
        pole = freqScaledPole(baseTau, freqHz);
    };
};

trackPitchHz(N, t, x) = loop ~ _
with {
    xHighpassed = fi.highpass(1, 20.0, x);
    loop(y) = onePoleZc(t, y, fi.lowpass(N, cutoff, xHighpassed)) * ma.SR * .5
    with {
        coarseHz = onePoleZc(coarseTrackerTau, y, xHighpassed) * ma.SR * .5;
        fastHz   = onePoleZc(fastTrackerTau, y, xHighpassed) * ma.SR * .5;
        cutoff = max(minTrackHz, max(y, max(coarseHz * .5, fastHz * .8)));
    };
};
process(x) = x : trackPitchHz(trackerHarmonics, trackerTau);
"""


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def sine_transient(n, freq_hz, attack_samples=64, amp=0.9):
    t = np.arange(n) / SAMPLE_RATE
    tone = amp * np.sin(2 * np.pi * freq_hz * t)
    env = np.ones(n)
    ramp = np.linspace(0.0, 1.0, attack_samples)
    env[:attack_samples] = ramp
    return tone * env


def render(dsp_text, name, freq_hz, dur=0.15):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = sine_transient(n, freq_hz)
    inputs = dry.reshape(1, -1)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, name)
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0]


def summarize(y, freq_hz, label):
    t35 = int(0.035 * SAMPLE_RATE)
    t100 = int(0.100 * SAMPLE_RATE)
    window = y[t35:t100]
    peak = np.max(np.abs(window))
    finite = np.all(np.isfinite(window))
    diffs = np.abs(np.diff(window))
    max_step = np.max(diffs) if len(diffs) else 0.0
    monotonic_ish = np.mean(diffs <= (0.5 * freq_hz)) if len(diffs) else 1.0
    print(f"  [{label}] {freq_hz}Hz: y@35ms={y[t35]:.1f} y@50ms={y[int(0.050*SAMPLE_RATE)]:.1f} "
          f"y@100ms={y[t100]:.1f} peak(35-100ms)={peak:.1f} finite={finite} "
          f"max_sample_step={max_step:.1f} frac_steps_small={monotonic_ish:.2f}")


def main():
    print("Main-loop y trajectory trace: baseline vs frequency-scaled main tracker")
    for freq_hz in (196.0, 880.0, 1318.5):
        y_base = render(BASELINE_DSP, "baseline", freq_hz)
        y_fs = render(FREQSCALED_MAIN_DSP, "freqscaled", freq_hz)
        summarize(y_base, freq_hz, "baseline")
        summarize(y_fs, freq_hz, "freqscaled")


if __name__ == "__main__":
    main()
