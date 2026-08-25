import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

SR = harness.SAMPLE_RATE


def tone_burst(n, start, length, freq, amp=0.9):
    x = np.zeros(n, dtype=np.float32)
    end = min(n, start + length)
    if start < n:
        seg_n = end - start
        t = np.arange(seg_n) / SR
        tone = np.sin(2 * np.pi * freq * t)
        env = np.ones(seg_n)
        ramp = min(200, seg_n // 4)
        if ramp > 0:
            env[:ramp] = np.linspace(0, 1, ramp)
            env[-ramp:] = np.linspace(1, 0, ramp)
        x[start:end] = (tone * env * amp).astype(np.float32)
    return x


def measure_tone_energy(seg, freq, sr=SR):
    if len(seg) < 256:
        return 0.0
    windowed = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
    idx = np.argmin(np.abs(freqs - freq))
    band = spec[max(0, idx - 3):idx + 4]
    return float(np.sum(band ** 2))


def run_multi_marker_take(master_len_samples, take_len_samples, marker_freqs):
    """
    Records a take spanning the WHOLE take_len_samples with N distinct tone
    markers spaced evenly across it (not just one marker near the start).
    dsp/loop.dsp's wlenNext (gridMultiple * anchorGridLenNow) snaps the
    take's effective wrap length to the nearest power-of-2-beat grid unit,
    which can shrink OR extend the raw recorded duration -- this test's
    invariant is that every marker recorded within the raw take survives
    into playback somewhere in the loop, i.e. the snap changes WHERE content
    repeats, never drops content that was actually captured to the ring.
    """
    dsp = harness.single_looper_dsp()
    total_extra = take_len_samples * 3 + 6000
    n = take_len_samples + total_extra + master_len_samples * 2 + 8000

    arm_press_sample = 4000
    next_downbeat = ((arm_press_sample // master_len_samples) + 1) * master_len_samples
    finish_sample = next_downbeat + take_len_samples

    masterPhase = (np.arange(n, dtype=np.float64) % master_len_samples).astype(np.float32)
    masterLen = harness.const(n, float(master_len_samples))
    effSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    recordedBeats = harness.const(n, 4.0)
    in_unused = harness.const(n, 0.0)

    n_markers = len(marker_freqs)
    marker_len = 400
    marker_positions = [
        next_downbeat + int((i + 0.5) * take_len_samples / n_markers)
        for i in range(n_markers)
    ]
    input_sig = np.zeros(n, dtype=np.float32)
    for pos, freq in zip(marker_positions, marker_freqs):
        input_sig += tone_burst(n, pos, marker_len, freq)

    rec_auto = np.zeros(n, dtype=np.float32)
    rec_auto[arm_press_sample:] = 1.0
    rec_auto[finish_sample:] = 0.0

    finishreq_auto = np.zeros(n, dtype=np.float32)
    finishreq_auto[finish_sample:finish_sample + 32] = 1.0
    finishtarget_auto = np.zeros(n, dtype=np.float32)
    finishtarget_auto[finish_sample:] = float(take_len_samples)
    play_auto = np.zeros(n, dtype=np.float32)
    play_auto[finish_sample:] = 1.0

    channels = np.stack([in_unused, input_sig, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats])
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
    playback = out[finish_sample:finish_sample + take_len_samples * 3]
    return playback


def check_content_integrity(name, master_len_samples, take_len_samples, marker_freqs):
    playback = run_multi_marker_take(master_len_samples, take_len_samples, marker_freqs)
    win = 2048
    step = 512
    energies = {f: [] for f in marker_freqs}
    for start in range(0, len(playback) - win, step):
        seg = playback[start:start + win]
        for f in marker_freqs:
            energies[f].append(measure_tone_energy(seg, f))
    max_energies = {f: max(e) if e else 0.0 for f, e in energies.items()}
    overall_max = max(max_energies.values()) if max_energies else 0.0
    present = {f: (e > 0.02 * overall_max if overall_max > 0 else False) for f, e in max_energies.items()}
    ok = all(present.values())
    status = "PASS" if ok else "FAIL"
    detail = ", ".join(f"{f}Hz={'present' if present[f] else 'MISSING'}({max_energies[f]:.2f})" for f in marker_freqs)
    print(f"[{name}] {status}: {detail}")
    return ok


def main():
    print("Every marker recorded across a full take must survive into playback, regardless of wlenNext grid-snap.")
    beat = 12000
    master_len = beat * 4

    results = []
    results.append(check_content_integrity(
        "exact-4beat-take-4-markers",
        master_len_samples=master_len, take_len_samples=master_len,
        marker_freqs=[220.0, 660.0, 1100.0, 1760.0],
    ))
    results.append(check_content_integrity(
        "shrink-snap-6beat-take-to-4-3-markers",
        master_len_samples=master_len, take_len_samples=int(beat * 5.9),
        marker_freqs=[220.0, 880.0, 1760.0],
    ))
    results.append(check_content_integrity(
        "extend-snap-3beat-take-to-4-3-markers",
        master_len_samples=master_len, take_len_samples=int(beat * 3.1),
        marker_freqs=[220.0, 880.0, 1760.0],
    ))
    results.append(check_content_integrity(
        "multi-masterlen-8beat-take-4-markers",
        master_len_samples=master_len, take_len_samples=master_len * 2,
        marker_freqs=[220.0, 660.0, 1100.0, 1760.0],
    ))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
