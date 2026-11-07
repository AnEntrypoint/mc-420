# ADR-034 peer-present hardware witness - pre-registration BEFORE the run

**NOT RUN. This is a pre-registration only. Nothing here is executed until the
owner explicitly approves a quiet Pi device window.** Devices remain fully
frozen: no Pi ssh, no UDP 4445/4446 polls, no 20813 status reads, no MIDI
injection, no tcp/9401, no flash, no restart, no power cycle, no hot-deploy.
This plan is a document; no code, config, firmware image or PRD row was
changed to produce it. It serves the OPEN row
`.gm/prd/adr034-peer-present-hardware-witness.yml`, whose acceptance text is
quoted verbatim in the contract below. The pass thresholds, the negative
control and the pre-registration hash are fixed NOW, before any window; no
threshold is lowered, widened or reinterpreted after results.

## Pre-registration hash

PRE-REGISTRATION HASH: e6d22c2c4d8380e9aa2e2b242cf6681c9b718a3a687522066984bb90ed41ecb6

The hash is sha256 of the byte range from the line `CONTRACT-BEGIN` through
the line `CONTRACT-END` inclusive, computed as:

`sed -n '/^CONTRACT-BEGIN$/,/^CONTRACT-END$/p' test/hardware/adr034-peer-present-preregistration.md | sha256sum`

Only that block is pinned. Any edit to the harness, the thresholds or the
negative control inside it invalidates the hash and requires a NEW
pre-registration and a new owner-approved window. Repo convention for this
hash is the one used by the gate-silence and clear-reset preregistrations
(a sha256 pinned before results, e.g.
`.gm/witness-out/item1-corrected-gate-witness-20261106.txt`).
The commit sha that lands this plan is recorded in the window witness when
the owner opens the window; it is not claimed here.

CONTRACT-BEGIN

Row: adr034-peer-present-hardware-witness (OPEN).
Acceptance, verbatim from the row: "A fresh pre-registered quiet-window run
with link.synced=true and link.peers>=1 BEFORE, DURING and AFTER the first
take, in which impose_target_samples equals last_take_arm_sample minus
master_len_samples within 4096 samples for both a boot-first and a post-clear
first take, the peer's phrase/phase matches the imposed origin, xruns stay
flat and latency_bias_samples stays within 16 samples of baseline. A FAIL is
a FAIL; no threshold lowered after results."

Harness, fixed now:
  1. `node test/hardware/verify-two-device-sync.js 192.168.137.132 600000`
     must PASS before the take sequence (peer retention >=95% post-acquisition,
     bpm spread <=0.05, |phase_err_beats| <=0.03, eff_speed spread <=0.005,
     telemetry gaps <=10%). Post-acquisition is t > +60 s from cold boot.
  2. `node test/hardware/verify-clear-reset-first-take.js 192.168.137.132 1250 corrected`
     is the ONLY take sequence. The `corrected` gate is mandatory; the default
     `original` gate contains the known mis-specified R3-cleared-wlen rule.
  3. `node test/hardware/verify-adr034-impose-target.js <harness-output-file>`
     judges the fresh output (7 rules: two ADR034 observations, both
     WITHIN_TOLERANCE, no NOT_PUBLISHED, no OUTSIDE_TOLERANCE, no failed
     harness rules, harness ALL PASS, corrected gate used).
  4. esp-side 20813 status read of beat/phase/quantum for the adopted origin,
     captured once before and once after the first take. esp holds all its
     device polls during the window. START and END markers go to esp.
  5. `node test/hardware/verify-peer-present-latency.js 192.168.137.132`
     supplies the before/during/after bias and rt samples; it requires
     link.synced=true and link.peers>=1 at its start.

Pass thresholds, fixed now (ALL must hold):
  - link.synced=true and link.peers>=1 in EVERY sample of BEFORE, DURING and
    AFTER, for BOTH the boot-first and the post-clear first take. Any
    peers=0 or synced=false sample is a FAIL, not a partial result.
  - sample_clock.impose_target_samples published (> 0) for both takes, with
    |impose_target_samples - (last_take_arm_sample - master_len_samples)|
    <= 4096 samples for each take.
  - verify-adr034-impose-target.js exits 0 (judge PASS).
  - peer phrase/phase matches the imposed origin: esp 20813 beat/phase read
    before vs after the creation impose must agree with press-minus-L within
    |phase_err_beats| <= 0.03, bpm spread <= 0.05, eff_speed spread <= 0.005.
  - xruns flat against the pre-window baseline; latency_bias_samples and
    alsa_roundtrip_samples within 16 samples of baseline.
  - All R1-R6 corrected-gate rules PASS, including the nine device-owned
    control-state rules of R3. loopers.wraplen[0] is REPORTED ONLY.
  - A CLEAR_ALL sent to restore the empty state is recorded as a
    precondition deviation with the telemetry that justified it; the run is
    then not described as a clean run of the registered sequence.
  - Judge by the HOP-LEVEL MEDIAN, not a whole-segment estimate. A capture
    whose segment RMS is not >= 10 dB over a same-run silent control is
    INVALID. Clean ingress is the Focusrite loopback; any click/tear witness
    through snd-aloop is INVALID. The Pi clock is UNSET: cross-device log
    correlation needs an offset. Telemetry is QUERY-ONLY over UDP 4445.

Negative control, fixed now: the SAME judge applied to the recorded pre-fix
witness `.gm/witness-out/item1-clear-reset-run-20261106.txt` (nine samples with
impose_target_samples = -1 and NOT_PUBLISHED) must FAIL. The window-3 witness
`.gm/witness-out/item3-window3-adr034-20261106.txt`, whose peer dropped to
peers=0 mid-restart, must FAIL the peer-presence gate even though its impose
target matched exactly; a standalone run is NOT this row's witness.
If either negative control PASSES, the gate is weak: stop, report, and do not
close the row.

Recovery order if the peer drops: remote restart first; power cycle only if
TFTP stalls. Log which path worked. Any regression stops the run, reverts the
deployed commit and re-witnesses. Devices stay frozen until the owner
approves the window; the ~7 ms end-to-end invariant decision is NOT made
here.

CONTRACT-END
