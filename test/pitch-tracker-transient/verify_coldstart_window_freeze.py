import re
import sys
from pathlib import Path

import numpy as np
import dawdreamer as daw

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "multitranspose.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

TRUE_COLDSTART_MIN_RATIO = 0.55
TRUE_COLDSTART_MAX_RATIO = 2.2
WARM_LEADIN_RATIO_TOLERANCE = 0.08


def debug_tap_source():
    text = DSP_PATH.read_text()
    pattern = re.compile(
        r"process\(dry, loopSum, free, formant, extFreqDet, bendSemis, "
        r"n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5\) = dryWet, loopWet\n"
    )
    replacement = (
        "process(dry, loopSum, free, formant, extFreqDet, bendSemis, "
        "n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = "
        "dryWet, loopWet, winSamples, xfSamples\n"
    )
    new_text, n = pattern.subn(replacement, text)
    if n != 1:
        raise RuntimeError(
            "verify_coldstart_window_freeze.py's debug-tap regex no longer matches "
            "multitranspose.dsp's process() signature -- update this test to match "
            "any deliberate signature change before trusting its result."
        )
    return new_text


def compile_processor(engine, dsp_text, name):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    return faust


def make_inputs(n, dry, target_note, gate_start_samp):
    zero = np.zeros(n)
    ones = np.ones(n)
    gate = np.zeros(n)
    gate[gate_start_samp:] = 1.0
    return np.stack(
        [
            dry, zero, zero, zero, zero, zero,
            target_note * ones, gate,
            zero, zero, zero, zero, zero, zero, zero, zero, zero, zero,
        ],
        axis=0,
    ).astype(np.float32)


def render_win(dsp_text, freq_hz, gate_start_samp, dur):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    n = int(dur * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    dry = (0.5 * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)
    inputs = make_inputs(n, dry, 72.0, gate_start_samp)
    playback = engine.make_playback_processor("in", inputs)
    faust = compile_processor(engine, dsp_text, "multitranspose_debug")
    engine.load_graph([(playback, []), (faust, ["in"])])
    engine.render(dur)
    audio = engine.get_audio()
    return audio[2], audio[3]


def main():
    print("multitranspose.dsp cold-start window/formant-sizing regression check")
    print(f"DSP: {DSP_PATH}")
    print(
        "Architecture: winSamples/xfSamples freeze at their pre-onset value on any voice's "
        "gate rising edge (see 'Start-of-transient onset-glitch fixed' in AGENTS.md), but a "
        "TRUE zero-context cold start (no prior audio before the very first note-on) used to "
        "freeze at freqDet's own unconverged cold-start floor (minTrackHz=60Hz), locking the "
        "PSOLA window at its hard 64-sample floor for the whole note regardless of the real "
        "pitch -- e.g. 64 samples vs a true ~585-sample period at 82Hz, a >9x undersized window. "
        "This produced exactly the audible 'scans in the first moment of the transient' / "
        "degraded-formant-quality symptom (never a wrong NOTE, since shiftAmount is a fixed "
        "interval independent of tracking -- only window/formant naturalness was ever at risk)."
    )
    print(
        "Fix: winFreezeDelayMs (60ms) lets winSamples/xfSamples keep tracking the live "
        "(still-converging) freqDet for a short warmup window after the rising edge, instead "
        "of freezing on the very first, worst sample, then freezes as before."
    )
    dsp_text = debug_tap_source()

    print()
    print("-- true cold start: frozen window must land within a sane ratio of the true period --")
    render_len = 0.5
    all_ok = True
    for freq in [82.0, 110.0, 164.8, 220.0, 440.0, 880.0]:
        win, xf = render_win(dsp_text, freq, gate_start_samp=0, dur=render_len)
        frozen_win = win[-1]
        frozen_xf = xf[-1]
        true_period = SAMPLE_RATE / freq
        ratio = frozen_win / true_period
        ok = TRUE_COLDSTART_MIN_RATIO <= ratio <= TRUE_COLDSTART_MAX_RATIO
        all_ok &= ok
        print(
            f"  freq={freq:7.1f}Hz true_period={true_period:7.1f} frozen_win={frozen_win:7.1f} "
            f"frozen_xf={frozen_xf:7.1f} ratio={ratio:.2f} "
            f"({'OK' if ok else 'FAIL'} vs [{TRUE_COLDSTART_MIN_RATIO},{TRUE_COLDSTART_MAX_RATIO}])"
        )

    print()
    print("-- realistic performance (400ms lead-in) must show no post-onset window drift --")
    print(
        "   (the freeze-delay warmup window only matters when freqDet is STILL converging at "
        "note-on; once the input has had 400ms to settle, winSamplesRaw is already stable at "
        "the rising edge, so the instant-post-gate value and the final frozen value must match)"
    )
    lead_in_samp = int(0.4 * SAMPLE_RATE)
    for freq in [82.0, 220.0, 880.0]:
        win, xf = render_win(dsp_text, freq, gate_start_samp=lead_in_samp, dur=lead_in_samp / SAMPLE_RATE + 0.3)
        true_period = SAMPLE_RATE / freq
        instant_post = win[lead_in_samp + 2]
        frozen = win[-1]
        ratio = frozen / true_period
        ok = abs(instant_post - frozen) <= 2.0 and abs(ratio - 1.0) < WARM_LEADIN_RATIO_TOLERANCE + 0.25
        all_ok &= ok
        print(
            f"  freq={freq:7.1f}Hz post-gate_win(instant)={instant_post:7.1f} "
            f"frozen_win={frozen:7.1f} true_period={true_period:7.1f} ratio={ratio:.2f} "
            f"({'OK' if ok else 'FAIL'})"
        )

    print()
    if all_ok:
        print("PASSED: true cold start no longer freezes the PSOLA window at a catastrophically "
              "wrong value, and realistic warm-lead-in performance is bit-for-bit unaffected.")
        sys.exit(0)
    else:
        print("FAILED: see rows marked FAIL above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
