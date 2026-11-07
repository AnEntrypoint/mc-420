# aloop architecture

This document explains **how aloop is structured and why** — every design choice
here traces to a witnessed finding in [`FEASIBILITY.md`](FEASIBILITY.md). Read
that first if you want the raw evidence; this is the distilled architecture.

## Design principle: keep the good bare-metal ideas, delete the hand-rolled ones

The bare-metal looper got the *hard* things right — a lock-free 4-core audio
architecture with no mutexes in the audio path — and got the *tedious* things
wrong-then-painfully-fixed (a hand-rolled USB-audio decoder, a hand-rolled WiFi
+ DHCP + ARP + Ableton-Link wire stack). aloop **keeps the architecture and
deletes the reimplementations**, replacing each with the tested kernel/userspace
equivalent.

## The 4-core partition

The Pi 4 has four cores. The bare-metal looper's partition (`multicore.cpp:10-34`)
is the design target; the shipped code isolates 1,3 in `kernel/cmdline.txt` and
steers IRQs to Core 2, but runs all DSP on ONE worker pinned to Core 1:

| Core | Role | Bare-metal origin | aloop mechanism |
|------|------|-------------------|-----------------|
| **0** | USB audio I/O | USB completion ISR + dispatch | `f_uac2` gadget opened NONBLOCK on the Core-1 worker; net/USB IRQs steered to Core 2 by `kernel/rt-tune.sh` |
| **1** | **all DSP** | audio DSP worker (`AudioSystem::doUpdate`) | the one RT thread, `SCHED_FIFO`, pinned via `home_fx = 1` |
| **3** | *reserved* | *idle / reserved* | no pinned worker; `user_fx = 3` is passed to `Lv2Host::loadDir` as a log label only |
| **2** | control | net / MIDI / Link / WiFi | Ableton Link lib, `hostapd`/`wpa_supplicant`, ALSA MIDI, telemetry |

The shipped code has **one** audio worker: `homeFx.process()` and
`userFx.process()` run serially inside it (`src/dsp/audio_thread.cpp:1239-1240`).
Core 3 stays reserved by `isolcpus` but has no pinned DSP thread; the "free
core" goal landed as a boot-time LV2 directory load, not a second worker.

### Why network/WiFi lives on Core 2, not the audio cores

Ableton Link and WiFi generate interrupts and CPU load. If they landed on the
audio core they would blow the 1.333 ms per-block deadline and cause audible
xruns. By steering WiFi/network IRQs to Core 2 with `/proc/irq/*/smp_affinity` and
keeping the audio cores isolated with `isolcpus`, the audio core meets its
deadline regardless of network activity. (This is
achievable on Pi 4; see the Pi-5 caveat in `FEASIBILITY.md`.)

## The audio path: Faust, lock-free, allocation-free

The audio DSP — the loop engine (`dsp/loop.dsp`) and the effects (the dubfx Faust
chain) — is **Faust**, compiled to allocation-free C++ as two halves
(`dsp/aloop_pre.dsp` and `dsp/aloop_post.dsp`) around the `delayverb.lv2` split.
It contains no Circle/looper source; it reproduces the looper's behavior
natively. (The paragraph below describes the lock-free control→audio handoff.)

The former note about a ported C++ DSP core no longer applies —
**no dependency on Circle** and does **no allocation, locking, or syscalls in the
audio callback**. That's why it ports to Linux unchanged: it drops onto a Linux
`SCHED_FIFO` audio thread exactly as it sat on a bare-metal core. The dubfx
project already proved the effects compile standalone and produce
sample-identical output.

Control parameters reach the audio thread lock-free through two mechanisms.
`ParamStore` (`src/control/midi.h`) is a fixed array of `std::atomic<float>` slots
addressed by name, written off-thread. Link session state uses the
**double-buffered `LinkSnapshot`** (`src/link/link_bridge.cpp`): an off-thread
writer fills the inactive buffer and flips an index, and `audioRead()` reads the
active one extrapolated at session tempo. No locks, no tearing, no priority
inversion. There is no `paramSnapshot.h`, no index flip for MIDI values, and no
`futex`/`eventfd`, `SEV` or `WFE` wakeup in `src/`.

## Effects topology: Faust home stack in-binary + dynamic user LV2s in-process

This is the load-bearing decision, and it exists to satisfy two goals at once —
**swappable user effects** *and* **zero added latency**.

### Home effects = the Faust home stack, compiled INTO the binary

The loop engine is compiled into the `aloop` binary as TWO Faust instances —
`AloopPreDsp` from `dsp/aloop_pre.dsp` and `AloopPostDsp` from
`dsp/aloop_post.dsp` (`src/CMakeLists.txt:32,37`) — with `delayverb.lv2` between
them. Home LV2 bundles ARE loaded at boot, by directory: `homeFx` from
`/effects/home`, `userFx` from `/effects/user`, plus `resonodeFx`,
`pitchTrackerFx` and two `delayVerbFx` instances
(`src/dsp/audio_thread.cpp:497-521`). `dsp/aloop.dsp` is packaged by `build-lv2`
as an `aloop.lv2` bundle — the alternative, drop-into-another-host packaging and
the A/B artifact, **not** what the aloop binary loads.

### User effects = dynamic LV2, hosted in-process

A user drops their own `.lv2` bundle into `user_dir` (`/effects/user`) on flash and
the audio thread's in-process host loads it **by directory** (any `*.lv2` present)
at worker startup — no recompile, no firmware flash. A restart is required:
`Lv2Host::rescanUser()` (`src/host/lv2_host.cpp:339`) has no callers. This is the
moddability the whole project is for. LV2 gives the standard plugin ABI
(`instantiate` / `connect_port` / `run`) + `.ttl` metadata. The effect dirs come
from `aloop.conf [effects]` with hardcoded defaults in
`src/dsp/audio_thread.h:22-26`; `delayverb_dir` has no shipped config key.

### Why *in-process*, and never a JACK/PipeWire graph

The obvious way to run two plugins on two cores is a graph host (JACK2/PipeWire
run each client on its own core). **aloop deliberately does not do this.** A
graph host schedules clients across period boundaries, which adds **one full
audio period (1.333 ms) of latency per hop**. That violates the no-added-latency
goal.

Instead, aloop `dlopen`s the LV2 bundles and calls their `run()` **directly
inside its own audio callback**. The witnessed latency arithmetic
(`FEASIBILITY.md`, Requirement 3) shows why this is enough:

| Topology | Parallel across cores? | Added latency |
|----------|:---:|:---:|
| Serial chain, in-process, one core | ✗ | **0 ms** |
| Parallel FX, fork-join across two cores (design option, not shipped) | ✓ | **0 ms** |
| JACK/PipeWire graph | ✓ | **+1 period** |

The home + user chain (~0.9 ms of work) **fits inside one 1.333 ms block on a
single core**, and the shipped worker runs it serial in-process — zero added
latency, no cross-core coordination needed. Cross-core fork-join is a
`FEASIBILITY.md` design option, not implemented in `src/`. **A graph host is
never used.**

### User-plugin crash isolation

A user's LV2 is untrusted code running in the audio process. In-process hosting
means a segfaulting plugin could take down audio — so the host installs a
`SIGSEGV` handler + watchdog that **disables a misbehaving plugin and continues
with the home chain**, degraded rather than dead. (True process isolation would
require a graph and its latency; that tradeoff is documented in `DECISIONS.md`.)

## The home stack has grown into a real instrument, not just loop+effects

The loop engine and effects chain are compiled Faust; the instrument layers below
are a mix of LV2 bundles and C++. Faust stages have no runtime branching and are
computed every block (see `AGENTS.md`), but the LV2 hosts are gated:
`resonodeFx.process()` runs only while engaged and `delayVerbFx*` only while
`delayVerbActive`. All of them run on the one RT worker pinned to Core 1.

- **6-voice polyphonic pitch-lock** (`effects/home/faust/multitranspose.dsp`) —
  a pitch tracker plus 6 `EngineSoladSnac` PSOLA shifter voices
  (`pitch_poly.dsp`), each gated by a held key — not crossfaded delay lines. Locked output *replaces* the dry signal via a dedicated gate, it
  never layers over it.
- **Resonode** (`effects/home/faust/resonode_synth.dsp`) — a 4-voice, 16-mode-
  per-voice modal resonator synth excited by a blend of the live input signal and its own mallet/bow exciter, with
  velocity-scaled exciter gain, alias-guarded higher modes (a mode above
  Nyquist fades to silence rather than folding back into an unrelated
  frequency), and click-free voice stealing (a stolen voice gets a synthetic
  one-sample gate dip to re-trigger its envelopes, plus a frequency-glide to
  avoid a biquad-coefficient discontinuity).
- **The granulator** lives in `Sampler` (C++, not Faust — it needs dynamic
  grain scheduling that doesn't fit Faust's static dataflow model), sharing the
  same post-fx capture tap as loop recording.

These are genuinely *new* instrument capabilities, not ports of anything the
original bare-metal looper had — see `docs/MIGRATION-MAP.md` for which parts of
this codebase are Circle ports versus net-new.

## Ableton Link: the official library, RT-safe by the same pattern

The bare-metal looper reimplemented the Link wire protocol from scratch because
it had no IP stack. Linux has one, so aloop uses the **official Ableton Link
library** over ordinary UDP multicast. Link's design already matches the
looper's: its network thread runs on the control core; the audio thread reads
a lock-free double-buffered `LinkSnapshot` through `LinkBridge::audioRead()`;
`captureAppSessionState()` / `commitAppSessionState()` run off the audio thread. WiFi jitter therefore degrades Link *sync accuracy*, never the
audio deadline.

## WiFi: MAC-ordered host election on the single `ticker` mesh (autoAP)

`src/net/autoap.sh` configures one open SSID (`ticker`, `key_mgmt=NONE`) and
elects the host by lowest MAC: a device joins as a station only when it sees a
`ticker` BSSID with a lower election key, otherwise it hosts the AP — even when
a `ticker` network already exists. This is *mode-switching*, not simultaneous
AP+STA (which is flaky on a single Pi radio). `wpa_supplicant` + `hostapd` +
`dnsmasq` under OpenRC, with a switch service. The AP passes multicast between
clients (`ap_isolate=0`), and autoAP installs `224.0.0.0/4 dev wlan0` in
`start_ap()`/`join_sta()` and re-adds it every tick — the ROUTE is required, not
just the IGMP join. `iw dev wlan0 info` reporting `type AP` is the only truth.

## Mesh networking: aloop + esp-idf-link form one ad-hoc Link mesh

Ableton Link's peer discovery is UDP multicast, so every device that should
share tempo and phase needs to be on the same L2 network (Link start/stop
transport is NEVER shared; `enableStartStopSync(false)`). aloop pairs with a
sibling ESP32-based project (`../esp-idf-link`, the "ticker" box) to form
**one ad-hoc, single-AP mesh** with no credential provisioning: exactly one
device hosts an open SSID (`ticker`), and everyone else joins as a station.

- **Host election is MAC-ordered**, not "host if nothing was found" — both
  projects hold for a duration monotonic in their own MAC address (lowest
  MAC ≈ 0s, highest ≈ 6s) before deciding to host, rescanning every second and
  joining the instant a peer's AP appears. This avoids the failure mode where
  two devices cold-booting together each scan before the other's AP exists and
  both end up hosting, splitting into two isolated L2 domains Link can never
  cross.
- Every AP/channel/Link-quantum value is a **paired invariant** (both sides
  also disable start/stop sync)
  between the two codebases — changing one without the other silently breaks
  meshing with no error on either side. `AGENTS.md`'s Mesh Networking section
  carries the authoritative paired-invariant table.
- Link's own tempo-authority rule (a peer joining must never hijack the
  session's tempo) is audited against Ableton's own 12-case Link Test Plan,
  not just informally — see `AGENTS.md`'s "Ableton's Link Test Plan" entry.

Two-device Link sync IS witnessed on real hardware: `verify-two-device-sync.js
<pi-ip> 600000` fails on peer <95% post-acquisition, bpm spread >0.05,
|phase_err_beats| >0.03, eff_speed spread >0.005 or gaps >10% (see `AGENTS.md`).
The multicast ROUTE above is a prerequisite; see `docs/LINK-MESH-TESTING.md`.

## USB audio: the kernel `f_uac2` gadget

On gadget-capable boards (pi4 / pi-cm4 / pi-zero2) the Pi presents itself *as* a
USB audio device (a UAC2 gadget) so a host computer sees it as a soundcard;
`image/lib-boot-tree.sh` omits the `dwc2` overlay on pi3/pi5. The bare-metal looper hand-wrote this, and every
buzz/crackle bug in its history came from that code. aloop uses the Linux
**`f_uac2` configfs gadget** on the `dwc2` controller — the kernel lays out the
isochronous USB packets correctly by construction, deleting that entire class of
bug. This is the hardest single port, but it removes the most maintenance.

## Boot to appliance

Alpine boots **diskless from RAM** with a read-only root and only the services
aloop needs (the audio binary, `hostapd`/`wpa_supplicant`, RT tuning). No
desktop, no background daemons stealing cycles — near-bare-metal determinism.
The full startup order is in [`BOOT.md`](BOOT.md).
