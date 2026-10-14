# Controls — the real, current control surface

The control surface is implemented in `src/control/apc_grid.cpp` and driven by
an APC Key25-class MIDI grid controller. Every binding still goes through the
same name-keyed `ParamStore`/Faust-zone mechanism the project started with —
re-mapping a CC or note is a config change, not a recompile — but the gestures
each pad/knob drives have grown well past plain rec/play/vol. This document is
the user-facing summary; `AGENTS.md`'s "Control Surface" section has the
byte-level detail and the bug history behind each rule below.

## Looper pads: a real press cycle, not a toggle

Each looper pad drives one of 20 independent loopers through a state cycle,
not a simple record/play flag:

```
empty → ARM (rec=1, held) → FINISH (rec=0, play=1) → pause (play=0) → resume (play=1) → ...
```

- **ARM and FINISH fire on press**, not release — both are instants that must
  land precisely.
- **Long-hold erases** a looper's content and, if it was the last looper still
  holding content, resets the shared master phrase length so the next
  recording re-establishes it from scratch.
- **CLEAR_ALL** zeroes every looper's `play` and `rec` in one gesture.
- Real APC Key25 hardware re-sends note-on for an already-held pad; a press
  guard treats the repeat as a no-op so it can't reset a hold timer or
  re-trigger ARM/FINISH mid-recording.
- **Successive recordings snap to a musical subdivision** of the first
  recording's real length — the master phrase length is read from live
  `writeIdx` telemetry (sample-accurate), never estimated from wall-clock time.
  Candidates are always powers of 2 relative to the established length, chosen
  by the log-space geometric midpoint between the two bracketing candidates —
  so any two loopers' lengths are always in a clean power-of-2 ratio and stay
  drift-free forever.

## Guitar-FX held: sidechain-source toggle

While the Guitar-FX pad is held, a looper-pad press is redirected entirely — it
toggles that looper as a sidechain-pump source instead of touching its
ARM/FINISH state. The designation auto-clears when that looper's content is
wiped.

## The LofiFx / granulator pad: two gestures on one button

This pad (note 69) always switches the active knob bank to LofiFx and always
fires instantly on the press edge — SHIFT disambiguates which of the two
gestures below fires, never a hold-duration timer (a prior 1000ms-hold design
was witnessed unreliable on real hardware — real button releases interrupted
the hold before the threshold, so Resonode never actually engaged):

- **Plain tap**: flips a *latched* granulator state the instant the pad goes
  down. This turns the grain engine into a persistent, backgrounded texture
  layered under everything else; a second plain tap flips it back off. The
  latch survives release regardless of how long the press turns out to last.
- **SHIFT + tap**: toggles the instrument entirely into/out of **Resonode**, a
  4-voice, 16-mode-per-voice coupled modal-resonator synth in the spirit of a
  classic hardware physical-modeling instrument. While engaged:
  - The keybed drives up to 4 Resonode voices (round-robin/oldest-steal
    allocation, same shape as the pitch-lock voice allocator below), each
    carrying its own real MIDI velocity into the exciter's gain — a harder
    key press rings out louder.
  - **Knob slot 0 is `input`**: how much of the excitation comes from the live
    signal versus the instrument's own internal exciter. 0 is a self-contained
    instrument (keys sound with nothing plugged in), 1 is the original
    "reactor mode" (the live signal is the only exciter).
  - Knob slots 1–4 are the blend weight of one of 4 named material patches —
    **Percussive, Metal/Glass, Strings, Dance Bass** — each a full point
    in position/decay/damping/stretch/collision plus the five shape weights,
    an exciter character (mallet vs. bow balance and mallet hardness) and a
    waveguide-object character (how much a tuned feedback-comb stage is mixed
    in, and its feedback polarity — positive lets through more low
    frequencies and is the bassier of the two), blended as a convex
    combination exactly like the granulator's own patch surface below. Each
    material also carries its own per-partial decay and gain curves, so a bar
    sheds its high partials fastest and a bell holds them longest while
    `damping` keeps its existing single-knob meaning. Knob
    slots 5–7 are direct performative dials: **tone** (exponential-taper
    brightness), **level** (output loudness), and **couple** (nearest-neighbor
    energy exchange between adjacent modes — 0 is the original independent-
    mode behavior, higher values let modes audibly interact/beat rather than
    ring in isolation, the single biggest lever for making two patches feel
    distinct from each other rather than variations on one tone).
  - Resonode is excited by a blend of the *live input signal* and an internal
    mallet/bow source, so a held key sounds on its own and the live signal
    colours it — at `input` = 1 the live signal is the only exciter and a
    silent input still renders bit-exact silence. While engaged it fully
    **replaces** the dry/pitch-lock signal rather than layering
    under it. The exciter itself is broadband (each of the 16 modes performs
    its own frequency selection, rather than a shared note-locked filter
    pre-narrowing what reaches the bank) and shaped by a percussive strike
    envelope — a fast attack that decays to a low sustain floor while the key
    stays held, so a keypress reads as a struck-object transient rather than
    continuously re-opening a high-Q filter on whatever the mic is currently
    picking up. Under that envelope sits a short bounded impact pulse whose
    length tracks `hardness` (0.6 ms hard to 14 ms soft) and whose tone is the
    mallet's own, so a soft mallet reads as a dull thud and a hard one as a
    click; it is scaled out entirely at `input` = 1.
  - A harder key press also bends the pitch briefly upward on attack before
    settling to the true note — more so on "flexible" (low-dispersion)
    patches, barely at all on "stiff" (high-dispersion) ones — and
    **collision** adds a bounded per-patch soft-clip "bounce" to each voice's
    own output (0 = untouched passthrough), both scaled per named patch
    rather than exposed as free-standing knobs. Each voice also gets a small
    live spectral drift (brighter right at the strike, settling back to the
    patch's own tone over the next third of a second) and a small per-note
    random micro-variation, so a single patch audibly evolves within a note
    and no two strikes of the same key sound identically static.
  - The knob bank latches on LofiFx permanently on press, matching Dub/Guitar
    (no revert-on-release) — Resonode itself stays engaged until a further
    SHIFT+tap toggles it back off, and disengaging releases every held
    Resonode voice.

LED feedback on the pad itself: blinking red once Resonode is actually
engaged, solid green while the granulator is latched-on in the background,
off otherwise.

### Granulator and Resonode: named patches, blended, never raw sliders

When Resonode is *not* engaged, knob slots 1–4 are the blend weight of one of
4 fixed named grain patches — **Glass, Cloud, Chop, Shatter** — each a full
point in grain-size/density/pitch-spray/position-jitter/scan-rate/reverse-probability/envelope-shape/live-source space
representing a distinct musical character. The eighth dimension, **live
source**, is how much of the grain stream is drawn from a continuously
refreshed ring of the live signal rather than from the key's own captured
buffer — so the granulator makes sound the instant it is latched on, with
nothing recorded yet, and the captured material still layers in as it
accumulates. When Resonode *is* engaged, knob slots 1–4 blend the 4 named
material patches above instead. Both surfaces share the same convex-
combination discipline: turning up multiple patch dials together produces a
coherent blend, never independent raw parameters fighting each other, and all
weights at zero falls back to the first named patch (Glass for the granulator,
Percussive for Resonode) rather than dividing by zero. Turning the scan-rate
dial (slot 5) fully counter-clockwise freezes the granulator: the live-source
ring stops being written and every grain is drawn from the held 2.7-second
snapshot, so the cloud holds a static spectrum (measured spectral correlation
first-half vs second-half 0.986 vs 0.784 unfrozen, centroid shift 6 Hz vs
291 Hz). Freeze is a gesture, not one of the four named patches, and it works
on every patch; turning the dial back up releases it.

The spray dial (slot 7) carries three bands, bottom to top:

- **bottom half** — continuous random pitch spray, 0 to 1200 cents. This is
  what shipped before; the lower half is unchanged.
- **middle three eighths** — deterministic **grain transposition** in integer
  semitones, −12 to +12, unison at the band centre (~1.9 MIDI steps per
  semitone). Measured on Glass at 4 voices, N=64, 5 s, piano C4 through the
  live ring: spectral centroid 450.5 Hz at −2400 cents rising monotonically
  through 753.7 / 1414.5 (unison) / 2742.7 to 5185.0 Hz at +2400 — an 11.5x
  span — at 17.652 / 17.786 / 17.504 / 17.515 / 17.252 µs per block, i.e. flat
  within noise, because transposition is one float add inside a `pow` that
  already runs per grain spawn (~0.037 spawns/block).
- **top eighth** — the four interval sets (Octaves / Fifths / Minor Triad /
  Minor Pentatonic), all still reachable, now at 4 MIDI steps each instead of
  16.

**Tape is a dial position, not a patch row:** patch Cloud with the spray dial
at −12 semitones. Measured: centroid 1794.2 → 1204.4 Hz, sub-500 Hz band
energy 0.607 → 0.913, 10.182 → 10.435 µs/block. A fifth named "Tape" row was
measured and rejected — eight swept candidate points (grain 180–400 ms, rate
4–10 Hz, spray 0–14 c, jitter 0–25 ms, scan 0.25–0.50, env 0–0.20, live mix
0.35–0.55) all land at centroid 1440.2–1561.9 Hz and flux 0.0874–0.0967,
inside the shipped four's measured 1308.7–1794.2 Hz (and inside the earlier
session's 1079.5–1868.8 Hz / 0.0930–0.3348 on the same harness). The
granulator has no filter, so grain size and rate move the centroid by only about ±20%; no patch row can be *warm*. A
second LofiFx patch page was rejected for the same reason — it buys only
transposition, and a hidden mode collides with ADR-023's press-edge latch
toggle.

Real key velocity
scales overall voice loudness for both instruments, and (for granular voices
only) grain spawn density, so a harder key press plays louder — and for the
granulator, spawns a denser, brighter grain cloud.

## 6-voice polyphonic pitch-lock (SHIFT + keybed)

Holding SHIFT and pressing keys drives a 6-voice polyphonic pitch-lock engine
(`multitranspose.dsp`) — a Whammy/Manipulator-style harmonizer where the
output lands on the exact held key regardless of the input's actual pitch.

- Each held key claims one of 6 voice slots (reuse-own-slot / prefer-unheld /
  oldest-steal allocation).
- The transpose window is pitch-synchronous (sized from the detected input
  period, capped at 20ms), not a fixed window, so large shifts track
  correctly and rapid retriggers stay click-safe.
- SHIFT alone (no key held) is a separate gesture — the native fold mechanism
  that lets the previous block's loop content bleed into the live input.
- SHIFT + `fx/monitorfold`'s **free-transpose** mode redirects the whole
  tracking/shifting engine onto the loop content itself instead of the dry
  input — a live "pitch-shift the loop" gesture on the same voice engine.
- Locked pitch **replaces** the original signal — a dry/pitch-lock crossfade
  gate closes as voices gate, so this is a lock, never a harmonizer sitting on
  top of the unshifted signal.

## Grid-beat visualization

The 4 top-right otherwise-unassigned pads show the shared 16-beat Link phrase
position live, read from `AudioThread::Telemetry::gridBeatIndex`. Each pad is
one quarter of the 16-beat phrase. Dark when nothing is playing; green
whenever any looper is playing; a quarter already passed turns yellow; the
red position marker cycles across the 4 pads once per beat, landing on the
pad matching the current position within the active quarter.

## 3-bank FX knob surface

The knob row is one shared set of 8 CCs — {48, 49, 50, 51, 54, 55, 57, 53},
with CC53 double-duty as Formant on the Dub page — whose target table depends
on which bank is active — **Dub**, **Guitar**, or **LofiFx**
(granulator/Resonode, above).
A bank-select press only flips which target table the next knob CC reaches
and starts a brief LED flash; it never re-pushes state to the DSP.

## Config-file remapping (unchanged mechanism)

Every control still ultimately binds through `/etc/aloop-controls.conf` (see
`config/controls.conf` for the format): a plain `<midi> <target>` line per
binding, parsed by the MIDI thread and written into the name-keyed
`ParamStore`, which the audio thread reads by name into the matching Faust
control zone. Nothing is hardcoded — the map is the single source of truth for
which physical control reaches which target, and re-mapping needs no
recompile. What has changed since this file's original scope is the *behavior*
layered on top of individual pads (the gestures documented above) — the
underlying binding mechanism is untouched.
