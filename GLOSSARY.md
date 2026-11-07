# Glossary

Domain terms used throughout aloop, so the docs are self-contained.

- **Ableton Link** — a protocol/library that keeps the tempo, beat, and bar
  phase of musical apps and devices synchronized over a local network (UDP
  multicast). It syncs *timing*, not audio samples.
- **aloop** — this project: the looper migrated to Alpine Linux, now the
  codebase behind the MC-420.
- **ALSA** — Advanced Linux Sound Architecture; the Linux kernel audio API. aloop
  reads/writes audio through an ALSA PCM.
- **autoAP** — `src/net/autoap.sh` elects exactly one host for the single open
  `ticker` SSID by lowest MAC: a device runs as a WiFi *station* only when it sees
  a lower-key `ticker` BSSID, otherwise it hosts its own *access point* — even
  while another `ticker` network exists.
- **block / period** — the batch of audio samples processed at once. aloop uses
  64 samples at 48 kHz = a **1.333 ms** block; all per-block work must finish
  inside that budget.
- **Circle** — the bare-metal C++ framework the original looper runs on (no OS).
- **configfs** — a Linux kernel filesystem for configuring kernel objects at
  runtime; used to set up the USB gadget.
- **dwc2** — the USB controller on the Pi that supports device/gadget mode.
- **f_uac2 / UAC2 gadget** — the Linux function that makes the Pi present itself
  *as* a USB Audio Class 2 device (a soundcard) to a host computer.
- **Faust** — a functional DSP language that compiles to C++/LV2/etc. aloop's home
  effects are written in Faust.
- **ffunction** — a Faust mechanism to call an external C function; used to link
  the exact C++ pitch engine into the Faust chain.
- **fork-join** — running two tasks on two cores and waiting for both to finish
  within the same block. A `FEASIBILITY.md` design option for *parallel* effects,
  NOT implemented: the shipped worker processes all LV2 chains serially on one
  pinned core.
- **in-process host** — running plugins by calling their code directly inside
  aloop's own audio callback (as opposed to a separate graph-server process).
- **isolcpus** — a Linux boot parameter that removes CPUs from the general
  scheduler so only pinned threads run on them (used for the audio cores).
- **LV2** — an open standard plugin format (a `.so` + a `.ttl` metadata file).
  aloop's user effect and the resonode/pitchtracker/delayverb bundles are LV2;
  the loop engine is Faust compiled into the binary.
- **lilv** — the reference library for discovering and loading LV2 plugins.
- **MC-420** — the right-to-repair live-performance workstation this codebase
  implements: looping, polyphonic pitch-lock, Resonode, and the granulator, on a
  Pi 4 running Alpine with the stock `linux-rpi` kernel and userspace RT tuning
  (PREEMPT_RT is OPTIONAL, ADR-011).
- **mlockall** — a syscall that locks a process's memory into RAM so it never
  page-faults (page faults would blow the audio deadline).
- **Resonode** — the 4-voice, 16-mode-per-voice modal-resonator synth mode
  engaged instantly by SHIFT+tap on the LofiFx pad (edge-triggered, not a
  hold-duration gesture); excited by a blend of live input and its own internal
  mallet/bow exciter (`fx/resonode/input` defaults to 0.5), and replaces (never
  layers over) the dry signal while engaged.
- **PREEMPT_RT** — the Linux real-time preemption patch/config that bounds
  worst-case scheduling latency to the tens of microseconds. OPTIONAL here: ADR-011
  ships Alpine's stock kernel; `kernel/build-rt-kernel.sh` writes only a config
  fragment.
- **RP1** — the Pi 5 I/O controller; its IRQ handling breaks the audio-core
  isolation aloop relies on, which is why aloop targets Pi 4 (ADR-006).
- **SCHED_FIFO** — a Linux real-time scheduling policy; the audio threads run
  under it at high priority.
- **pitch-lock (multitranspose)** — the 6-voice polyphonic harmonizer (SHIFT +
  keybed) that locks the input's pitch to whichever keys are held, Whammy/
  Manipulator-style, replacing the original pitch rather than layering over it.
- **right-to-repair** — the MC-420's core design premise: the DSP algorithms are
  readable/editable Faust source (the granulator is C++ `Sampler`), four control
  bindings are a plain-text mapping in `config/controls.conf`, and the runtime is
  standard Linux — no sealed firmware blob or proprietary tooling gates modifying
  or repairing the instrument.
- **snapshot (double-buffered atomic)** — the lock-free handoff of Link session
  state: `LinkBridge` fills the inactive `LinkSnapshot` off-thread and flips an
  index, and `audioRead()` extrapolates the active one at session tempo. MIDI /
  knob values instead use `ParamStore`'s named `std::atomic<float>` slots. No
  locks, no tearing.
- **SPSC ring** — single-producer/single-consumer lock-free queue; a bare-metal
  concept. No audio work is dispatched between cores in `src/`: the only ring is
  `Sampler`'s volatile event queue, and the only lock-free cross-thread handoff
  is the double-buffered `LinkSnapshot`.
- **STA / AP** — WiFi *station* (client, joins a network) vs *access point*
  (hosts a network). autoAP elects between them by lowest MAC on `ticker`.
- **ticker** — the open SSID hosted by whichever device (aloop or the paired
  `esp-idf-link` ESP32 project) wins MAC-ordered host election, forming the
  ad-hoc mesh Ableton Link's multicast discovery needs.
- **UAC2** — USB Audio Class 2, the USB spec for audio devices.
- **xrun** — an audio buffer under/overrun: the audio thread missed its deadline
  and produced a glitch. The enemy. RT tuning exists to prevent xruns.
