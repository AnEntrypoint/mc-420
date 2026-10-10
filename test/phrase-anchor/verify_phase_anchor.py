import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness

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


def seed_master_phase_at_first_finish(masterPhase, masterLen, n, finish_sample, take_len_samples):
    established_len = max(1, take_len_samples)
    post = np.arange(n - finish_sample, dtype=np.float64) % established_len
    masterPhase[finish_sample:] = post.astype(np.float32)
    masterLen[finish_sample:] = float(established_len)


def run_take(master_len_samples, arm_offset_samples, take_len_samples,
             marker_len=400, total_extra=None):
    """
    master_len_samples: established masterLen (0 for the very first take).
    arm_offset_samples: how far (in samples) the performer's raw press lands
        after the base press of this case. dsp/loop.dsp starts recording on the
        press itself and latches the read anchor at the raw master phase of that
        press, so the material plays back at the master-cycle phase it was
        captured at: a press N samples later puts the marker N samples later in
        the loop, for every N, and callers check exactly that.
    take_len_samples: raw recording duration requested via rec-hold and
        finishtarget (the performer's felt phrase length before power-of-2
        snapping upstream in apc_grid.cpp -- here fed directly since this
        harness targets dsp/loop.dsp in isolation).
    """
    if total_extra is None:
        total_extra = take_len_samples * 3 + 6000
    dsp = harness.single_looper_dsp()
    one_beat = master_len_samples / 4.0 if master_len_samples > 0 else 0.0
    margin = int(one_beat * 0.25) + 4000 if master_len_samples > 0 else 0
    n = take_len_samples + total_extra + margin + 4000

    base_press = int(one_beat * 0.875) + 1 if master_len_samples > 0 else 4000
    if master_len_samples > 0:
        block = harness.BLOCK_SIZE
        base_press = ((base_press + block - 1) // block) * block
    arm_press_sample = base_press + arm_offset_samples

    if master_len_samples > 0:
        masterPhase = (np.arange(n, dtype=np.float64) % master_len_samples).astype(np.float32)
        masterLen = harness.const(n, float(master_len_samples))
        arm = arm_press_sample
    else:
        arm = arm_press_sample
        masterPhase = np.zeros(n, dtype=np.float32)
        masterLen = np.zeros(n, dtype=np.float32)
    finish_sample = arm + take_len_samples
    if master_len_samples == 0:
        seed_master_phase_at_first_finish(masterPhase, masterLen, n, finish_sample, take_len_samples)
    effSpeed = harness.const(n, 1.0)
    manualSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    recordedBeats = harness.const(n, 4.0)
    in_unused = harness.const(n, 0.0)
    foldNow = harness.const(n, 0.0)
    take_middle_marker_sample = arm + take_len_samples // 2
    marker_track = marker_tone(n, take_middle_marker_sample, marker_len)

    rec_auto = np.zeros(n, dtype=np.float32)
    rec_auto[arm_press_sample:] = 1.0
    rec_auto[finish_sample:] = 0.0

    finishreq_auto = np.zeros(n, dtype=np.float32)
    finishreq_auto[finish_sample:finish_sample + 32] = 1.0
    finishtarget_auto = np.zeros(n, dtype=np.float32)
    finishtarget_auto[finish_sample:] = float(take_len_samples)
    play_auto = np.zeros(n, dtype=np.float32)
    play_auto[finish_sample:] = 1.0

    channels = np.stack([in_unused, marker_track, clearAll, effSpeed, manualSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats, foldNow])
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
    search_start = max(0, finish_sample - master_len_samples - 4000)
    playback = out[search_start:]
    onsets = find_all_onsets(playback)
    if len(onsets) < 2:
        return onsets
    period = onsets[1] - onsets[0]
    if period <= 0:
        return onsets
    return [(o + search_start) % period for o in onsets]


def check_case(name, master_len_samples, take_len_samples, offsets, tol=8):
    """
    Records the SAME intended musical gesture (marker at a fixed offset from
    the raw press) at several raw press timings.

    dsp/loop.dsp records from the raw press onward and anchors the take at the
    raw master phase of that press, with no grid snap: a press N samples later
    captures the material N samples later in the master cycle and therefore
    plays it back N samples later in the loop, for every N. So the circular
    distance between two cases' marker positions must equal the distance
    between their presses -- that is what keeps two performers, or two devices
    on the same Link grid, hearing each take where it was played instead of
    displaced onto a grid node.
    """
    base_offset = offsets[0]
    positions = []
    periods = []
    for off in offsets:
        onsets = run_take(master_len_samples, off, take_len_samples)
        if len(onsets) < 2:
            print(f"[{name}] FAIL: arm_offset={off} produced no repeating marker in playback")
            return False
        positions.append(onsets[0])
        periods.append(onsets[1] - onsets[0])

    period = periods[0]
    for off, per in zip(offsets, periods):
        if abs(per - period) > tol:
            print(f"[{name}] FAIL: arm_offset={off} looped every {per} samples, "
                  f"expected {period} (tol={tol})")
            return False

    base_position = positions[0]
    for off, pos in zip(offsets, positions):
        want = (off - base_offset) % period
        got = (pos - base_position) % period
        err = abs(got - want)
        err = min(err, period - err)
        if err > tol:
            print(f"[{name}] FAIL: arm_offset={off} landed the marker {got} samples past "
                  f"arm_offset={base_offset}, expected {want} (period={period}, tol={tol})")
            return False

    print(f"[{name}] PASS: press offsets {offsets} tracked the raw press at {positions} "
          f"(period={period}, tol={tol})")
    return True


def main():
    results = []

    block = harness.BLOCK_SIZE
    loose_timing = [0, block, 2 * block, 3 * block, 5 * block, 6 * block, 7 * block, 8 * block]

    results.append(check_case(
        "loop1-establish-raw-duration",
        master_len_samples=0, take_len_samples=9600,
        offsets=[0, block, 2 * block],
    ))

    results.append(check_case(
        "half-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=9600,
        offsets=loose_timing,
    ))

    results.append(check_case(
        "full-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=19200,
        offsets=loose_timing,
    ))

    results.append(check_case(
        "two-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=38400,
        offsets=loose_timing,
    ))

    results.append(check_case(
        "sixteenth-grid-loose-arm-timing",
        master_len_samples=19200, take_len_samples=2400,
        offsets=loose_timing,
    ))

    results.append(check_case(
        "quarter-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=4800,
        offsets=loose_timing,
    ))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
