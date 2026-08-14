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


def run_take(master_len_samples, take_len_samples, record_marker_offset,
             marker_len=400, total_extra=None):
    if total_extra is None:
        total_extra = take_len_samples * 3 + 6000
    dsp = harness.single_looper_dsp()
    grid_step = max(1.0, master_len_samples / 16.0)
    margin = int(grid_step) + 500
    n = take_len_samples + total_extra + margin + 4000

    masterPhase = (np.arange(n, dtype=np.float64) % max(1, master_len_samples)).astype(np.float32)
    masterLen = harness.const(n, float(master_len_samples))
    effSpeed = harness.const(n, 1.0)
    clearAll = harness.const(n, 0.0)
    sidechainEnv = harness.const(n, 0.0)
    recordedBeats = harness.const(n, 4.0)
    in_unused = harness.const(n, 0.0)

    arm_press_sample = 4000
    finish_reference_sample = 4000 + int(grid_step) + 200
    marker_track = marker_tone(n, finish_reference_sample + record_marker_offset, marker_len)

    rec_auto = np.zeros(n, dtype=np.float32)
    rec_auto[arm_press_sample:] = 1.0
    finish_sample = finish_reference_sample + take_len_samples
    rec_auto[finish_sample:] = 0.0

    finishreq_auto = np.zeros(n, dtype=np.float32)
    finishreq_auto[finish_sample:finish_sample + 32] = 1.0
    finishtarget_auto = np.zeros(n, dtype=np.float32)
    finishtarget_auto[finish_sample:] = float(take_len_samples)
    play_auto = np.zeros(n, dtype=np.float32)
    play_auto[finish_sample:] = 1.0

    channels = np.stack([in_unused, marker_track, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats])
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


def check_masterlen_jitter(name, true_master_len, jitter_samples_list, take_len_samples,
                            record_marker_offset, tol=None):
    """
    Same intended musical gesture, recorded as loop 1 with slightly different
    raw press-timing (simulating human ARM/FINISH imprecision on the FIRST
    take, which establishes masterLen with zero grid deferral -- by design,
    per AGENTS.md, since loop 1 must play back at its exact raw duration).
    For each jittered masterLen, a SECOND take at a fixed take_len_samples
    (a clean multiple of the "true" phrase) records the same musical gesture.
    Invariant under test: the second take's marker should land at ROUGHLY the
    SAME playback-relative position regardless of loop 1's own small timing
    jitter. dsp/loop.dsp's phrase-anchor grid unit (finishGridLen) is derived
    from masterLen itself, so a few samples of masterLen jitter necessarily
    produces a small, PROPORTIONAL shift in the snapped grid tick -- this is
    expected, not a bug (the alternative, quantizing masterLen itself too,
    is a separate, already-existing mechanism). Tolerance scales with
    take_len_samples (observed real spread is ~0.24% of take length across
    this test's own jitter_samples_list range) with a small fixed floor for
    short takes.
    """
    if tol is None:
        tol = max(8, int(take_len_samples * 0.005))
    positions = []
    for jitter in jitter_samples_list:
        master_len = true_master_len + jitter
        onsets = run_take(master_len, take_len_samples, record_marker_offset)
        if not onsets:
            print(f"[{name}] FAIL: jitter={jitter} produced no marker in playback")
            return False
        positions.append(onsets[0])

    spread = max(positions) - min(positions)
    ok = spread <= tol
    status = "PASS" if ok else "FAIL"
    print(f"[{name}] {status}: playback-relative marker positions across masterLen jitter "
          f"{jitter_samples_list} = {positions} (spread={spread}, tol={tol})")
    return ok


def main():
    results = []

    results.append(check_masterlen_jitter(
        "loop1-jitter-exact-phrase-repeat",
        true_master_len=19200, jitter_samples_list=[-40, -10, 0, 15, 45],
        take_len_samples=19200, record_marker_offset=1400,
    ))

    results.append(check_masterlen_jitter(
        "loop1-jitter-half-phrase-repeat",
        true_master_len=19200, jitter_samples_list=[-40, -10, 0, 15, 45],
        take_len_samples=9600, record_marker_offset=1400,
    ))

    results.append(check_masterlen_jitter(
        "loop1-jitter-two-phrase-repeat",
        true_master_len=19200, jitter_samples_list=[-40, -10, 0, 15, 45],
        take_len_samples=38400, record_marker_offset=1400,
    ))

    print()
    print(f"{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
