# mc-420 DSP CLI harness

Pure command-line tool for building and inspecting ANY mc-420 Faust DSP
file directly, locally, with the real `faust.exe` compiler and real MSVC
-- no GUI, no PortAudio/JACK/ALSA/libsndfile, no Pi, no GitHub Actions, no
Docker. This is the fast local-iteration counterpart to CI/DawDreamer
verification: a ~1-2 second recompile cycle instead of a multi-minute CI
round trip, and it can drive DSP files DawDreamer's JIT structurally
cannot (see "Why this exists" below).

Requires `C:\Faust\bin\faust.exe` and an MSVC Build Tools install (both
hardcoded paths in `build.bat` -- edit them if your machine differs).

## Build

```
build.bat <repo_root> <dsp_file_relative_to_repo_root> [faust -I flags...]
```

Example (the multitranspose pitch-lock engine):
```
build.bat C:\dev\mc-420 effects\home\faust\multitranspose.dsp -I dsp -I effects\home\faust
```

Any `.dsp` file works this way -- a single effect stage
(`effects\home\faust\filters.dsp`, though note some individual stage files
bake params as compile-time constants rather than exposing sliders --
check with `--list-zones`), the whole loop engine (`dsp\loop.dsp`), or the
full home stack (`dsp\aloop.dsp`).

`repo_root` matters because some `.dsp` files (`effects_runtime.dsp`,
`multitranspose.dsp` via `component("pitch_poly.dsp")`) import other files
by a path that's only valid relative to the repo's own root, not relative
to wherever you run the tool from.

Files that `ffunction`-import a companion C++ header (`pitch.dsp` ->
`pitch_ffi.h`, `pitch_poly.dsp` -> `pitch_poly_ffi.h`) build and link with
zero extra steps: `build.bat` points MSVC's include path at the real repo's
`effects/home/faust/` directory, and both headers are header-only
(`static`/`static inline`), so there's nothing further to link.

## Why this exists

`test/pitch-tracker-transient/*.py` and `test-audio-corpus/*.py` verify
DSP behavior through DawDreamer's Faust JIT -- but the JIT categorically
refuses to link `ffunction`-declared external symbols, so it cannot compile
`multitranspose.dsp`, `pitch.dsp`, or anything that pulls them in (a
disclosed, standing gap in AGENTS.md: `verify_highoctave_transient.py`
cannot run at all for this reason). `faust -lang cpp`'s OFFLINE codegen has
no such restriction -- it just emits an `extern "C"` declaration and a call
site, resolved at ordinary link time, not JIT time. This tool is that path:
real Faust codegen, real compiled C++, real link, against the file's own
control/tracking state machine and everything downstream of it -- not a
hand-ported reimplementation that risks drifting from what actually ships.

## Use

```
dsp_cli.exe --list-zones
  -> prints every control (slider/button/checkbox) the compiled DSP exposes

dsp_cli.exe --gen sine:440:2.0 out.wav HPCUT=0.5 REVAMT=0.3
  -> generates a 440Hz, 2-second test tone, runs it through the DSP with
     HPCUT and REVAMT set, writes out.wav, and prints peak/RMS/approx-
     frequency stats for the result

dsp_cli.exe --gen sweep:220:2200:1.0 out.wav
  -> a 1-second linear sweep from 220Hz to 2200Hz (good for checking a
     filter's cutoff response by ear or by inspecting stats at different
     points in the file)

dsp_cli.exe --gen impulse:0.5 out.wav
  -> a single-sample impulse followed by silence (good for checking a
     reverb/delay's tail length)

dsp_cli.exe --gen noise:1.0 out.wav
  -> 1 second of white noise (good for checking a filter's overall
     frequency response by ear)

dsp_cli.exe --gen silence:1.0 out.wav
  -> 1 second of digital silence (useful as a "no signal" baseline, or to
     hold one channel of a multi-input DSP quiet while driving another)

dsp_cli.exe --gen step:0:1:0.5:1.0 out.wav
  -> a 1-second control signal that's 0 for the first 0.5s then jumps to
     1 and holds -- built for driving an envelope-follower/sidechain
     input in a ducking/pumping DSP so you can see the gain-reduction
     transition happen at a known point in time

dsp_cli.exe --gen0 wav:test-audio-corpus/instruments/cello_low_sulC_A2.wav out.wav
  -> plays a real recorded file into channel 0 instead of a synthetic
     signal. Combine with --gen1/--gen2/... (below) to drive OTHER
     channels with scripted step/silence automation in the SAME render --
     e.g. real mic audio on the signal input while a gate/note-target
     channel is scripted with step: to simulate a played note. This is
     the difference between "does the shifter track a ratio correctly"
     (any --gen signal proves that) and "does the tracking/lock state
     machine behave correctly against a real attack transient" (needs
     real recorded material on the signal channel).

dsp_cli.exe in.wav out.wav CTRL=value ...
  -> processes a real PCM/float WAV file instead of a generated test
     signal (any channel count is downmixed to mono on read; 8/16/24/32-bit
     PCM and 32-bit float are all supported, with a real chunk scan so a
     LIST/INFO/fact/JUNK chunk before "data" -- common on DAW-exported
     files -- doesn't corrupt the read)

dsp_cli.exe --stats any.wav
  -> just prints peak/RMS/zero-crossing-rate stats for an existing WAV,
     no DSP involved (useful to sanity-check a rendered output, or diff
     two renders by eye)
```

### Multi-input DSPs (sidechain/ducking, bus compressor, pitch-lock tracking, etc.)

Some effect stages declare more than one Faust input, e.g.
`process(main, sidechainEnv) = ...` for a sidechain-pump/ducking stage, or
`multitranspose.dsp`'s `process(dry, loopSum, free, formant, extFreqDet,
n0,g0, ...)`. Drive each input channel independently with indexed
`--gen0`/`--gen1`/`--gen2`/... flags (repeat as many times as the DSP has
inputs):

```
dsp_cli.exe --gen0 sine:440:1.0 --gen1 step:0:1:0.5:1.0 out.wav
  -> channel 0 (main signal) gets a 440Hz tone for the full second;
     channel 1 (sidechain envelope) is silent for the first 0.5s then
     jumps to 1.0 -- exactly what you want to see a ducking stage's gain
     reduction kick in partway through the render
```

A bare `--gen <spec> <out.wav>` (no index) is an exact alias for
`--gen0 <spec>` — every existing single-input call site keeps working
completely unchanged, byte-for-byte identical output. Any input channel
that isn't given its own `--genN` is fed silence, same as the old
single-channel-only behavior, with a `note:` on stderr saying how many
channels were left silent.

**Multi-output DSPs** (3+ outputs from `process(a,b) = a, b, a+b`, for
instance) get every channel written out, not just channel 0: channel 0
always goes to `<out.wav>` exactly as before (byte-identical for the
overwhelming majority of single-output DSPs already in use), and any
additional channels are written alongside as `<out>.1.wav`, `<out>.2.wav`,
etc., each with its own `channel N:` / peak / RMS / zero-crossing stats
block printed to stderr.

Every CTRL=value maps to a Faust `hslider`/`button`/`checkbox`/`nentry` by
exact name or suffix match (same matching rule the VST's own FaustUI shim
uses) — run `--list-zones` first if you're not sure what a given `.dsp`
file exposes.

## Regenerating after a `.dsp` change

Just re-run `build.bat` with the same arguments — it's a ~1-2 second
recompile (faust codegen + MSVC), no CMake/JUCE/CI involved.

## What this can't do

- No real-time/live audio input (it's file-in/file-out or generator-in/
  file-out only) — for that, listen to the rendered WAV in any player.
- No visual block diagram (Faust's `faust2svg` can generate one separately
  if ever wanted, but that's a different, unrelated tool).
- No per-block telemetry trace (an `hbargraph`/`hslider` zone's value over
  time within a render) — only the final rendered audio and its aggregate
  stats. A `.dsp` file's own diagnostic bargraphs (like
  `multitranspose.dsp`'s `freqdetdiag`/`trustedtrackerdiag`) are visible
  via `--list-zones` but not currently sampled per-block; verifying an
  internal control-rate signal's trajectory over time currently means
  reasoning from the rendered audio's own behavior instead (see the
  `multitranspose.dsp` trackingAllowed fix for a worked example: the
  cold-start regression was caught by the rendered output collapsing to
  near-silence, not by reading an internal value directly).
- No resampling on `wav:`/positional WAV input — a file not already at
  48kHz (this tool's fixed render rate) reads with a warning but plays
  back at the wrong pitch/timing.
