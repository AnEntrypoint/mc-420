# rb=3 on-device phase take - pre-registration BEFORE the run

**NOT RUN. This is a pre-registration only. Nothing here is executed until the
owner explicitly approves a quiet Pi device window.** Devices remain fully
frozen: no Pi ssh, no UDP 4445/4446 polls, no 20813 status reads, no MIDI
injection, no tcp/9401, no flash, no restart, no power cycle, no hot-deploy.
This plan is a document; no code, config, firmware image or PRD row was
changed to produce it. It pre-registers the on-device rb=3 phase take whose
offline model and resnap witness are already on record
(`docs/measurements-archive.md`, archive#resnap-witness-rb3 and
archive#anchors-before-timeline-re-base). The rb=3 on-device phase behaviour
after the phase-capture fold fix is NOT yet witnessed.

## Preconditions fixed now

  - `node test/hardware/verify-two-device-sync.js <pi-ip> 600000` PASS first:
    peer present >=95% post-acquisition (t > +60 s from cold boot), bpm
    spread <=0.05, |phase_err_beats| <=0.03, eff_speed spread <=0.005,
    telemetry gaps <=10%. ~1% ICMP loss is NOT a fault.
  - Single writer: take `.gm/locks/mc-420.writer` with `noclobber` before any
    hot-deploy, release when the window ends. esp holds its device polls;
    START and END markers go to esp.
  - Telemetry QUERY-ONLY over UDP 4445; never cache a snapshot. The Pi clock
    is UNSET, so cross-device log correlation needs an offset.

## Procedure, fixed now

  1. `.gm/resnap-rb3.js 900000` arms an rb=3 take: pad0 (note 2) ARM, hold
     1250 ms, pad0 FINISH, settle, then poll telemetry until
     `recorded_beats == 3` and the looper is playing. If the harness cannot
     arm rb=3 it exits 2 INCONCLUSIVE; that is NOT a PASS.
  2. Keep the rb=3 loop audible with the Link peer associated. Watch for a
     0 -> 1 peer transition WHILE audible; the harness records the transition
     time and samples |phase_err_beats| at 200 ms intervals through the
     re-join re-base. Anchors taken BEFORE a timeline re-base are off by
     (-dBeat) mod rb; with 128 mod 3 = 2, a 128-beat mis-fold reads ~2 beats
     of error that the +/-0.03 trim cannot hide.
  3. Judge the NEXT 1.5 s after the impose separately from the later window;
     report count, max and mean of |phase_err_beats| for both. Use the
     HOP-LEVEL MEDIAN for the verdict, not a whole-segment estimate.
  4. Record `master_phase_beats`, `master_len_samples`, `recorded_beats`,
     `link.phase_err_beats`, `link.peers`, `link.synced`, `eff_speed`,
     `xruns`, `latency_bias_samples`. Cross-check `readpos` against
     master_phase_beats * beatLen from the SAME reply; replies TEAR ->
     despikedSpread(). No NOT_DETECTED may be silently dropped.
  5. Repeat for at least 3 independent 0 -> 1 transitions in the same window.

## Pass gate, fixed now (ALL must hold)

  - Every transition has max |phase_err_beats| <= 0.011 in the first 1.5 s
    after the impose AND <= 0.03 in the later window (the shipped resnap
    figure is max 0.0010 / mean 0.0002, n=483; pre-resnap was max 0.9880).
  - HOP-LEVEL MEDIAN of |phase_err_beats| <= 0.03 in each later window.
  - A 0 -> 1 peer transition occurs while audible in EVERY repetition; no
    transition is INCONCLUSIVE and is not counted as a pass.
  - verify-two-device-sync.js thresholds hold in the same window; xruns flat
    and latency_bias_samples within 16 samples of the pre-window baseline.
  - No anchor taken before the re-base is used as the origin; any whole-beat
    offset of (-dBeat) mod rb is a FAIL.
  - Negative control: the pre-resnap `aloop.fixed` trace (max 0.9880, mean
    0.1473) judged by the same thresholds must FAIL. If it PASSES, the gate
    is weak: stop and report rather than closing anything.

A FAIL is a FAIL; no tolerance is widened after results. A capture whose
segment RMS is not >= 10 dB over a same-run silent control is INVALID; clean
ingress is the Focusrite loopback, never snd-aloop. The owner ~7 ms invariant
decision is NOT made here. Devices stay frozen until the owner approves the
window, and this document does not close any row.
