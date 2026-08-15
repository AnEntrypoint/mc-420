import os
import sys
import json
import numpy as np
import dawdreamer as daw

from corpus_common import load_to_48k_mono_f32, measure_freq_windowed, cents_diff

HERE = os.path.dirname(os.path.abspath(__file__))
DSP_PATH = os.path.abspath(os.path.join(HERE, "..", "effects", "home", "faust", "multitranspose.dsp"))

SR = 48000
BS = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]

ROOT_NOTE = 60.0
LOCK_SHIFT_SEMITONES = 7.0
LEAD_IN_S = 0.15
TAIL_S = 1.0
MEASURE_START_S = LEAD_IN_S + 0.3
MEASURE_END_S = LEAD_IN_S + 0.9

REAL_FILES = {
    "Guitar.mf.sulE.E2.aiff": 80.616,
    "Xylophone.rosewood.mf.C6.aiff": 1053.841,
    "Crotale.C7.ff.aiff": 2128.390,
    "Crotale.C8.ff.aiff": 4266.999,
    "Tuba.mf.C2.aiff": 66.087,
    "Bassoon.mf.Bb1.aiff": 58.778,
    "Bass.arco.sulC.mf.C1.aiff": 32.537,
    "Vocal.m2.long_straight_a.aiff": 125.157,
    "Vocal.f7.long_forte_a.aiff": 262.296,
    "Vocal.f6.long_trill_a.aiff": 264.468,
}


def make_engine():
    engine = daw.RenderEngine(SR, BS)
    faust = engine.make_faust_processor("faust")
    faust.compile_flags = COMPILE_FLAGS
    ok = faust.set_dsp(DSP_PATH)
    assert ok, "set_dsp failed"
    ok = faust.compile()
    assert ok, "compile failed"
    assert faust.get_num_input_channels() == 17
    assert faust.get_num_output_channels() == 2
    return engine, faust


def run_lock_test(filename, true_hz, target_note=None, shift_semitones=LOCK_SHIFT_SEMITONES):
    path = os.path.join(HERE, filename)
    dry = load_to_48k_mono_f32(path)
    dur = len(dry) / SR + LEAD_IN_S + TAIL_S
    n = int(dur * SR)

    engine, faust = make_engine()

    data = np.zeros((17, n), dtype=np.float32)
    lead_n = int(LEAD_IN_S * SR)
    end_n = min(n, lead_n + len(dry))
    data[0, lead_n:end_n] = dry[: end_n - lead_n]
    data[4, :] = float(true_hz)

    if target_note is None:
        target_note = ROOT_NOTE + shift_semitones
    data[5, :] = float(target_note)
    data[6, lead_n:] = 1.0

    playback = engine.make_playback_processor("playback", data)
    graph = [(playback, []), (faust, ["playback"])]
    assert engine.load_graph(graph)
    engine.render(dur)
    audio = engine.get_audio()
    wet = audio[0]

    expected_hz = float(true_hz) * (2.0 ** ((target_note - ROOT_NOTE) / 12.0))

    lo = max(20.0, expected_hz * 0.55)
    hi = min(SR / 2.0 - 100.0, expected_hz * 1.8)
    measured_hz = measure_freq_windowed(
        wet, SR, MEASURE_START_S, MEASURE_END_S, min_hz=lo, max_hz=hi
    )
    cents = cents_diff(measured_hz, expected_hz)

    return dict(
        file=filename,
        true_hz=true_hz,
        target_note=target_note,
        shift_semitones=target_note - ROOT_NOTE,
        expected_hz=expected_hz,
        measured_hz=measured_hz,
        cents=cents,
    )


def main():
    results = []
    for fname, true_hz in REAL_FILES.items():
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            print("SKIP (missing file):", fname)
            continue
        r = run_lock_test(fname, true_hz)
        results.append(r)
        print(
            "%-32s true=%9.3fHz target=+%dst expected=%9.3fHz measured=%9.3fHz  %+8.2f cents"
            % (fname, r["true_hz"], r["shift_semitones"], r["expected_hz"], r["measured_hz"], r["cents"])
        )

    with open(os.path.join(HERE, "_real_audio_cross_verify_results.json"), "w") as f:
        json.dump(results, f, indent=2)

    worst = max(results, key=lambda r: abs(r["cents"]))
    print("\nworst case: %s at %.2f cents" % (worst["file"], worst["cents"]))

    n_fail = sum(1 for r in results if abs(r["cents"]) > 60.0)
    print("files tested: %d, files over 60 cents: %d" % (len(results), n_fail))
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
