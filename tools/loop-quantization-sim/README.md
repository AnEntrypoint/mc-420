# loop-quantization-sim

A pure-JS model of the aloop audio thread, the looper DSP and an Ableton Link session, used to
reason about loop quantization before touching the device. `SCALE = 100` (sim runs at 480 Hz
"sample rate" with `kSimSpeedup = 100`), so 1 sim second costs 1/100th of the wall clock of a
device run.

Run one case with `node tools/loop-quantization-sim/<case>.js`. There is no committed suite
runner; `.github/workflows/test-loop-sim.yml` lists the cases CI runs, one step each.

## Link model

The device is clock-only Link: `enableStartStopSync(false)`, so tempo and phase are shared and
transport never is. `src/` has no occurrence of `setIsPlaying`, `setIsPlayingAndRequestBeatAtTime`
or `applyRemoteTransport`, so the device's peer `isPlaying` is always false.

The sim does not match that. `link.js` `setTransportPlaying` forwards to `setIsPlaying`, and
`world.js` `publishTransport` calls it on every play change, so a sim peer's `isPlaying` does
follow the local loopers. `remote-join.js` `applyRemoteTransport` (called from `stepPair`) launches
takes on a peer's remote START, a path the device lacks. Both are model-only. The remote-join case
asserts that model, not device behaviour. `setIsPlayingAndRequestBeatAtTime` is defined in
`link.js` and never called.

A phase impose is `requestPhaseImpose(...)`, queued off the audio thread and applied by
`applyPendingPhaseImpose(...)` on the next 5 Hz control tick, so it lands up to 200 ms after the
event that requested it. Every applied impose bumps `session.rebaseSeq`; the audio thread sees
that bump as `resnapAfterRebasePending` (`src/dsp/audio_thread.cpp`, shipped in `d316e22`) and
resnaps once, bypassing the idle-only snap gate.

## The impose window in the assertions

`join-late.js` and `beat-count-race.js` measure a run in two halves and assert both:

- **settled** — max |error| over the polls from 500 ms after the imposing event to the end of the
  watch. Thresholds are the ones those cases always used (0.25 beats of gap, 0.05 beats of read
  head error, settle within 1000 ms).
- **transient** — the first 500 ms is *not* asserted to be small. It is asserted to be *explained*:
  the run must show a `rebaseSeq` bump inside that window, and the case prints the shared session
  beat immediately before and after the bump (e.g. `beat 13.800 -> 0.601`), so the reader sees the
  timeline re-base that the transient is. A run with no bump fails with "transient is not
  explained by a re-base".

The pre-500 ms numbers are large on purpose (~1.4 beats): they are the window in which a take has
been finished but the session has not yet been re-based onto it. Asserting them small was asserting
that the re-base is instantaneous, which is false on the device.

In both cases the legacy and fixed arms now print identical numbers. That is not a bug in the
scaffolding: neither scenario exercises the join-snap path, because the take that triggers the
impose is the first take on its world, so it goes through the creation impose
(`masterJustCreated`) which is unconditional on the device (`src/dsp/audio_thread.cpp`). In the model
it is skipped on a device that adopted a peer's published origin (`adoptedPeerOrigin`, set when a
connected device publishes its origin while this device is empty and synced, cleared on phrase
reset). The device does not yet carry that flag (see the timing-empty-slave-adoption row). The arms
are kept so a future change to the creation path is caught here too.

## Where each error signature is covered

`two-device-sync.js` compares two worlds against *each other* (an A/B gap). That metric is
structurally blind to the loop-quantum fold: once both worlds share one session, both fold the
same way, so the gap reads 0.000 even with the fold bug present. Its long sub-case
(`holdMs 15000`, rb = 30) is therefore **sync-stability coverage only** — peers held, bpm spread,
eff_speed spread — and says so in its output. xruns are not modelled in the sim.

Fold coverage lives in `loop-quantum-fold.js`, which measures each world against the *grid*
(absolute-vs-grid, not A/B), which does see the fold. It needs a long watch: the fold error only
appears once the shared beat passes the capture quantum, so beat >= 128 (~64 s at 120 bpm).

**16-quantum caveat.** `loop-quantum-fold.js` also prints a 16-quantum column, whose residual is
about 0.48 beats and is *rb-independent* (0.485 at rb=3, 0.476 at rb=6 and rb=30). That is
trim-chase — the ±0.03-clamped phase trim chasing a residual over ~16 s — not the fold. The fold
error is rb-scaled (0.996 / 2.004 / 3.389 at rb = 3 / 6 / 30 for the 128-quantum capture). Do not
cite the 16-quantum column as fold evidence; the two have different signatures.
