import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pitch_measure import measure_freq

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

ROOT_NOTE = 60.0
MIC_LEAD_IN_MS = 400.0
WORST_STEADY_CENTS_LIMIT = 30.0
LOW_FREQ_RATIO_MIN = 0.55


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def vocal_like_tone(n, freq_hz, amp=0.5):
    t = np.arange(n) / SAMPLE_RATE
    out = np.sin(2 * np.pi * freq_hz * t)
    out += 0.3 * np.sin(2 * np.pi * 2 * freq_hz * t)
    out += 0.12 * np.sin(2 * np.pi * 3 * freq_hz * t)
    out /= np.max(np.abs(out)) + 1e-9
    env = np.ones(n)
    attack = 256
    env[:attack] = np.linspace(0.0, 1.0, attack)
    return amp * out * env


def make_inputs(n, dry, formant, target_note, gate):
    zero = np.zeros(n)
    ones = np.ones(n)
    return np.stack(
        [
            dry, zero, zero, formant * ones, zero,
            target_note * ones, gate,
            zero, zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    )


def render(dsp_text, freq_hz, semitone_shift, formant, dur=None):
    # Real performance: the mic signal is already sustaining well before the key is
    # pressed, so freqDet has converged by the time heldDetNote latches at attackEdge.
    # A key gated on with zero prior audio context risks BOTH a stale/cold-start
    # heldDetNote latch (wrong shiftAmount, a real note error under absolute pitch-lock)
    # AND the separate, disclosed, pre-existing cold-start freeze gap in
    # windowForFormant's own smoother (see AGENTS.md, "winFrozenStep/xfFrozenStep
    # true-cold-start freeze gap") -- the lead-in here specifically avoids the former.
    if dur is None:
        dur = MIC_LEAD_IN_MS / 1000 + 0.4
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    dry = vocal_like_tone(n, freq_hz)
    gate_start = int(MIC_LEAD_IN_MS / 1000 * SAMPLE_RATE)
    gate = np.zeros(n)
    gate[gate_start:] = 1.0
    target_note = ROOT_NOTE + semitone_shift
    inputs = make_inputs(n, dry, formant, target_note, gate)
    faust = compile_processor(engine, dsp_text, "multitranspose")
    playback = engine.make_playback_processor("in", inputs)
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    return engine.get_audio()[0], gate_start


def cents_error(measured_hz, target_hz):
    if measured_hz is None or np.isnan(measured_hz) or measured_hz <= 0 or target_hz <= 0:
        return float("nan")
    return 1200.0 * np.log2(measured_hz / target_hz)


def low_freq_energy_ratio(sig, sr, cutoff_hz):
    spec = np.abs(np.fft.rfft(sig * np.hanning(len(sig))))
    freqs = np.fft.rfftfreq(len(sig), 1.0 / sr)
    total = float(np.sum(spec ** 2)) + 1e-12
    low = float(np.sum(spec[freqs < cutoff_hz] ** 2))
    return low / total


def check_downward_lock(text, source_hz, semitone_shift, formant):
    target_note = ROOT_NOTE + semitone_shift
    expected_hz = midi_to_hz(target_note)
    audio, gate_start = render(text, source_hz, semitone_shift, formant)

    win = max(512, int(3.0 * SAMPLE_RATE / expected_hz))
    tail = audio[-win * 3:]
    measured = measure_freq(tail, SAMPLE_RATE, min_hz=max(20.0, expected_hz * 0.5), max_hz=expected_hz * 2.0)
    steady_c = cents_error(measured, expected_hz)

    ratio = low_freq_energy_ratio(tail, SAMPLE_RATE, expected_hz * 1.5)
    finite = bool(np.all(np.isfinite(audio)))
    peak = float(np.max(np.abs(audio)))
    return expected_hz, steady_c, ratio, finite, peak


def main():
    # DIAGNOSTIC, not a hard CI gate. Under the current absolute-pitch-lock
    # architecture, expected_hz is now the target KEY's absolute pitch
    # (midi_to_hz(ROOT_NOTE + semitone_shift)), not source_hz*2^(shift/12) --
    # steady-state accuracy here now depends on heldDetNote (freqDet latched at
    # attackEdge) being correct, unlike the prior interval-harmonizer design where
    # shiftAmount had no tracker dependency at all. A separate, pre-existing,
    # architecture-independent limitation remains reproducible here too: xpose's
    # own 2-tap crossfaded-delay shifter develops a real, audible crossfade-wrap-rate
    # artifact at EXTREME downward shift ratios (2+ octaves down) combined with a
    # formant-skewed window -- large negative semitone shifts produce a large `i`
    # per-sample delay-index step (i = 1 - pow(2, s/12)), which wraps `d` against `w`
    # fast enough to become itself an audible tone (lowFreqRatio stays high in these
    # cases -- the true fundamental is still the dominant spectral energy; it is
    # measure_freq's own autocorrelation that gets pulled onto the wrap-rate tone).
    # Do not tighten this into a hard gate without first reducing the wrap-rate
    # artifact itself, and do not consider a `steady_c`-only reading trustworthy at
    # 2+ octaves down with nonzero formant without cross-checking lowFreqRatio too.
    print("Voice-as-hard-dance-bass diagnostic: lock a vocal-like harmonic input down")
    print("1-3 octaves, sweep formant, report lock accuracy (against the absolute target")
    print("key pitch) and bass-register spectral dominance.")
    text = DSP_PATH.read_text()

    cases = [
        (220.0, -12.0, 0.0),
        (220.0, -24.0, 0.0),
        (330.0, -24.0, 0.0),
        (220.0, -24.0, -3.0),
        (220.0, -24.0, 3.0),
        (330.0, -27.0, -3.0),
    ]
    ok_count = 0
    for source_hz, semitone_shift, formant in cases:
        expected_hz, steady_c, ratio, finite, peak = check_downward_lock(text, source_hz, semitone_shift, formant)
        ok = (abs(steady_c) < WORST_STEADY_CENTS_LIMIT and ratio >= LOW_FREQ_RATIO_MIN
              and finite and peak < 2.0)
        ok_count += 1 if ok else 0
        print(f"  src={source_hz:6.1f}Hz shift={semitone_shift:+.1f}st -> expected={expected_hz:6.1f}Hz: "
              f"steady={steady_c:+7.1f}c lowFreqRatio={ratio:.3f} peak={peak:.3f} finite={finite} "
              f"({'OK' if ok else 'NOTABLE'})")

    print()
    print(f"{ok_count}/{len(cases)} cases within the tight ({WORST_STEADY_CENTS_LIMIT:.0f}c) tuning bar.")
    print("Notable cases above may reflect either heldDetNote tracking error (a real")
    print("concern under absolute pitch-lock, unlike the prior interval-harmonizer design)")
    print("or the shifter's own extreme-ratio crossfade-wrap artifact (see module")
    print("docstring above) -- cross-check lowFreqRatio before attributing to either.")


if __name__ == "__main__":
    main()
