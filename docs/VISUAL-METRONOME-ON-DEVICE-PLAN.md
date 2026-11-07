# Visual beat cue - on-device measurement plan (HELD)

This is a plan document only. No device work, no polls, no MIDI injection and no
rc-service restarts have been performed for it. Clause B of
`.gm/prd/visual-metronome-beat-cue-onset.yml` stays held until an owner-approved
quiet Pi window.

## What is already proven offline (Clause A)

`tools/loop-quantization-sim/visual-beat-cue.js` injects a clock, schedules beat
cues from the Link beat grid, and measures the software send against the beat
origin it marks. Coverage: 60/90/120/157.2/180 BPM, rb 3/5/6/7, and three rebase
modes (none, exact +134-beat impose, snap). Fixed arm: 60/60 cases pass, maximum
software send error 0.667 ms against the 7 ms gate. A deliberate +20 ms delay
control fails 60/60 cases (20.667 ms) and is asserted by CI.

The sim models `src/control/midi.cpp:82` `kBeatLeadMs = 30` as a compensation
for an **assumed** APC Key25 LED/MIDI latency of 30 ms. The raw software send
therefore sits 30 ms early by design, and the offline gate is on the
lead-compensated software cue onset. The sim cannot measure the APC real
latency, so it proves no end-to-end number.

## Cue path to instrument (file:line)

| Stage | Location | Clock / delay |
|---|---|---|
| Poll wake | `src/control/midi.cpp:223-228` | `waitMs = millisToNextBeat(bm, 100) - 30`, clamped to >= 1 ms |
| Beat index | `src/control/midi.cpp:239-246` | `LinkBridge::beatMarkNow()`, Link clock micros, quantum 16 (`link_bridge.cpp:234-253`) |
| Telemetry mark | `src/control/telemetry.cpp:41-46` | `CLOCK_MONOTONIC` stamp, query-only UDP 4445 |
| LED flash | `src/control/apc_leds.h:136-160` | `beatEdgeMs_ = now_ms` on index change, 100 ms flash |
| Throttle bypass | `src/control/apc_leds.h:94-98,165-168` | beat pads skip the 33 ms full-grid refresh |
| MIDI write | `src/control/midi.cpp:132-135` | synchronous `snd_rawmidi_write`, 0x90 note + colour |
| Coalescing | `src/control/apc_leds.h` `sendCoalesced` | 128-entry change cache, not a queue |

There is no queue, ring, mutex or UDP hop between the beat grid and MIDI out. The
200 ms control tick (`src/main.cpp:188-192`) drives Link snapshot and telemetry
only. With Link unusable the fallback is a 100 ms poll reading the audio-thread
`gridBeatIndex` (`src/dsp/audio_thread.cpp:1092-1115`), whose jitter is
unbounded; that degraded path needs its own on-device capture.

## Clause B measurement (to be run in the quiet window)

1. Record the Link beat origin independently at the same wall clock as the LED,
   using a photodiode or high-speed camera on the APC beat pad and a
   `CLOCK_MONOTONIC`-stamped trace of `beatMarkNow()` / UDP 4445
   `beat_pad_mark` from the same Pi. Never cache the telemetry snapshot.
2. Timestamp the software send at `snd_rawmidi_write` (`midi.cpp:132-135`) in a
   diagnostic build; the difference between that instant and the beat origin
   gives the software send offset, and the difference between the photodiode
   onset and the beat origin gives the end-to-end visual onset.
3. Measure the APC own latency separately as (photodiode onset - software send)
   so the assumed 30 ms can be replaced with a measured value. Report both
   numbers into `docs/measurements-archive.md` and any decision into
   `docs/DECISIONS.md`; rows stay in `docs/plans.md`.
4. Cover 60, 90, 120, 157.2 and 180 BPM; rb 3, 5, 6 and 7; before and after a Pi
   phase rebase. Judge the HOP-LEVEL MEDIAN, not a whole-segment estimate.
5. PASS only when the end-to-end visual onset is within 7 ms of the Link beat
   origin at every covered case. A run whose segment RMS is not >= 10 dB over a
   same-run silent control is INVALID, as is any click/tear witness through
   `snd-aloop`.
6. Device is single-writer: take `.gm/locks/mc-420.writer` with `noclobber`
   before any hot-deploy, and restart `rc-service aloop` between MIDI scenarios.

Clause B is held; this document does not close the row.

## Clause B - APC Key25 own latency measurement method (fixed before the run)

NOT RUN until the owner explicitly approves a quiet device window. The 30 ms
`kBeatLeadMs` lead (`src/control/midi.cpp:82`) is a COMPENSATION ASSUMPTION:
it assumes the APC Key25 own LED/MIDI latency is ~30 ms. Clause A proves only
the lead-compensated SOFTWARE send (max error 0.667 ms), so the APC latency
must be measured, not assumed.

Method, fixed now:

1. Instrument the software send at `snd_rawmidi_write` (`src/control/midi.cpp:132-135`)
   with a `CLOCK_MONOTONIC` timestamp in a diagnostic build; the audio path is
   unchanged and no audio-path latency may grow.
2. Place a photodiode on the beat-pad LED and sample it at >= 1000 Hz on the
   same host clock; a >= 1000 fps camera is the fallback. Record the LED onset
   as the first sample above a same-run dark baseline by >= 10 dB.
3. For EACH covered case (60, 90, 120, 157.2 and 180 BPM; rb 3, 5, 6 and 7;
   before and after a Pi phase rebase), collect >= 30 beat cues. For each cue
   compute: software send offset = send time - Link beat origin; APC own
   latency = LED onset - software send; end-to-end visual onset = LED onset -
   Link beat origin.
4. Report per case: count, HOP-LEVEL MEDIAN, max and p95 of all three
   quantities. Replace the assumed 30 ms with the measured median and record
   the numbers in `docs/measurements-archive.md`; decisions in
   `docs/DECISIONS.md`; rows stay in `docs/plans.md`.
5. Negative control, fixed now: inject a deliberate +20 ms send delay in a
   separate diagnostic arm. It must make the end-to-end gate FAIL.
   If it PASSES, the measurement is INVALID: stop and report.

## Clause B pass gate, fixed before the run

- PASS only when the HOP-LEVEL MEDIAN end-to-end visual onset is within 7 ms
  of the Link beat origin at EVERY covered case, and no single cue exceeds
  7 ms. The measured APC own latency must be consistent with the 30 ms lead
  within the 7 ms budget, i.e. |measured median APC latency - 30 ms| <= 7 ms.
- A run whose segment RMS is not >= 10 dB over a same-run silent control is
  INVALID, as is any click/tear witness through `snd-aloop`. Clean ingress is
  the Focusrite loopback. Telemetry is QUERY-ONLY over UDP 4445; never cache a
  snapshot. The Pi clock is UNSET, so cross-device correlation needs an offset.
- A FAIL is a FAIL: no threshold is widened after results and no verdict is
  reinterpreted. The owner ~7 ms invariant decision is NOT made here.
- This plan does not run until the owner approves a window; Clause B stays
  HELD and it does not close `.gm/prd/visual-metronome-beat-cue-onset.yml`.
