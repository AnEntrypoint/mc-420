#!/usr/bin/env python3
import sys
import numpy as np

JUMP_MAX_RATIO = 1.6817928
JUMP_CONFIRM_BLOCKS = 9
OCTAVE_CONFIRM_BLOCKS = 60
OCTAVE_TOLERANCE_RATIO = 1.05
SILENCE_RESET_BLOCKS = 40
BLOCK_SIZE = 64


def simulate(freq_track):
    anchor = 0.0
    candidate = 0.0
    streak = 0
    silence_blocks = 0
    outputs = []
    n_blocks = len(freq_track) // BLOCK_SIZE
    for b in range(n_blocks):
        raw = float(freq_track[(b + 1) * BLOCK_SIZE - 1])
        if raw <= 0.0:
            silence_blocks += 1
            if silence_blocks >= SILENCE_RESET_BLOCKS:
                anchor = 0.0
                candidate = 0.0
                streak = 0
        else:
            silence_blocks = 0
            fresh_onset = anchor <= 0.0
            plausible_vs_anchor = (not fresh_onset) and (raw < anchor * JUMP_MAX_RATIO and raw > anchor / JUMP_MAX_RATIO)
            if plausible_vs_anchor:
                anchor = raw
                candidate = 0.0
                streak = 0
            else:
                candidate_plausible = candidate > 0.0 and raw < candidate * JUMP_MAX_RATIO and raw > candidate / JUMP_MAX_RATIO
                if candidate_plausible:
                    streak += 1
                else:
                    candidate = raw
                    streak = 1
                octave_up = (raw / (anchor * 2.0)) if not fresh_onset else 1.0
                octave_down = (raw / (anchor * 0.5)) if not fresh_onset else 1.0
                octave_suspicious = (not fresh_onset) and (
                    (OCTAVE_TOLERANCE_RATIO > octave_up > 1.0 / OCTAVE_TOLERANCE_RATIO)
                    or (OCTAVE_TOLERANCE_RATIO > octave_down > 1.0 / OCTAVE_TOLERANCE_RATIO)
                )
                required = OCTAVE_CONFIRM_BLOCKS if octave_suspicious else JUMP_CONFIRM_BLOCKS
                if streak >= required:
                    anchor = raw
                    candidate = 0.0
                    streak = 0
        out_val = 0.0 if silence_blocks >= SILENCE_RESET_BLOCKS else anchor
        outputs.append(out_val)
    return np.array(outputs)


def main():
    path = sys.argv[1]
    ft = np.load(path)
    guarded = simulate(ft)
    prev = None
    jumps = []
    for i in range(1, len(guarded)):
        f = guarded[i]
        if f <= 0 or prev is None or prev <= 0:
            prev = f
            continue
        r = f / prev
        if r > 1.5 or r < 0.667:
            jumps.append((i, prev, f, r))
        prev = f
    print(f"{path}: {len(jumps)} jumps in GUARDED output (was raw tracker input)")
    for j in jumps[:30]:
        print(f"  block={j[0]} t={j[0]*BLOCK_SIZE/48000:.3f}s {j[1]:.2f}->{j[2]:.2f} ratio={j[3]:.3f}")


if __name__ == "__main__":
    main()
