# Backwards phrase rebase on the Link-connected device - pre-registration BEFORE the run

**NOT RUN. This is a pre-registration only. Nothing here is executed until the
owner explicitly approves a quiet device window.** Devices remain fully
frozen: no Pi ssh, no UDP 4445/4446 polls, no 20813 status reads, no MIDI
injection, no tcp/9401, no flash, no restart, no power cycle, no hot-deploy.
This plan is a document; no code, config, firmware image or PRD row was
changed to produce it. It serves the OPEN row
`.gm/prd/pi-phase-rebase-backwards-phrase-jump.yml`.

## What is already witnessed offline (model clause only)

`tools/loop-quantization-sim/phrase-rebase-backwards.js` mirrors the SHIPPED
esp guard `main/phrase_boundary_guard.h` from esp main 9a832667 (baseline
capture; current > last emits; a decrease keeps the old last). CI is green:
1344/1344 cases clean, 8/8 shipped-guard host vectors, 376 backwards
phrase-jump cases quiet, max loopBeatPos gap 0.000000 beats. `--no-fix`
(direction-blind `!=` rule) fails 376/376 cases. That is ONE clause of the
ruled acceptance; the esp HOST witness is a separate clause and the
on-device clause below is HELD.

## Preconditions fixed now

  - esp main 9a832667 (or later) flashed with the shipped guard; run
    `/config/workspace/esp-idf-link/tools/phrase-boundary-guard-witness.sh`
    on the host first; it must exit 0. Confirm `main/link_sync.cpp` calls
    `stepPhraseBoundary(` and no longer uses the direction-blind comparison.
    Verify `LINK_STATUS_PORT 20813` and the mesh SSID `ticker`, open auth,
    AP/DHCP 192.168.4.1/24, ch 6, quantum 16.0. Confirm the
    `224.0.0.0/4 dev wlan0` multicast ROUTE exists; without it Link
    multicast is unreachable even with the IGMP join. `iw dev wlan0 info`
    reporting `type AP` is the only truth for AP mode.
  - `node test/hardware/verify-two-device-sync.js <pi-ip> 600000` must PASS
    BEFORE the rebase sequence.

## Steps to observe the backwards rebase, fixed now

  1. Open the ESP serial console ONCE and keep one append-only UTC log for
     the whole window. Also capture the aloop UDP 4445 status at >=1 Hz and
     the esp 20813 status replies at >=1 Hz into separate append-only logs.
     Telemetry is QUERY-ONLY; never cache a snapshot.
  2. With the Link peer present and the mesh stable for > +60 s from cold
     boot, record a FIRST take on looper 0 (pad0, note 2). The creation impose
     in `src/dsp/audio_thread.cpp:916` requests beat 0 at press minus L beats,
     which is the backwards timeline re-base this plan observes. Record
     `sample_clock.impose_target_samples`, `impose_audio_samples`,
     `link_target_samples`, `master_len_samples`, `recorded_beats`,
     `master_phase_beats`, `link.phase_err_beats`, `link.peers`, `link.synced`,
     `link.bpm`, `eff_speed`, `xruns` before, at and after the impose.
  3. From the ESP log, read `Phrase boundary %d, beat %.2f` lines and the
     `Phrase-aligned ... + SPP at beat %.1f` lines; compute the phrase number
     as floor(phraseBeat / 64.0) with PHRASE_BEATS 64.0. Record SPP units as
     fmod(sessionBeat * 4, 16384) with negative values wrapped by +16384.
  4. Repeat for rb 3, 5, 6 and 7 (a fresh first take each, with the
     re-acquisition wait between takes). Include one no-rebase control window
     of the same length with no impose requested.
  5. Keep the audio path untouched; no code or config change in the window.

## Pass gate, fixed now (ALL must hold)

  - ZERO phrase-boundary events and ZERO SPP emissions at the rebase instant
    and for the following 1.5 s (judge the NEXT 1.5 s after the impose).
  - ZERO phrase-number decreases adopted by the guard; `s_last_phrase_number`
    keeps the higher value after the backwards jump.
  - Exactly TWO forward boundaries per 128-beat post-rebase window, each with
    SPP units % 256 == 0, and the no-rebase control also emits exactly two.
  - Exactly ONE rebaseSeq bump per impose. Compare `loopBeatPos` with
    master_phase_beats * beatLen from the SAME reply; the gap must be
    <= 1e-3 beats at every rb. Replies TEAR -> use despikedSpread().
  - verify-two-device-sync.js thresholds hold throughout: peer present >=95%,
    bpm spread <=0.05, |phase_err_beats| <=0.03, eff_speed spread <=0.005,
    telemetry gaps <=10%. ~1% ICMP loss on the mesh is NOT a fault.
  - xruns flat and latency_bias_samples within 16 samples of the pre-window
    baseline. Any regression stops the window and is reported.
  - Negative control: the same judge on the pre-guard `!=` rule (esp main
    before 9a832667) must FAIL with >=1 false boundary. If it PASSES, the
    gate is weak: stop and report. The model `--no-fix` arm is evidence, not
    a substitute for the on-device guard.

A FAIL is a FAIL; no threshold is lowered or reinterpreted after results.
The owner ~7 ms invariant decision is NOT made here. On-device verification
stays HELD until an owner-approved quiet window, and this document does not
close the row.
