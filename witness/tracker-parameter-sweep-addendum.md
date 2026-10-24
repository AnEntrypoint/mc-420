# tracker-parameter-sweep: pre-registered addendum

Thresholds S1-S4 from the row are unchanged. This addendum fixes the measurement conditions before any render, so the sweep cannot be read against earlier numbers taken under different conditions.

## Input

- The level-normalised corpus from `tools/corpus-level/normalise-corpus.mjs` at commit `4e38a47d`: rms 0.1 per file, peak cap 0.9, harness gain 1.0.
- The corpus gain `0.00707945784384138` is not used. At that gain 27 of 34 files sit at or below the `energyReady` floor, so the gate measures the gain, not the tracker.
- Results are level-normalised. They are not compared with corpus-gain numbers.

## Scored set

The 10 scoreable files in `docs/witness/corpus-pitch-reference.md`:

piano_mid_C4, marimba_low_C2B2, cello_low_sulC_A2, trumpet_high_C6, soprano_sax_high_C6, clarinet_high_C6B6, bassoon_low_C2B2, violin_low_sulG_G3B3, trumpet_low_A3, guitar_pluck_C4B4.

- Each target is that file's measured peak in the reference table, never the filename label.
- Phrase files and files with no certified peak are reported but not scored.
- Sines are a separate column and sit outside S1 and S2.

## Baseline

The shipped configuration, measured in the same run. The control readings quoted in the row (+0.1, -8.1, -1.1 c) are not a baseline and are re-measured.

## Octave error

A settled value more than 600 c from its certified peak.

## Best combination

For each axis, the value with the lowest median |cents| among single-axis configurations that pass S2 and S3. The per-axis winners are combined, rendered once, and ranked with the rest.

## Mapping decisions (items 6-8, from the sweep agent's read of the code, recorded before render)

6. corrAtLagTau axis. The axis value v replaces the tiering in tauFor (pitchtracker_ac.dsp:21) with one uniform energy tau for every band, applied to the coarse pick through pickFundamental (line 48). The baseline keeps the shipped tiering: 0.01 below 575 Hz, 0.02 at or above. corrAtLagVar (lines 35-44, used by refineFreq, corrPeakAt and corrRawAt) keeps its constant 0.01 in every configuration. The axis therefore changes the coarse pick only, and results must be labelled that way.

7. confidenceGate axis. The axis value g sets only the detector output gate, confident = finalConfidence >= g (line 194). corrThresh stays 0.85 and still gates peak picking (lines 49, 146, 162, 163). The baseline is g = 0.85. The literal confidenceGate in multitranspose.dsp is out of scope, because the harness renders pitchtracker_ac.dsp alone.

8. S3 reading. S3 holds only when both checks pass: |reading| <= 25 c against the certified peak, and for cello_low_sulC_A2, trumpet_low_A3 and piano_mid_C4, |candidate cents| minus |baseline cents| <= 25 c. This is the stricter of the row's two readings.

9. Refine tau axis. A second axis. The axis value r sets corrAtLagVar energy tau (line 39, the constant energyTau = 0.01), which feeds refineFreq, corrPeakAt and corrRawAt. The coarse tau keeps the shipped tiering (tauFor). Grid: 0.005, 0.01 (baseline), 0.02, 0.04. Results are reported per path, so the coarse-pick and refine-path tau results can be read apart. Cross-check: the 0.02 refine value is the same change as the lowfreq A/B that closed defect-lowfreq-corr-ripple (98ed9068, NO-IMPROVEMENT on the level run). A sweep result for refine tau 0.02 must be read against that closed verdict and must not re-claim it.

## Render hold

No Kaggle render starts until the full mc-420 sha of the commit carrying this addendum is sent to the sweep agent.

## Provenance

Items 6-9 are the sweep agent's mapping decisions D1-D4, committed in DawDreamer as 69fb2a5a (not pushed). They were fixed before any render. S1-S4 are unchanged. Rows: tracker-parameter-sweep. Related open row: lowfreq-verdict-flag-recheck, because the closed tau verdict was built without pinned Faust flags.
