import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

SR = harness.SAMPLE_RATE


def marker_tone(n, marker_sample, marker_len, freq=880.0, amp=0.9):
    x = np.zeros(n, dtype=np.float32)
    end = min(n, marker_sample + marker_len)
    if marker_sample < n:
        seg_n = end - marker_sample
        t = np.arange(seg_n) / SR
        tone = np.sin(2 * np.pi * freq * t + np.pi / 2.0)
        decay = np.exp(-t * (6.0 / (marker_len / SR)))
        x[marker_sample:end] = (tone * decay * amp).astype(np.float32)
    return x


def find_all_onsets(x, thresh_frac=0.3, min_gap=200):
    env = np.abs(x)
    if env.max() < 1e-4:
        return []
    above = env > thresh_frac * env.max()
    edges = np.where(above[1:] & ~above[:-1])[0] + 1
    if above[0]:
        edges = np.concatenate(([0], edges))
    onsets = []
    for e in edges:
        if not onsets or e - onsets[-1] >= min_gap:
            onsets.append(int(e))
    return onsets


def run_take(master_len_samples, arm_offset_samples, take_len_samples,
             record_marker_offset, marker_len=400, total_extra=None):
    """
    master_len_samples: established masterLen (0 for the very first take).
    arm_offset_samples: how far (in samples) the performer's raw press lands
        after a reference instant -- simulates loose press timing within a
        grid cell; the grid-deferral mechanism (dsp/loop.dsp armEdge) absorbs
        this before real recording starts.
    take_len_samples: raw recording duration requested via rec-hold and
        finishtarget (the performer's felt phrase length before power-of-2
        snapping upstream in apc_grid.cpp -- here fed directly since this
        harness targets dsp/loop.dsp in isolation).
    record_marker_offset: sample offset (from the raw press) where the
        performer's intended downbeat tone is actually played -- fixed
        across arm_offset variations to model "the same musical gesture,
        pressed slightly early or late".
    """
    if total_extra is None:
        total_extra = take_len_samples * 3 + 6000
    dsp = harness.single_looper_dsp()
    grid_step = max(1.0, master_len_samples / 16.0) if master_len_samples > 0 else 0
    margin = int(grid_step) + 500 if master_len_samples > 0 else 0
    n = take_len_samples + total_extra + margin + 4000

    masterPhase = (np.arange(n, dtype=np.float64) % max(1, master_len_samples)).astype(np.float32) \
        if master_len_samples > 0 else np.zeros(n, dtype=np.float32)
    masterLen = harness.const(n, float(master_len_samples))
    effSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    in_unused = harness.const(n, 0.0)

    arm_press_sample = 4000 + arm_offset_samples
    finish_reference_sample = 4000 + int(grid_step) + 200 if master_len_samples > 0 else arm_press_sample
    marker_track = marker_tone(n, finish_reference_sample + record_marker_offset, marker_len)

    rec_auto = np.zeros(n, dtype=np.float32)
    rec_auto[arm_press_sample:] = 1.0
    finish_sample = max(finish_reference_sample, arm_press_sample) + take_len_samples
    rec_auto[finish_sample:] = 0.0

    finishreq_auto = np.zeros(n, dtype=np.float32)
    finishreq_auto[finish_sample:finish_sample + 32] = 1.0
    finishtarget_auto = np.zeros(n, dtype=np.float32)
    finishtarget_auto[finish_sample:] = float(take_len_samples)
    play_auto = np.zeros(n, dtype=np.float32)
    play_auto[finish_sample:] = 1.0

    channels = np.stack([in_unused, marker_track, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv])
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
    playback = out[finish_sample:]
    onsets = find_all_onsets(playback)
    return onsets


def check_case(name, master_len_samples, take_len_samples, record_marker_offset,
               arm_offsets, tol=8):
    """
    Records the SAME intended musical gesture (marker at a fixed offset from
    the raw press) across several different raw press timings within one
    grid cell -- the loose, imprecise-but-close-to-the-beat presses a real
    performer produces. The goal invariant: the quantizer's chosen loop
    start/end must not let this press-timing jitter change where the
    downbeat lands in playback -- all variants must land the marker at the
    SAME playback-relative sample, within a small tolerance.
    """
    positions = []
    for off in arm_offsets:
        onsets = run_take(master_len_samples, off, take_len_samples, record_marker_offset)
        if not onsets:
            print(f"[{name}] FAIL: arm_offset={off} produced no marker in playback")
            return False
        positions.append(onsets[0])

    spread = max(positions) - min(positions)
    ok = spread <= tol
    status = "PASS" if ok else "FAIL"
    print(f"[{name}] {status}: playback-relative marker positions across arm offsets "
          f"{arm_offsets} = {positions} (spread={spread}, tol={tol})")
    return ok


def main():
    results = []

    results.append(check_case(
        "loop1-establish-raw-duration",
        master_len_samples=0, take_len_samples=9600, record_marker_offset=0,
        arm_offsets=[0],
    ))

    results.append(check_case(
        "half-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=9600, record_marker_offset=1400,
        arm_offsets=[0, 20, 40, 60, 80],
    ))

    results.append(check_case(
        "full-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=19200, record_marker_offset=1400,
        arm_offsets=[0, 20, 40, 60, 80],
    ))

    results.append(check_case(
        "two-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=38400, record_marker_offset=1400,
        arm_offsets=[0, 20, 40, 60, 80],
    ))

    results.append(check_case(
        "sixteenth-grid-loose-arm-timing",
        master_len_samples=19200, take_len_samples=2400, record_marker_offset=1400,
        arm_offsets=[0, 20, 40, 60, 80],
    ))

    results.append(check_case(
        "quarter-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=4800, record_marker_offset=1400,
        arm_offsets=[0, 20, 40, 60, 80],
    ))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
