# MC-420 — a right-to-repair live workstation for punch-in musicians

**aloop** is the codebase behind the **MC-420**: a world-first right-to-repair
live-performance workstation built for punch-in live musicians — looping,
polyphonic pitch-lock, a granular/modal-resonator synth engine, and swappable
effects, all on a Raspberry Pi 4 running **pure Linux** (Alpine with the stock
`linux-rpi` kernel and userspace RT tuning; a PREEMPT_RT kernel is OPTIONAL,
ADR-011).

Right-to-repair is not a marketing label here — it is the actual architecture:

- **The DSP is Faust source, not a firmware blob.** Every algorithm — the loop
  engine (`dsp/loop.dsp`), the effects chain, the polyphonic pitch-lock
  (`multitranspose.dsp`), the Resonode modal-resonator synth
  (`resonode_synth.dsp`) — is readable, editable `.dsp`
  text a repair tech or a curious musician can open, change, and recompile.
  There is no sealed DSP core; the granulator is the exception, C++
  `Sampler` rather than Faust.
- **The control surface has a plain-text remap layer.** Four note/CC bindings
  in `config/controls.conf` (stop-all, half/double speed, lpslope) can be
  re-mapped with a text editor, no recompile, no vendor tool; the remaining
  pads, knobs and CCs are handled in `src/control/apc_grid.cpp` and
  `src/control/midi.cpp`.
- **The user effect is a plain LV2 directory, not a locked plugin slot.** Drop
  your own `.lv2` bundle onto the flash storage and it loads at service start
  (a restart; `Lv2Host::rescanUser()` has no caller) —
  write it in Faust or use any existing LV2 plugin.
- **The whole runtime is standard Linux**, debuggable with the same tools that
  work on any Linux box — SSH, `/proc`, ALSA, standard cross-compilers — instead
  of a proprietary bootloader and an undocumented DSP ISA.

This is not a rewrite for its own sake. The original architectural decision to
leave the bare-metal ([Circle](https://github.com/rsta2/circle)) looper for Linux
is grounded in a **witnessed feasibility study**
([`docs/FEASIBILITY.md`](docs/FEASIBILITY.md)) that read the real bare-metal
looper source and measured the tradeoffs. This README is the front door; the
*why* behind everything lives in [`docs/`](docs/), and the accumulated
hardware/DSP/build constraints from real device testing live in
[`AGENTS.md`](AGENTS.md).

---

## The idea in one picture

```
Raspberry Pi 4  ·  Alpine Linux (diskless/RAM)  ·  stock kernel + RT tuning
┌─────────────────────────────────────────────────────────────────────────┐
│ Core 0  USB gadget/IRQ — f_uac2 mirror; net/USB IRQs → Core 2           │
│ Core 1  ONE RT worker — Faust halves + LV2 hosts, all serial            │  compiled into
│                         loaded by directory at boot                     │  the aloop binary
│ Core 3  reserved label — user_fx = 3 is a log label only                │─┐ in-process
│ Core 2  control        — Link · WiFi/AP · MIDI · telemetry              │─┘ host, NO graph
└─────────────────────────────────────────────────────────────────────────┘   (zero added latency)
   Home stack = aloop_pre.dsp + delayverb.lv2 + aloop_post.dsp, no Circle source
```

## What this buys you (the four goals, all feasible on Pi 4)

| Goal | How aloop does it | Why it works |
|------|-------------------|--------------|
| **Ableton Link over WiFi, no audio glitch** | Official Link lib on the control core; audio reads a lock-free snapshot | Link carries *timing*, not audio — and the kernel WiFi stack fixes the bare-metal once-a-second glitch |
| **Home FX + your own FX, one worker** | Two LV2 hosts loaded by directory and processed serially on the single RT worker pinned to Core 1 (`home_fx = 1`); `user_fx = 3` is a label | No JACK/PipeWire graph |
| **No added latency vs bare-metal** | In-process LV2 hosting; the chain fits one core inside the 1.333 ms block | A graph host would add a full period — so aloop never uses one |
| **Pi is its own Link AP when offline** | autoAP MAC-ordered election on the single `ticker` SSID (STA only for a lower-key peer) | The bare-metal looper already did this; Linux does it with `hostapd`/`wpa_supplicant` |

## The instrument, not just the looper

The home Faust stack (Core 1) has grown well past "loop + effects" into a real
punch-in-live performance instrument:

- **20 independent loopers** with an ARM → FINISH → pause/resume press cycle per
  pad (not simple record/play), long-hold erase, and Link-quantized successive
  recordings that snap to a musical power-of-2 subdivision of the established
  phrase length.
- **6-voice polyphonic pitch-lock** (`multitranspose.dsp`) — a Whammy/Manipulator-
  style harmonizer that locks the input to held keys, with round-robin voice
  stealing and pitch-synchronous shift windows.
- **Resonode** — a 4-voice, 16-mode-per-voice modal-resonator synth, excited by a blend of the live input signal and its own mallet/bow exciter plus a bounded impact pulse whose length tracks mallet hardness, engaged by SHIFT+tap on the LofiFx pad (a plain tap instead latches a background granulator texture, on/off, from the instant of the press).
  Its five material shapes each carry their own per-partial decay and gain
  curves, so string/bell/plate/membrane/bar read as distinct objects rather
  than variations on one tone.
  Both run on the same audio worker; Resonode is a separate LV2 bundle
  (`resonode.lv2`) processed only while engaged, and the granulator is C++.
- **A 4-patch granulator** (Glass/Cloud/Chop/Shatter) blended as a
  continuous convex morph across four patch-weight knobs (plus three direct
  parameter knobs), with real velocity-sensitive
  grain density, a freeze gesture on the bottom eighth of the scan-rate dial
  that holds the live ring and draws every grain from that snapshot, and
  integer-semitone grain transposition (−12..+12) on the middle band of the
  spray dial. A "tape"-like dark cloud is a dial position — patch Cloud
  transposed −12 — not a fifth patch row: eight swept Tape candidate points
  all measured inside the shipped four's centroid span (1440–1562 Hz vs
  1309–1794 Hz measured, 1079–1869 Hz on an earlier run of the same bench),
  because the granulator has no filter to make a row warm.
- **A 16-beat grid visualization** on 4 dedicated pads showing the shared Link
  phrase position live.
- **Continuous USB-drive ring recording** of the fully-effected mix, and an
  Ableton Link mesh (the `ticker` AP) that lets multiple aloop/ESP32 devices
  share tempo and phase with no manual pairing (Link transport is NEVER shared;
  `enableStartStopSync(false)`).

See [`docs/CONTROLS.md`](docs/CONTROLS.md) for the full control-surface
reference and [`AGENTS.md`](AGENTS.md) for the technical constraints behind each
of these.

## Swappable effects — the moddability story

The user-extension slot is a **plain LV2 plugin directory on flash**, not
compiled into the firmware:

- The **home stack** is two Faust halves (`dsp/aloop_pre.dsp` and
  `dsp/aloop_post.dsp`) compiled into the `aloop` binary around the
  `delayverb.lv2` split, plus LV2 bundles loaded by directory at boot
  (`/effects/home`, `/effects/resonode`, `/effects/pitchtracker`). The
  granulator is C++ `Sampler`. All of it runs on the one RT worker on Core 1.
- **You** drop your own `.lv2` bundle into `/effects/user/` on the SD card and it
  loads at service start on that same worker — write it in
  [Faust](https://faust.grame.fr), or use any of the thousands of existing LV2
  plugins. A restart is needed; `Lv2Host::rescanUser()` has no caller. See
  [`effects/README.md`](effects/README.md).

This is only possible because Linux gives us a filesystem and a dynamic linker —
neither of which existed on bare metal. That single capability is the reason for
the whole migration, and it is the mechanical basis of the right-to-repair claim:
nothing about extending or fixing this instrument requires reflashing a sealed
firmware image.

---

## Repository layout

| Directory | What's in it |
|-----------|--------------|
| [`docs/`](docs/) | The design record — architecture, the migration map, the decision log, the control-surface reference, and the feasibility study that justifies it all |
| [`AGENTS.md`](AGENTS.md) | The living technical-constraints reference — hardware quirks, DSP gotchas, deploy/netboot mechanics, all discovered through real-device testing |
| [`src/`](src/) | The audio thread, in-process LV2 host, Link integration, WiFi/AP control, MIDI/control-surface handling |
| [`dsp/`](dsp) + [`effects/`](effects/) | The Faust source for the home stack (loop engine, pitch-lock, Resonode, effects) and the user-drop-in LV2 directory; the granulator is C++ in `src/` |
| [`image/`](image/) | The Alpine diskless image build, multi-board (Pi 3/4/5, Orange Pi Prime) |
| [`kernel/`](kernel/) | cmdline + `rt-tune.sh` userspace RT tuning; optional PREEMPT_RT build fragment (ADR-011, not shipped) |
| [`ci/`](ci/) + [`.github/workflows/`](.github/workflows/) | GitHub Actions that build the LV2 bundles, cross-compile the binary, and assemble each board's image |

## Status

The original Circle→Linux migration (steps 1–11 of the original build plan) is
long done and running on real Pi 4 hardware — the codebase has moved well past
"migrated" into active feature iteration: the pitch-lock, Resonode synth,
granulator, grid-LED visualization, and USB ring-recording work above all
shipped *after* the migration, each as its own real-hardware-tested change (see
`git log` for the full history, and [`docs/PLAN.md`](docs/PLAN.md) for the
current state summary). Work continues as a live, PRD-driven queue
(`.gm/prd/*.yml`, summarized in [`docs/plans.md`](docs/plans.md)) rather than
a fixed pre-planned list; the queue currently also
carries an in-progress hardware bring-up effort for a second board target
(Orange Pi Prime, Allwinner H5) alongside the Pi 4/pi3/pi5 boards already
supported by the shared boot-tree tooling — see `AGENTS.md`'s Boards section for
the real per-board capability matrix and the Orange Pi Prime's current
boot-blocker status.

## Provenance

- **`../looper`** — the bare-metal Circle looper this migrates from (the DSP/loop
  engine ports from here unchanged).
- **`../dubfx`** — the Faust reproduction of looper's effects, A/B-verified
  sample-for-sample. Its verified chain becomes aloop's home-FX LV2, and its A/B
  harness is aloop's regression oracle.
- **`docs/FEASIBILITY.md`** — the witnessed study that grounds every decision.
