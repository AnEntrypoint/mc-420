# PRD: Transpose engine rewrite (both effects)

## Scope (confirmed with user, revised)

**Two distinct effects, two distinct scopes:**

1. **Regular transpose** (`pitch.dsp`/`soladSnacOctaver.h`/`pitch_ffi.h` —
   the mono continuous "-12" free pitch-shift, mod-wheel/CC52-driven) —
   ALREADY has `GrainFormant`-based real formant preservation. No shifter
   change needed here. Confirm it stays correctly wired as the reference
   implementation other work draws from.
2. **Key transpose** (`effects/home/faust/multitranspose.dsp` — the
   polyphonic 6-voice held-key absolute pitch-lock) — gets the FULL scope:
   real `GrainFormant`-based formant preservation (replacing the current
   crude `formantTilt()` spectral-tilt hack), unvoiced/transient gating,
   better pitch tracking, and a PSOLA-quality shifter (replacing `xpose()`'s
   two-tap delay-line approach) — by extending `EngineSoladSnac` into a
   per-voice array (6 instances) rather than building a second, separate
   engine from scratch, since `EngineSoladSnac` already owns SNAC tracking,
   `periodOk()` confidence, splice-based PSOLA resplicing, AND
   `GrainFormant` — it does almost everything R3/R4/R5 asked for already,
   just as a mono/free-ratio engine, not a polyphonic/lock-to-note one.

Does NOT touch the SHIFT+key resample path (loop-resampling through
either transpose engine). Does NOT add musical UX controls (retune speed,
humanize, scale-lock).

1. **Unvoiced/transient gating** — hold the last stable shift ratio and
   window/formant state during consonants, breaths, onsets, and any frame
   the pitch detector itself reports low confidence on, instead of letting
   noisy/garbage readings perturb the shifter. Directly targets the
   "transient search" artifact reported live this session.
2. **Better pitch tracking** — YIN-style normalized-difference detection
   (more octave-robust than raw autocorrelation), a real confidence
   output, and a constrained search band around the last stable estimate
   (exploit that this is a LOCK: we know the target interval, so we don't
   need a free 60-1500Hz scan every frame).
3. **PSOLA/formant-preserving shifter rewrite** — replace `xpose()`'s
   two-tap delay-line shifter (measured this session: only produces the
   correct ratio when its window closely matches the true period; a ~25%
   window mismatch already produces a badly wrong shift) with pitch-
   synchronous grain resplicing, matching the existing SNAC/solad engine's
   architecture (`soladSnacOctaver.h`) already used for the mono "-12"
   pitch-bend effect.

## Architectural decision (pending research)

`AGENTS.md` documents `multitranspose.dsp` as a real, repeated Faust
compile-time-cliff trigger (2min-20min+ SIGALRM kills on CI, confirmed
multiple times this session and in prior sessions per the file's own
history). The existing mono pitch-lock effect (`pitch_ffi.h`/
`soladSnacOctaver.h`) is a C++ engine bridged into Faust via a single
`ffunction` call — NOT reimplemented per-voice in Faust. Given 3 above is
explicitly a PSOLA/grain-resplice engine, the strong prior (confirmed by
this project's own working architecture) is: build this as a C++ engine
mirroring `soladSnacOctaver.h`'s shape, extended to N polyphonic voices,
bridged into `multitranspose.dsp` via the same `ffunction` pattern
`pitch.dsp`/`pitch_ffi.h` already use — NOT hand-written in Faust per
voice. This avoids the compile-cliff risk entirely for the new engine
code (only the bridge call site touches Faust) and reuses proven,
already-hardware-verified epoch/splice/crossfade machinery.

This is a real one-way architectural door: confirm before deep
implementation begins.

## Rows

- [x] R1: Researched. Confirmed: mono pitch engine (EngineSoladSnac) bridges
      via ONE global singleton, single ffunction, no per-voice identity.
      pitchtracker_ac.dsp is a 37-candidate autocorrelation grid with
      subharmonicPromote + energyReady/holdLastGood onset gating.
      multitranspose.dsp: no new UI primitives allowed inside the file
      itself (compile-cliff rule) — new controls go in effects_runtime.dsp.
- [x] R2: Confirmed with user — one multi-instance C++ class (array of 6
      EngineSoladSnac-derived instances), ONE ffunction declaration with a
      voice-index float parameter threaded through
      (dubfx_pitch_tick_poly(x, voiceIdx, targetNote, formant, gate)),
      not 6 separate global functions.
- [ ] R3: Design + implement unvoiced/transient + confidence gating
      (smallest, most isolated change — can land independently and be
      verified live first).
- [ ] R4: Design + implement YIN-style pitch tracking with confidence
      output and constrained search band.
- [ ] R5: Design + implement polyphonic PSOLA/formant-preserving shifter
      engine (the large one).
- [ ] R6: Wire the new engine into `multitranspose.dsp` via ffunction
      bridge, replacing `xpose()`+old tracker for the live-monitoring
      path only.
- [ ] R7: Verify via DawDreamer (synthetic + real vocal corpus) AND real
      Pi 4 hardware before considering complete, per this project's own
      verification discipline (no test files, live execution only).
