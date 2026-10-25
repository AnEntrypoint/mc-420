# Pre-registration: sub-block voiced count, 2026-10-25 (row render-voiced-count-block-end-sampling)

Registered 2026-10-25, before any change to `tools/pitchtracker-render/render_corpus.py` and before any count under the corrected rule is read. Session drain-render-voiced-count-prereg. This document registers a rule and its criteria. It computes no count, changes no code and runs no render.

## 1. Problem

`settle()` in `tools/pitchtracker-render/render_corpus.py` reads block-end samples only (`ends = y[BLOCK - 1::BLOCK]`). A block counts as voiced only when its block-end sample is live and positive, so voicing that starts and stops inside a block is invisible. Evidence from the row: vocal_melody_twinkle_CC0 is voiced for 2534 samples in block 1, and vocal_tenor_operatic_PD has 692 voiced samples in block 20, yet both read zero at block ends (DawDreamer witness 1792927368440-3639-353d63aaeec7e718).

## 2. Corrected rule

Constants as at HEAD: SR 48000, BLOCK 64, SETTLE_S 1.0, PINNED_HZ (60.0, 192.0), PIN_TOL_HZ 0.001.

- Blocks: the file gives n = floor(len(y) / BLOCK) full blocks. Block k holds samples k*BLOCK through k*BLOCK + BLOCK - 1. A trailing partial block is dropped, as the block-end read already does.
- Time: sample i sits at (i + 1) / SR, the convention settle() uses for block ends.
- Live: (i + 1) / SR >= SETTLE_S.
- Pinned: |y_i - p| <= PIN_TOL_HZ for some p in PINNED_HZ.
- Voiced block: block k is voiced when at least one of its samples is live and has y_i > 0 (raw count), or is live, has y_i > 0 and is not pinned (pin count).

The block-end gate is the single-sample case of this gate. Block k's last sample sits at time (k*BLOCK + BLOCK) / SR, the time settle() already assigns to the block end. So every block the block-end read counts is also counted by the corrected rule, on the same basis.

The pin test is per sample. A block with one pinned sample and one unpinned positive sample is counted by the pin count. Default chosen: the per-sample image of the block-end gate. A per-block pin exclusion was rejected because it would drop a block that holds unpinned voicing.

settled_hz and settled_raw_hz are not redefined here. They stay on block-end reads. A registration that moves a settled value must name it.

## 3. Fields

Unchanged, names and rules:

- voiced_raw_blocks: block-end, no pin exclusion. The raw block-end rule.
- voiced_blocks: block-end, pin exclusion (commit 0e3d6f6c). The pin rule.

New, registered here, written as new keys in each settled-<variant>.json row:

- voiced_subblock_raw_blocks: corrected rule, no pin exclusion.
- voiced_subblock_blocks: corrected rule, pin exclusion per sample.

Derived, for reporting only: subblock_only_raw_blocks = voiced_subblock_raw_blocks - voiced_raw_blocks, and subblock_only_blocks = voiced_subblock_blocks - voiced_blocks.

No existing key is renamed, removed or redefined. Any check that reads voiced_blocks by name keeps reading the block-end field.

## 4. Files covered

- Corpus: the 34 files of test-audio-corpus/instruments (manifest.json, 48 kHz mono 16-bit). All 34 are counted.
- Sines: the 5 sines of tools/ceiling-dedup/make_sines.py, sine_55.69, sine_110, sine_220, sine_440 and sine_1000 (sha256 checked by that script). Counted and reported; no criterion in section 5 judges them (K4).
- Phrase exclusion, as before: the 10 phrase files registered in .gm/prd/gate-level-normalisation.yml (restated G1) are excluded from scoring: bells_glock_run_C6B6, flute_trill_high_C7, marimba_mid_C5B5, tuba_run_C2B2, vocal_male_baritone_scale, vocal_melody_twinkle_CC0, vocal_soprano_range_PD, vocal_tenor_range_PD, xylophone_run_C7B7, vibraphone_mid_C5B5. The scored population is the 24 remaining corpus files.
- PHRASE_FILES in render_corpus.py (2 names) excludes reference peaks only, through read_reference(). It changes no voiced count and is not the scoring exclusion of this document.
- Route: the corrected counts come from the same y that settle() receives, computed in-process before the block-end slice. No existing artifact holds per-sample output: the traces keep block-end samples, and the per-sample output is written to a temporary directory and removed. The counts therefore need a render through the pinned route after the measurement change is committed, in a later round. This document runs none.

## 5. Criteria

- K1 identity, every file, both bases: voiced_subblock_raw_blocks >= voiced_raw_blocks and voiced_subblock_blocks >= voiced_blocks. A violation is an implementation defect; its counts are not reported.
- K2 evidence case, base variant, both bases: vocal_melody_twinkle_CC0 and vocal_tenor_operatic_PD each have both corrected counts >= 1. A zero on the pinned route means the DawDreamer witness does not reproduce there; the row stays open and the discrepancy is filed as a new row before any further count.
- K3 scored counts: for the 24 scored files, each corrected count per file and its sum are reported for every variant. This document registers no threshold on them. A threshold needs a new registration that names it before its count is read.
- K4 sines: the 5 sines are reported per field and variant. Nothing is judged.
- K5 closure: the row closes only when K1 holds on every file and both bases, the four counts for the 34 corpus files and the 5 sines are computed by a CI run on a pushed sha, and that run's sha and dispatch id are recorded on the row. Closure registers no verdict on any corrected threshold.

No corrected-rule figure carries a pass or fail verdict under this document.

## 6. Existing verdicts: unchanged, not recomputed

Each stays on the rule it was registered and judged on. None is recomputed under the corrected rule until a new registration names it.

- G1, restated (.gm/prd/gate-level-normalisation.yml): at least 22 of the 24 non-phrase files publish a nonzero settled value. Raw block-end rule, from the external DawDreamer gate heclgang/level-normalised-gate v1. Its 24-file set is the scored population of section 4.
- P5 pin-rule figures: the non-phrase voiced count over 32 files, base 31 raw to 29 under the pin rule, coarse-gate 31 to 29, corr-tau-0.02 30 to 29 (docs/DECISIONS.md, "Verdict: pinned-value voicing gate, 2026-10-25"); and the 24-file counts in .gm/prd/gate-level-normalised-pin-rule-reregister.yml (raw 23 of 24 and pin 21 of 24 at tau 0.01; raw 22 of 24 and pin 21 of 24 at tau 0.02). Block-end, raw and pin rules as recorded.
- Sine rejection: defect-sine-2093-subharmonic Verdict v2, REJECTED (docs/DECISIONS.md, "Verdict v2: 2093 Hz register candidate"), read on the pin-rule block-end fields voiced_blocks and settled_hz; Verdict v1 read the raw fields. Also docs/witness/tracker-maxtrackhz-2600-prereg.md, which reads voiced_blocks and settled_hz under the pin rule.
- Any other verdict that reads voiced_blocks or voiced_raw_blocks keeps its basis.

## 7. Sequence

1. This file, alone: the registration.
2. A later round: the measurement change in render_corpus.py adds the four keys inside settle(), committed after this file lands and before any render.
3. A CI render of the pinned route on the pushed sha, then the K1 to K5 check in a separate verify session.
4. The row closes only under K5. Every step commits or records by explicit path.
