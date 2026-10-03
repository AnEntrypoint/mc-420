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
        after the base press of this case. dsp/loop.dsp's armEdge defers real
        recording start to the next fine-grid crossing (kFineGridBeats = 1/8 of
        a beat) and places the take at the grid node nearest the press, so
        every offset inside one half of a fine-grid cell must land the material
        at the same place in playback. Callers therefore keep each group of
        offsets inside a single half-cell.
    take_len_samples: raw recording duration requested via rec-hold and
        finishtarget (the performer's felt phrase length before power-of-2
        snapping upstream in apc_grid.cpp -- here fed directly since this
        harness targets dsp/loop.dsp in isolation).
    """
    if total_extra is None:
        total_extra = take_len_samples * 3 + 6000
    dsp = harness.single_looper_dsp()
    fine_grid = harness.fine_grid_samples(master_len_samples, 4.0) if master_len_samples > 0 else 0.0
    margin = int(fine_grid) * 2 + 4000 if master_len_samples > 0 else 0
    n = take_len_samples + total_extra + margin + 4000

    base_press = int(fine_grid) * 7 + 1 if master_len_samples > 0 else 4000
    if master_len_samples > 0:
        block = harness.BLOCK_SIZE
        base_press = ((base_press + block - 1) // block) * block
    arm_press_sample = base_press + arm_offset_samples

    if master_len_samples > 0:
        masterPhase = (np.arange(n, dtype=np.float64) % master_len_samples).astype(np.float32)
        masterLen = harness.const(n, float(master_len_samples))
        arm = arm_press_sample + harness.arm_sample(masterPhase[arm_press_sample:], fine_grid)
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

    channels = np.stack([in_unused, marker_track, clearAll, effSpeed, manualSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats])
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
    finish_instant_in_window = finish_sample - search_start
    return [(o - finish_instant_in_window) % period for o in onsets]


def check_case(name, master_len_samples, take_len_samples, offset_groups, tol=8):
    """
    Records the SAME intended musical gesture (marker at a fixed offset from
    the raw press) across groups of different raw press timings, each group
    confined to one HALF of a fine-grid cell.

    dsp/loop.dsp defers real recording start to the next fine-grid crossing
    (kFineGridBeats) and then places the take at whichever grid node is
    NEAREST to the raw press: presses in the first half of a cell snap back
    to the node that opens it, presses in the second half snap forward to
    the node that closes it. Both halves must therefore be internally
    jitter-free -- every press in a half lands the marker at the same
    playback sample -- and the two halves must sit exactly one grid step
    apart. That is what keeps two performers, or two devices on the same
    Link grid, agreeing on where a loop starts when they press slightly
    either side of the same beat; a quantizer that only ever snapped
    forward would strand one of them a full grid step late.
    """
    fine_grid = harness.fine_grid_samples(master_len_samples, 4.0)
    groups = []
    for offsets in offset_groups:
        positions = []
        for off in offsets:
            onsets = run_take(master_len_samples, off, take_len_samples)
            if not onsets:
                print(f"[{name}] FAIL: arm_offset={off} produced no marker in playback")
                return False
            positions.append(onsets[0])
        spread = max(positions) - min(positions)
        if spread > tol:
            print(f"[{name}] FAIL: offsets {offsets} inside one half-grid window "
                  f"landed at {positions} (spread={spread}, tol={tol})")
            return False
        groups.append(positions[0])

    if len(groups) == 2:
        gap = abs(groups[1] - groups[0])
        gap = min(gap, take_len_samples - gap)
        if abs(gap - fine_grid) > tol:
            print(f"[{name}] FAIL: the two half-grid windows sit {gap} samples apart, "
                  f"expected one fine grid step ({fine_grid:.0f}, tol={tol})")
            return False

    print(f"[{name}] PASS: half-grid windows {offset_groups} landed at {groups} "
          f"(grid={fine_grid:.0f}, tol={tol})")
    return True


def main():
    results = []

    block = harness.BLOCK_SIZE
    first_half = [0, block, 2 * block, 3 * block]
    second_half = [5 * block, 6 * block, 7 * block, 8 * block]
    halves = [first_half, second_half]

    results.append(check_case(
        "loop1-establish-raw-duration",
        master_len_samples=0, take_len_samples=9600,
        offset_groups=[[0]],
    ))

    results.append(check_case(
        "half-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=9600,
        offset_groups=halves,
    ))

    results.append(check_case(
        "full-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=19200,
        offset_groups=halves,
    ))

    results.append(check_case(
        "two-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=38400,
        offset_groups=halves,
    ))

    results.append(check_case(
        "sixteenth-grid-loose-arm-timing",
        master_len_samples=19200, take_len_samples=2400,
        offset_groups=halves,
    ))

    results.append(check_case(
        "quarter-phrase-loose-arm-timing",
        master_len_samples=19200, take_len_samples=4800,
        offset_groups=halves,
    ))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
