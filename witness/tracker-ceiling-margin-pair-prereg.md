# Pre-registration: maxTrackHz 2600 with promotion margin 0.001, and the margin-only control

Row: defect-sine-2093-subharmonic. Registered 2026-10-25, before any render of this pair. This file changes no shipped DSP.

Relation to earlier files. docs/witness/tracker-maxtrackhz-2600-prereg.md (commit 72b8db1d) registered the ceiling-only candidate, which was REJECTED on the pinned route (witness dispatch 1792927677862-3658-7ff450bdbd367275; reverted by 47d0af89). That verdict stands. This file registers the pair DawDreamer's B1 used: ceiling 1500 to 2600 plus promotion margin 0.001. Where it keeps 72b8db1d's criteria it says so; where it differs it gives the reason.

## 1. Variants

Base: effects/pitchtracker-src/pitchtracker_ac.dsp at commit 47d0af89 (the shipped text), sha256 cea5e4f00533f0364bfd7eb9f62e851029ee9a1301b4ba8566d0c5dc7f4d67e0, 18289 bytes. Base is rendered in every run.

P (the pair), made from base by three exact edits. Each target must occur exactly once; the render workflow aborts otherwise.
- E1: "maxTrackHz = 1500.0;" becomes "maxTrackHz = 2600.0;".
- E2: insert the line "promoteMargin = 0.001;" directly after "subharmDominanceMargin = 0.004;".
- E3: "(raw3 > pBase + subharmDominanceMargin)" becomes "(raw3 > pBase + promoteMargin)", and "(raw2 > pBase + subharmDominanceMargin)" becomes "(raw2 > pBase + promoteMargin)".
The demotion test keeps subharmDominanceMargin (0.004). The output clamp "rawFreq = ... : min(maxTrackHz)" moves with E1. No maxRawHz, no grid change.

B3 (margin-only control): P with E1 undone, so maxTrackHz stays 1500.0. E2 and E3 are kept.

Tau axis (the tauFor site, as in 72b8db1d): T-S is the shipped "ba.if(freqHz >= 575.0, 0.02," and T-F is the same site with 0.01. Base, P and B3 each render at T-S and T-F: six settled sets per run.

Not varied: minTrackHz, corrThresh, the coarse grid, refine spread, onset hold, demote and energy constants, energyTau.

## 2. Why these edits

- maxTrackHz read sites (codesearch regex, dispatch 1792928503256-3753-d33b42e81760ffc2): the declaration, reachable2 and reachable3 (promotion reach), and the rawFreq output clamp. Nothing else reads it.
- E3 changes only the 2x and 3x promotion comparisons. The lag set, sweep, tau, refine and demotion are unchanged, so E1 to E3 cannot re-time the sweep; the range check of 72b8db1d section 2 holds for the pair.
- The ceiling-only candidate changed E1 alone and left sine_2093 at 700.244 Hz. The margin alone (B3) failed on DawDreamer's route. The pair is therefore registered together with its control.

## 3. Corpus

- The 34 instrument WAVs in test-audio-corpus/instruments/ (classes in section 6), 48 kHz mono 16-bit, normalised in CI by tools/corpus-level/normalise-corpus.mjs --rms 0.1.
- Six sines from tools/ceiling-dedup/make_sines.py: sine_55.69, sine_110, sine_220, sine_440, sine_1000, sine_2093 (2093.005 Hz).
- 40 files per variant. No file is excluded.

## 4. Route (CI, next round; nothing is rendered in this round)

- Renderer: tools/pitchtracker-render/render_corpus.py with the pinned Faust flags -vec -fun -dfs -vs 32 -nvi -ct 0 -t 600, and g++ -O3 for the driver. 72b8db1d used -O2; this pair uses -O3 to follow the flag rule. Base, P and B3 share the flags, so the comparison is internal.
- The next round's candidate commit adds E1 to E3 and a workflow pitch-pair-render.yml, workflow_dispatch only. The workflow checks the base sha, fails unless each edit matches exactly once, and renders base, P and B3 at T-S and T-F.
- pitch-2093-render.yml carries a path trigger on the DSP file, restored by the 47d0af89 revert. The candidate commit removes it (as the 72b8db1d route did), so a candidate push runs one render, not two.
- A verify session (verify-defect-sine-2093-subharmonic) applies the judge to the settled JSON and records the judge sha256 and the witness dispatch id.

## 5. Measured targets for R1a

Reference rule (docs/witness/corpus-pitch-reference.md): a gate that scores a target uses a measured peak from the Reliable table, or records the measurement it used with the run. Filename labels are not used.

| file | target Hz | basis |
|---|---|---|
| piano_mid_C4 | 262.22 | corpus-pitch-reference.md, Reliable table |
| marimba_low_C2B2 | 65.21 | same |
| cello_low_sulC_A2 | 111.76 | same |
| trumpet_high_C6 | 1049.13 | same |
| soprano_sax_high_C6 | 1049.13 | same |
| clarinet_high_C6B6 | 1049.13 | same |
| piano_high_C7 | 2109.01 | in neither reference file; measured for this pre-reg (below) |
| flute_trill_high_C7 | 2151.51 | in neither reference file; measured for this pre-reg (below) |

piano_high_C7: node tools/pitch-reference/submultiple.mjs --wav test-audio-corpus/instruments/piano_high_C7.wav --seconds 6 gives global peak 2109.01 Hz (40-4000 Hz, 0.5 percent grid, the reference method). The local ladder at 2109.76 Hz reads H2 -40.0 dB and H3 -69.0 dB against the peak, so the fundamental is clear. tools/pitch-reference/comb.mjs does not certify it (its pick is 1061.21 Hz with H3 to H8 missing). The disagreement between the two methods is recorded here, not resolved. The 349.05 Hz figure quoted for this file is the base tracker reading in the 7ae889a5 verdict (349.05 to 2095.10 Hz), not a file peak, and is not a target.

flute_trill_high_C7: the same command with --seconds 4.5 gives global peak 2151.51 Hz. The file is a two-note trill (C7 to Db7, about 2093 to 2217 Hz). Its local peaks at 2143.70, 2151.04 and 2154.62 Hz lie within 3 dB of one another, so the peak is a smear across about 2140 to 2160 Hz, not a single line. comb.mjs excludes it as a phrase. R1a reads the target as written; NR (section 7) holds the file strictly to base, so R1a cannot admit a move on its own.

Classification change: 72b8db1d judged piano_high_C7 and flute_trill_high_C7 as no-peak files. This pair judges them by the targets above.

## 6. The 34 files

R1a (8): piano_mid_C4, marimba_low_C2B2, cello_low_sulC_A2, trumpet_high_C6, soprano_sax_high_C6, clarinet_high_C6B6, piano_high_C7, flute_trill_high_C7.

NR (6, strict): piano_low_A1, marimba_mid_C5B5, vibraphone_mid_C5B5, oboe_mid_C5B5, cymbal_inharmonic, flute_trill_high_C7 (flute also sits in R1a).

R1b (26): every corpus file not in R1a. Five of them are NR files: piano_low_A1, marimba_mid_C5B5, vibraphone_mid_C5B5, oboe_mid_C5B5, cymbal_inharmonic. The other 21 are violin_low_sulG_G3B3, violin_high_sulE_C7E7, trumpet_low_A3, bassoon_low_C2B2, vocal_female_vibrato, vocal_male_baritone_scale, flute_high_C7, xylophone_roll_AM_C6B6, marimba_roll_AM_C5B5, bells_glock_run_C6B6, xylophone_run_C7B7, glockenspiel_high_C7, crotale_high_C7, tamtam_inharmonic, balloon_pop_transient, guitar_pluck_C4B4, tuba_run_C2B2, vocal_soprano_range_PD, vocal_tenor_range_PD, vocal_tenor_operatic_PD, vocal_melody_twinkle_CC0.

Sines: S1 uses sine_2093; R5 uses sine_55.69, sine_110, sine_220, sine_440, sine_1000; C-RANGE uses sine_55.69, sine_110, sine_220, sine_440.

## 7. Criteria

Notation: c(x) = settled_hz of variant x; v(x) = voiced_blocks of variant x; cents(a,b) = 1200 log2(a/b); T = target from section 5.

Rule fields: every criterion reads the pin fields, settled_hz and voiced_blocks, as the render judge defines them after commit 0e3d6f6c (a block pinned at the 60.0 Hz floor or at 192.0 Hz is not voiced). The raw fields (settled_raw_hz, voiced_raw_blocks) are written to the JSON and reported beside each verdict; no criterion reads them.

Null rule: c is null when a file has no voiced block. cents is undefined when either side is null. Two nulls are equal (unchanged). A null against a value fails every equality or cents clause, except R1a, where a null base makes the bound infinite.

- S1 (sine_2093; P at T-S and at T-F): |cents(c(P), 2093.005)| <= 50 and v(P) > 0. Pin fields: settled_hz, voiced_blocks.
- R1a (the 8 files of section 5; P): |cents(c(P), T)| <= |cents(c(base), T)| + 5. A move toward T is not a regression. Pin field: settled_hz.
- R1b (the 26 files of section 6; P vs base): |cents(c(P), c(base))| <= 5, except that the 3:1 family passes if v(base) > 0, v(P) > 0, |cents(c(P), c(base)) - 1901.955| <= 50 and |cents(c(P), 2093.005)| <= 50. The 3:1 exception is not available to NR files. Pin fields: settled_hz, voiced_blocks.
- R2 (all 34 corpus files; P vs base): v(P) >= v(base). Pin field: voiced_blocks.
- R4 (cello_low_sulC_A2 and vocal_male_baritone_scale; P): 0 < c(P) < 1000. Pin field: settled_hz.
- R5 (sine_55.69, sine_110, sine_220, sine_440, sine_1000; P vs base): both null, or both non-null with |cents(c(P), c(base))| <= 1. Pin field: settled_hz.
- C-RANGE (sine_55.69, sine_110, sine_220, sine_440; P vs base): c and v identical, exact, no tolerance. Null equals null. Pin fields: settled_hz, voiced_blocks.
- NR (the 6 files of section 6; P vs base): |cents(c(P), c(base))| <= 5 and v(P) >= v(base). No 3:1 exception. Pin fields: settled_hz, voiced_blocks.

R5 keeps 72b8db1d's sine set and tolerance. The null rule is new here: 72b8db1d's verdict flagged sine_55.69 as unvoiced in both variants and left that case undefined. It is defined now, before any render.

## 8. Verdict and handling

- P is ADMIT only if S1 (at T-S and at T-F), R1a, R1b, R2, R4, R5, C-RANGE and NR all pass on one CI run.
- Attribution: P is admitted only if B3 fails S1 at T-S or at T-F, which shows the ceiling is needed. If B3 passes every criterion, nothing is admitted from this pair; the margin-only change needs its own pre-registration before any edit.
- Any failure: REJECTED. The failing criterion, its numbers, the run id and the judge sha256 go on the row. Nothing is retuned: no threshold, variant, tau, corpus member, class or window changes in the same window. A retune needs a new pre-registration and a new candidate.
- The row stays open on REJECTED. It resolves only on ADMIT with CI green on the shipped sha and a verify witness. A rejected candidate that reaches main is returned by an append revert.
- This file changes no DSP. The candidate commit belongs to the next round.

## 9. Disclosed differences and routes

1. piano_high_C7 and flute_trill_high_C7 are absent from both reference files; their targets are measured here (section 5).
2. The comb method and the Goertzel ladder disagree on piano_high_C7; both are recorded.
3. The tau axis is the tauFor site, as in 72b8db1d. DawDreamer's energyTau axis is not this pair's axis and is not scored here.
4. The driver is compiled with g++ -O3, not -O2 (section 4).
5. Four comb-certified files (bassoon_low_C2B2, violin_low_sulG_G3B3, trumpet_low_A3, guitar_pluck_C4B4) stay in R1b. Their comb f0 values are not added to R1a, because that would change the registered list.
6. DawDreamer's B1 and B3 (tools/sine-clamp/PREREG.md, Amendment 1, in /config/workspace/DawDreamer) are not the pinned CI route; their numbers do not close the row under its backend rule.
7. The promotion margin is named promoteMargin, as in the DawDreamer PREREG. In the shipped file the two promotion comparisons use subharmDominanceMargin; E3 is the only change to them.

## 10. Reproduce

- sha256sum effects/pitchtracker-src/pitchtracker_ac.dsp gives cea5e4f00533f0364bfd7eb9f62e851029ee9a1301b4ba8566d0c5dc7f4d67e0.
- node tools/pitch-reference/submultiple.mjs --wav test-audio-corpus/instruments/piano_high_C7.wav --seconds 6
- node tools/pitch-reference/submultiple.mjs --wav test-audio-corpus/instruments/flute_trill_high_C7.wav --seconds 4.5
- node tools/pitch-reference/comb.mjs --only piano_high_C7
