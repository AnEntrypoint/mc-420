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


def run_take_with_preboundary_marker(master_len_samples, rec_start_offset_in_phrase, take_len_samples):
    """
    Two DISTINCT tones: a low tone marks the pre-boundary content (what was
    recorded between the raw mid-phrase press and the nearest coarse
    boundary), a high tone marks true phrase-boundary content. dsp/loop.dsp
    now NEVER discards captured audio -- the phrase-anchor snap only shifts
    the loop's start/end phase to the nearest grid tick (recordStartPhaseOffset),
    it never trims content out of the ring. So pre-boundary content is
    expected to remain audible (folded into the loop, not deleted) --
    matching the explicit requirement that the musician's actual recorded
    timing/mental phrasing is never discarded, only the loop's playback
    window is aligned to the nearest musically-sensible boundary.
    """
    dsp = harness.single_looper_dsp()
    total_extra = take_len_samples * 3 + 6000
    n = take_len_samples + total_extra + master_len_samples + 8000

    masterPhase = (np.arange(n, dtype=np.float64) % master_len_samples).astype(np.float32)
    masterLen = harness.const(n, float(master_len_samples))
    effSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    recordedBeats = harness.const(n, 4.0)
    in_unused = harness.const(n, 0.0)

    first_boundary_after = ((4000 // master_len_samples) + 1) * master_len_samples
    arm_press_sample = first_boundary_after + rec_start_offset_in_phrase
    finish_sample = arm_press_sample + take_len_samples

    beat = master_len_samples / 4.0
    take_len_beats = take_len_samples / beat
    beat_bucket_eps = 0.001
    if take_len_beats > 16.0 + beat_bucket_eps:
        anchor_grid_beats = 16.0
    elif take_len_beats > 8.0 + beat_bucket_eps:
        anchor_grid_beats = 8.0
    elif take_len_beats > 4.0 + beat_bucket_eps:
        anchor_grid_beats = 4.0
    elif take_len_beats > 2.0 + beat_bucket_eps:
        anchor_grid_beats = 2.0
    else:
        anchor_grid_beats = 1.0
    anchor_grid_len = anchor_grid_beats * beat

    # armMasterPhase is masterPhase sampled at the (grid-deferred) armEdge
    # instant. The DSP snaps it to the NEAREST anchor-grid multiple
    # (round, not ceiling) -- armGridSnap in dsp/loop.dsp. Reproduce that
    # exact rounding here so the boundary we mark matches what the DSP
    # will actually anchor to.
    arm_master_phase = arm_press_sample % master_len_samples
    arm_grid_snap = round(arm_master_phase / anchor_grid_len) * anchor_grid_len
    arm_phase_bias = arm_master_phase - arm_grid_snap
    next_boundary_after_press = arm_press_sample - arm_phase_bias
    if next_boundary_after_press < arm_press_sample:
        next_boundary_after_press += anchor_grid_len
    preboundary_len = max(0, int(next_boundary_after_press - arm_press_sample))
    # HIGH tone (1760Hz, a clearly different pitch) plays from that true
    # boundary onward, for the rest of the take.
    input_sig = np.zeros(n, dtype=np.float32)
    if preboundary_len > 0:
        input_sig += tone_burst(n, arm_press_sample, min(preboundary_len, take_len_samples), 220.0)
    post_boundary_start = arm_press_sample + preboundary_len
    post_boundary_len = max(0, finish_sample - post_boundary_start)
    if post_boundary_len > 0:
        input_sig += tone_burst(n, post_boundary_start, post_boundary_len, 1760.0)

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
    return playback, preboundary_len, take_len_samples


def measure_tone_energy(seg, freq, sr=SR):
    if len(seg) < 256:
        return 0.0
    windowed = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
    idx = np.argmin(np.abs(freqs - freq))
    band = spec[max(0, idx - 3):idx + 4]
    return float(np.sum(band ** 2))


def check_case(name, master_len_samples, rec_start_offset_in_phrase, take_len_samples):
    playback, preboundary_len, take_len = run_take_with_preboundary_marker(
        master_len_samples, rec_start_offset_in_phrase, take_len_samples)
    win = 2048
    step = 512
    low_energies = []
    high_energies = []
    for start in range(0, len(playback) - win, step):
        seg = playback[start:start + win]
        low_energies.append(measure_tone_energy(seg, 220.0))
        high_energies.append(measure_tone_energy(seg, 1760.0))
    low_max = max(low_energies) if low_energies else 0.0
    high_max = max(high_energies) if high_energies else 0.0
    preboundary_present = preboundary_len > 0
    low_audible = low_max > 0.01 * high_max if high_max > 0 else low_max > 1e-6
    ok = (not preboundary_present) or low_audible
    status = "PASS" if ok else "FAIL"
    print(f"[{name}] {status}: preboundary_len={preboundary_len} take_len={take_len} "
          f"low(220Hz)_max_energy={low_max:.4f} high(1760Hz)_max_energy={high_max:.4f} "
          f"preboundary_content_audible_in_playback={low_audible} "
          f"(expected True -- content must never be discarded)")
    return ok


def main():
    print("Pre-boundary-recorded content must remain audible on playback, never discarded.")
    beat = 12000
    master_len = beat * 4

    results = []
    results.append(check_case("half-phrase-mid-start-2phrase-take",
               master_len_samples=master_len, rec_start_offset_in_phrase=beat * 2,
               take_len_samples=master_len * 2))

    results.append(check_case("1beat-mid-start-4beat-take",
               master_len_samples=master_len, rec_start_offset_in_phrase=beat,
               take_len_samples=master_len))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
