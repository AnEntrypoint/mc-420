import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

SR = harness.SAMPLE_RATE
kMasterBpm = 120.0
kMasterBeats = 4.0
kTakeBeats = 4.0
kMarkerPeriod = 4000
kToleranceRatio = 0.004


def impulse_train(n, period):
    x = np.zeros(n, dtype=np.float32)
    x[::period] = 1.0
    return x


def arm_sample(master_phase, master_len, recorded_beats):
    fine = 0.125 * (master_len / recorded_beats)
    fine_idx = np.floor(master_phase / fine).astype(np.int64)
    wrapped = np.zeros(len(master_phase), dtype=bool)
    wrapped[1:] = fine_idx[1:] != fine_idx[:-1]
    return int(np.argmax(wrapped))


def peak_spacings(seg, min_separation):
    above = np.flatnonzero(np.abs(seg) > 0.3)
    if len(above) < 4:
        return []
    peaks = []
    last = -min_separation
    for i in above:
        if i - last < min_separation:
            if abs(seg[i]) > abs(seg[last]):
                peaks[-1] = i
                last = i
            continue
        peaks.append(i)
        last = i
    return [int(b) - int(a) for a, b in zip(peaks, peaks[1:])]


def run_take(eff_speed):
    master_len = int(round(kMasterBeats * (60.0 / kMasterBpm) * SR))
    one_beat = master_len / kMasterBeats
    mesh_bpm = kMasterBpm * eff_speed
    take_real = int(round(kTakeBeats * (60.0 / mesh_bpm) * SR))
    finish_target = int(round(kTakeBeats * one_beat / eff_speed))

    dsp = harness.single_looper_dsp()
    n_hint = int(5 * master_len / eff_speed) + 4 * master_len
    master_phase = (np.arange(n_hint, dtype=np.float64) * eff_speed) % master_len
    arm = arm_sample(master_phase, master_len, kMasterBeats)
    finish_sample = arm + take_real
    record_end = arm + finish_target
    n = record_end + int(2.5 * master_len / eff_speed) + 8000

    masterPhase = ((np.arange(n, dtype=np.float64) * eff_speed) % master_len).astype(np.float32)
    masterLen = harness.const(n, float(master_len))
    effSpeed = harness.const(n, float(eff_speed))
    manualSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    recordedBeats = harness.const(n, kMasterBeats)
    in_unused = harness.const(n, 0.0)
    input_sig = impulse_train(n, kMarkerPeriod)

    rec_auto = np.zeros(n, dtype=np.float32)
    rec_auto[:finish_sample] = 1.0
    finishreq_auto = np.zeros(n, dtype=np.float32)
    finishreq_auto[finish_sample:finish_sample + 32] = 1.0
    finishtarget_auto = np.zeros(n, dtype=np.float32)
    finishtarget_auto[finish_sample:] = float(finish_target)
    play_auto = np.zeros(n, dtype=np.float32)
    play_auto[finish_sample:] = 1.0

    channels = np.stack([in_unused, input_sig, clearAll, effSpeed, manualSpeed, masterPhase,
                         masterLen, sidechainEnv, recordedBeats])
    audio, _, _ = harness.render_take(
        dsp, channels, n,
        params={"vol": 1.0, "sidechainsrc": 0.0},
        automation={
            "rec": rec_auto, "finishreq": finishreq_auto,
            "finishtarget": finishtarget_auto, "play": play_auto,
            "latencybias": np.zeros(n, dtype=np.float32),
        },
    )
    out = audio[0]
    playback = out[record_end:record_end + int(2.0 * master_len / eff_speed)]
    spacings = peak_spacings(playback, kMarkerPeriod // 2)
    median = float(np.median(spacings)) if spacings else 0.0
    widest = float(max(spacings)) if spacings else 0.0
    return {
        "master_len": master_len,
        "take_real": take_real,
        "finish_target": finish_target,
        "arm": arm,
        "record_end": record_end,
        "peaks": len(spacings) + 1 if spacings else 0,
        "median": median,
        "widest": widest,
        "ratio": median / kMarkerPeriod if median else 0.0,
    }


def check(mesh_bpm):
    eff_speed = mesh_bpm / kMasterBpm
    r = run_take(eff_speed)
    off = abs(r["ratio"] - 1.0)
    tight = 0.0 < r["widest"] <= 2.0 * kMarkerPeriod
    ok = r["peaks"] >= 8 and off <= kToleranceRatio and tight
    print(f"  mesh {mesh_bpm:.2f} BPM (effSpeed {eff_speed:.4f}) finish_target={r['finish_target']} "
          f"take_real={r['take_real']} peaks={r['peaks']} spacing={r['median']:.1f} "
          f"ratio={r['ratio']:.4f} widest={r['widest']:.0f} -> {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    print("A take recorded while the mesh runs at another tempo must come back at the speed it was performed.")
    print(f"  master {kMasterBpm} BPM, take {kTakeBeats} beats, markers every {kMarkerPeriod} samples")

    results = [check(kMasterBpm), check(124.0), check(90.0)]
    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
