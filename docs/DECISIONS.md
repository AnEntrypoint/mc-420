# Decision log (ADRs)

An append-only record of every non-obvious decision, with the rationale and the
**witnessed evidence** behind it — so insight is never lost as the build
progresses. New decisions append to the bottom. Each entry:

```
## ADR-NNN — <title>   (<date>, <phase/context>)
Decision: <what was decided>
Why: <the reasoning>
Evidence: <the witnessed fact — a file:line, a measurement, a doc reference>
Alternatives rejected: <what else was considered and why not>
Revisit if: <the condition that would reopen this>
```

The first block of ADRs is seeded from the feasibility study
([`FEASIBILITY.md`](FEASIBILITY.md)); everything after is decided during the build.

---

## ADR-001 — Target Alpine Linux + PREEMPT_RT on Raspberry Pi 4
Decision: Migrate the bare-metal Circle looper to Alpine Linux with a PREEMPT_RT kernel, on Pi 4.
Why: Linux gives a filesystem + dynamic linker (needed for hot-swappable LV2 effects) and a tested WiFi/USB stack; PREEMPT_RT keeps worst-case scheduling jitter in the tens of microseconds so 64-sample blocks survive; Alpine's diskless/RAM appliance mode gives near-bare-metal determinism.
Evidence: `FEASIBILITY.md` — the whole study; the four goals are impossible on bare metal (no filesystem/linker) but feasible on Pi 4 Linux.
Alternatives rejected: staying bare-metal (blocks hot-swap + carries the hand-rolled-driver maintenance); a full desktop distro (more background jitter than Alpine).
Revisit if: the project moves to Pi 5 (see ADR-006).

## ADR-002 — Effects are LV2 plugins hosted IN-PROCESS, never a JACK/PipeWire graph
Decision: `dlopen` the LV2 bundles and call `run()` inside aloop's own audio callback; do not use a graph host.
Why: A graph host schedules clients across period boundaries, adding one full audio period (~1.333 ms) of latency per hop — violating the no-added-latency goal. In-process calling adds zero latency.
Evidence: witnessed latency arithmetic (`FEASIBILITY.md`, Requirement 3): serial-in-process = 0 ms added; fork-join parallel = 0 ms; JACK graph = +1 period. Combined chain ~0.9 ms fits one 1.333 ms block.
Alternatives rejected: JACK2/PipeWire multi-client graph (adds a period); LV2 as just a static-linked struct with no swap (loses the moddability point).
Revisit if: the chain becomes CPU-bound beyond what fork-join across Core 1+3 can cover.

## ADR-003 — Reuse the dubfx verified Faust chain as the home-FX LV2
Decision: Package the dubfx Faust chain (pitch/delay/reverb/microrepeat/filters) with `faust2lv2` as the fixed home effects bundle; do not re-derive the effects.
Why: dubfx already reproduced looper's effects and A/B-verified them sample-for-sample against the real C++. That work is done and witnessed; reusing it is correct and saves rebuilding.
Evidence: dubfx `README.md` (10-preset A/B matrix, all pass); `faust2lv2` codegen witnessed producing a 69 KB LV2 architecture with LV2_Descriptor refs.
Alternatives rejected: rewriting the effects natively (wasteful; loses the A/B guarantee).
Revisit if: never — this is a strict reuse.

## ADR-004 — Live pitch = EngineSoladSnac (soladSnac), no signalsmith/RubberBand runtime dep
Decision: The live pitch stage links `EngineSoladSnac` (`soladSnacOctaver.h` + `grainFormant.h`) exactly as dubfx did via `ffunction`.
Why: looper's live pitch path uses ONLY EngineSoladSnac; the signalsmith/yinPsola/sincFormant engines are dead code removed from the wrapper. Matching looper means using soladSnac.
Evidence: `../looper/patches/RubberBandWrapper.h:10-17` — "ONLY EngineSoladSnac is in the live pitch path. The former embedded signalsmith / yinPsola / sincFormant engines were dead members."
Alternatives rejected: using signalsmith/RubberBand (not what looper ships; would change the sound).
Revisit if: looper's live pitch engine changes.

## ADR-005 — Ableton Link via the official library, over UDP
Decision: Delete the hand-rolled raw-Ethernet Link clone; use github.com/Ableton/link over ordinary UDP multicast 224.76.78.75:20808.
Why: The bare-metal clone existed only because there was no IP stack. Linux has one, so the maintained library is correct, RT-safe, and interoperable. It maps onto the same lock-free snapshot handoff the looper already used.
Evidence: `FEASIBILITY.md` R1; looper's clone (`abletonLink.cpp`, 938 lines) is pure overhead on Linux; Ableton Link's `captureAudioSessionState` is RT-safe.
Alternatives rejected: porting the raw clone (maintenance burden, no benefit).
Revisit if: never (the library is the standard).

## ADR-006 — Pi 4 only; Pi 5 reopens the no-glitch guarantee
Decision: Target Pi 4. Treat Pi 5 as out of the current guarantee.
Why: The no-glitch guarantee depends on steering WiFi/network IRQs off the audio core. Pi 4 allows this; Pi 5's RP1 I/O controller has `PF_NO_SETAFFINITY` on force-threaded IRQ handlers, so those IRQs cannot always be moved.
Evidence: `FEASIBILITY.md` Pi-4-vs-Pi-5 caveat; raspberrypi/linux#7301.
Alternatives rejected: targeting Pi 5 now (risks R1's no-glitch claim without a mitigation).
Revisit if: the project must run on Pi 5 — then investigate RP1 IRQ handling / a mitigation before promising no-glitch.

## ADR-007 — WiFi = autoAP mode-switching (STA-or-AP), not simultaneous AP+STA
Decision: Try station mode; host an AP only when no known network is available; switch back when one returns.
Why: The requirement is "AP when external unavailable" = mode-switching, a solved pattern. Simultaneous single-radio AP+STA is flaky on the Pi (`nl80211: Could not configure driver mode`).
Evidence: `FEASIBILITY.md` R4; looper already implements join-first-then-fallback-to-AP (`kernel.cpp:85-169`); the autoAP project.
Alternatives rejected: simultaneous AP+STA on one radio (flaky). If ever truly needed → USB WiFi dongle for a second radio (documented, not built).
Revisit if: a use case genuinely needs the Pi on home WiFi AND hosting a Link AP at the same time.

## ADR-008 — USB audio via kernel f_uac2 configfs gadget
Decision: Replace looper's hand-rolled UAC2 gadget (`dwusbgadget.cpp`) with the Linux `f_uac2` configfs gadget on dwc2.
Why: The kernel lays out isochronous USB packets correctly by construction, deleting the entire class of microframe-corruption bugs looper had to fix by hand. It is the hardest port but removes the most maintenance.
Evidence: `FEASIBILITY.md` USB section; looper's buzz/crackle history all traced to the hand-rolled decode.
Alternatives rejected: porting the hand-rolled gadget (carries the bugs forward).
Revisit if: f_uac2 cannot hit the latency target on-hardware (then measure and tune, don't revert).

## ADR-009 — Hardware-dependent verification is honestly marked, never faked
Decision: Rows that need a real Pi 4 to *measure* (RT jitter via cyclictest, f_uac2 round-trip latency, on-air Link no-glitch, AP multicast) are marked `blockedBy: [external, no-Pi4-in-session]` with the exact on-hardware test documented — never resolved as done from a dev host.
Why: A measurement claim without the measurement is false completion. The build (code/config/CI/docs) is fully reachable now; only on-device numbers are external.
Evidence: gm false-completion rule; these rows cannot be witnessed without hardware.
Alternatives rejected: asserting the numbers from analysis (dishonest).
Revisit if: a Pi 4 becomes available in-session — then run the documented tests and resolve with real output.

## ADR-010 — Loop engine is a Faust rwtable ring with independent read/write heads (TRUE varispeed); mark-point playhead remains rejected
Decision (superseded from the original `de.fdelay` design, see history below): each of the 20 loopers is now a `rwtable`-based ring (`dsp/loop.dsp`'s `oneLooper`) with a monotonic WRITE index (reset at ARM, counts up freely during recording, bounded by `MAXLEN`) and a genuinely INDEPENDENT fractional READ accumulator (`readPos ~ _`, advancing by `effSpeed` samples-per-sample, linearly interpolated between two `rwtable` reads) — this is what makes real tape-style pitch+duration varispeed possible (the manual half/double-speed buttons and Ableton Link tempo tracking both drive `effSpeed`). `wrapLen` (the loop-length modulus shared by both read and write) latches from the write index's own value at the FINISH edge (recording stop), not from any externally-supplied length at ARM — this avoids a cross-thread race with the native shell's post-hoc length computation. A SEPARATE buffer+playhead design with an ADDRESSABLE read head (for the hardware's mark-point commands, not for varispeed) was attempted and rejected — see Evidence.
Why: The original `de.fdelay` delay-ring design could only vary LOOP LENGTH (which changed duration but not pitch) — it had no independent read/write heads, so it could not do real varispeed. The rwtable redesign (this session) replaces it specifically to enable genuine pitch-changing playback, matching `../looper`'s actual `m_playPos`/`m_playRate` mechanism. The READ side only ever READS the table (two arbitrary-index lookups, floor/ceil for interpolation) and never writes back near where it read — this is NOT the same read-modify-write class that blocked the earlier addressable-mark-point playhead attempt (which needed to read a value and write the SAME read-back value into the SAME cell, to let a loop survive un-rewritten while not recording).
Evidence: rwtable-based TRUE varispeed compiled clean via CI (Faust `-lang cpp` codegen, e.g. run 29451659654) and is deployed + live-verified on hardware this session (status.json: `xruns:0`, `eff_speed` present and tracking manual/Link speed). Two real Faust compile failures were hit and fixed DURING this redesign, both genuine mutual-recursion issues (not the RMW class): `endless evaluation cycle of 19 steps` when `wrapLen`'s finish-latch and `writeIdx`'s idle branch referenced each other circularly — fixed by making `writeIdx`'s idle state simply hold its last value instead of wrapping modulo `wrapLen` (commit `913ed1e`). The EARLIER, separate mark-point-playhead attempt still failed for the ORIGINAL reason: 4 witnessed CI faust-codegen failures (`loop.dsp:75 syntax error`, `stack overflow in eval` rp↔mark mutual recursion twice, `endless evaluation cycle of 8 steps` on the write-back RMW) — see `.wfgy/lessons.md` (2026-07-12 Faust-recursion lesson).
Consequence: mark-point / immediate-retrigger (0x08–0x0A) is STILL the one loop command family not reproduced — a deliberate, documented model difference (COMMAND-SURFACE.md), not a silent drop, and this remains true even after the rwtable migration (the migration was for varispeed, not for mark-point). Every other command maps 1:1, including TRUE varispeed (pitch+duration change together) which the old delay-ring design could never provide.
Alternatives rejected: (a) an ADDRESSABLE preserve-on-hold mark-point playhead — still infeasible in pure Faust (the genuine RMW cycle, distinct from this ADR's own rwtable varispeed reads); (b) implementing the loop buffer in native C++ instead of Faust — reintroduces hand-written DSP maintenance, defeating the single-Faust-program design (ADR-001) and the user's standing directive to keep all DSP in Faust; (c) claiming mark-point works — false completion.
Revisit if: a future Faust release supports a write-enable / RMW-safe table primitive, OR the mark-point behavior becomes a hard requirement (then the loop buffer moves to native C++ as a scoped, deliberate exception with its own ADR).

## ADR-011 — Ship the flashable image with the stock Alpine kernel; PREEMPT_RT is an on-hardware optimization
Decision: The `aloop-pi4.img` ships Alpine's stock `linux-rpi` kernel (from the Alpine RPi tarball) plus the full userspace RT tuning (isolcpus/nohz_full/rcu_nocbs/threadirqs in cmdline.txt + SCHED_FIFO + pinned affinity + mlockall). Building a PREEMPT_RT kernel (`kernel/build-rt-kernel.sh`) is an OPTIONAL step taken only if on-hardware measurement shows the stock kernel misses the 64-sample no-xrun target.
Why: The user's goal is to test from a card. A bootable image with the stock kernel + full userspace tuning boots and is testable TODAY, and running it is precisely how we measure whether the stock kernel already suffices. Gating card-testing on a ~30-min CI cross-compile of an RT kernel — which itself can't be validated without the hardware we're trying to reach — inverts the honest order. Ship + measure first, optimize second.
Evidence: `kernel/build-rt-kernel.sh` writes the RT config fragment (PREEMPT_RT, NO_HZ_FULL, f_uac2/dwc2, HZ_1000) but does not build a kernel; the stock kernel ships in the tarball the image builder extracts; RT-TUNING.md documents the userspace knobs that apply regardless of kernel.
Consequence: first-boot latency is whatever the stock kernel + tuning delivers — measured by `test/hardware/test-rt-jitter.sh` (shipped on the device). If it misses, build the RT kernel and re-flash; the fragment + cross-build recipe are ready.
Alternatives rejected: (a) block the flashable image on a full RT-kernel CI build (inverts ship-then-measure; unverifiable without hardware); (b) claim RT latency without measuring (false completion, ADR-009).
Revisit if: on-hardware RT-jitter measurement misses the target → run the RT-kernel build and fold it into the image.

## ADR-013 — The Faust home DSP struct is heap-allocated in the audio worker thread, never stack-local
Decision: `worker()` (src/dsp/audio_thread.cpp) allocates `AloopLoopDsp` via `std::make_unique<AloopLoopDsp>()` at thread startup, binding a reference alias for the rest of the function. It is never declared as a plain stack-local (`AloopLoopDsp faustHome;`).
Why: `sizeof(AloopLoopDsp)` is 336,326,896 bytes (~320 MiB) — the 20 loopers' `MAXLEN = 48000*60` (60s) delay-line buffers dominate. As a stack-local inside a pthread's entry function, no thread stack size is large enough to hold it; a real, reproducible SIGSEGV was witnessed on a real Pi 4 at `setRealtimeSelf`'s very first prologue instruction. The heap allocation happens once at thread startup, never in the per-block RT hot path, so it carries none of the "no allocation in the audio callback" real-time risk the rest of this file is written to avoid.
Evidence: `gdb` (debug build, `-g -O0`, unstripped, built via a temporary CI job) against a real core dump: `print sizeof(AloopLoopDsp)` → `336326896`. Two prior hypotheses were tested and disproven first via live core-dump analysis: an explicit 8 MiB pthread stack (still crashed, identical offset) and a memlock/`ulimit -l` fix (crashed identically even with `ulimit -l unlimited` applied interactively). Fix verified live: `rc-status` shows `aloop [started]` (not crashed) staying up, `/var/log/aloop.log` shows a full clean startup, and a live UDP telemetry query returns real engine state.
Consequence: any future Faust-generated struct added to the home stack must be checked for size before being declared as a local; if it is more than a few KB, heap-allocate it the same way.
Revisit if: the loopers' buffer sizing changes enough that stack allocation becomes plausible again (it will not — 20 loopers × 60s × 48kHz float buffers is inherent to the design, not incidental).

## ADR-014 — ALSA PCMs are opened with explicit hw_params/sw_params against a stable device name, never "default" + convenience latency API
Decision: `audio_thread.cpp` opens its wire audio devices by stable name (never ALSA's `"default"` PCM). hw_params are set explicitly (`period_size` = `block_size` exactly on the instrument device) instead of via `snd_pcm_set_params()`'s convenience latency argument. sw_params explicitly sets `start_threshold` to one period on both capture and playback. The f_uac2 gadget's own `req_number` (isochronous USB request queue depth) is raised from the kernel default of 2 to 4 in `src/usb/f_uac2-gadget.sh`.
Why: `"default"` is ambiguous without a shipped `/etc/asound.conf` (this device has multiple real ALSA cards — an instrument audio interface, a MIDI controller, and the OTG gadget — plus dmix/dsnoop's own large fixed period on top), and `snd_pcm_set_params(..., latency_us)` picks whatever period/buffer satisfies a requested LATENCY NUMBER, not the configured `block_size` — the as-shipped code requested 20ms, ~15x the intended 1.33ms. Separately, the hw_params-default `start_threshold` for a from-scratch-configured playback stream is the full buffer size, but a loop that only writes one period per `snd_pcm_writei()` call before blocking on the next capture read never crosses that default threshold, so the stream stays permanently `PREPARED` (never actually running) while capture (whose default threshold is 1 frame) runs fine — the two streams silently desync.
Evidence: all fixes were witnessed live on a real Pi 4 via SSH — `/proc/asound/.../hw_params` showing `period_size:64` (matching `block_size`) after the device+hw_params fix (was an unpinned ~20ms request before); `/proc/asound/.../status` showing `state: PREPARED` (stuck) for playback before the sw_params fix, `RUNNING` after; `/sys/kernel/config/usb_gadget/aloop/functions/uac2.0/req_number` reading `4` after the gadget-script fix (was kernel default `2`). A live diagnostic build (temporary `fprintf` logging on `snd_pcm_readi`/`writei` error codes, since removed) confirmed a residual xrun source was `-EIO` with a frozen `hw_ptr` on the gadget's PCM specifically — traced to no host application actively streaming audio through the gadget device at verification time (confirmed with the user directly), i.e. expected idle-USB-audio-class behavior, not a code defect. This diagnosis was BEFORE ADR-015 corrected which physical device is actually the primary DSP I/O — see ADR-015 for why the gadget was never the right primary target to begin with.
Consequence: any future change to `block_size` in `aloop.conf` automatically re-derives the ALSA period without further tuning (the hw_params call always targets `N = block_size` frames exactly). If a different or newer UAC2-class device is ever substituted, re-verify `req_number` and the sw_params thresholds against it — these are values tuned against THIS gadget driver's specific behavior, not universal constants.
Revisit if: a future USB audio gadget driver changes its own internal buffering defaults, or block_size is lowered enough that the gadget mirror's buffering stops being sufficient against real-world USB scheduling jitter (re-measure xruns with an actual host audio session running, not an idle default-device check).

## ADR-015 — Two distinct ALSA devices: the real instrument USB audio interface (primary, tight-latency) and the OTG gadget (mirror, best-effort)
Decision: `audio_thread.cpp` opens TWO separate ALSA devices, matching `../looper`'s architecture exactly: `instrumentDevice` (`aloop.conf [audio] instrument_device=`, default `hw:0,0` — the real USB audio interface an instrument/mic plugs into, e.g. the M-Audio AIR 192|4) is the primary capture+playback path the Faust engine reads from and writes to every block, blocking, tight-latency (matching `block_size` exactly, ADR-014). `audioDevice` (`aloop.conf [audio] audio_device=`, default `hw:UAC2Gadget,0` — the f_uac2 OTG gadget) is opened `SND_PCM_NONBLOCK` and written to as a best-effort MIRROR of the same processed output after the instrument-device write, with a looser period/buffer (4x block_size) and silent absorption of `-EAGAIN`/errors — it can never stall, desync, or degrade the instrument device's real-time path.
Why: an earlier version of this code (before this ADR) opened ONLY the OTG gadget as the sole audio device — meaning the real instrument USB audio interface was NEVER read from or written to at all, and the user's reported "no audible sound" / "no passthrough from input to output" was because the actual instrument input was never being captured. Deep research into `../looper`'s reference implementation (`patches/input_usb.cpp`, `output_usb.cpp`, `output_otg.cpp`) confirmed the real architecture: `AudioInputUSB`/`AudioOutputUSB` (the USB-HOST audio class driver talking to the real external interface) are the graph's ONLY real `AudioConnection` input/output nodes; `AudioOutputOTG`/`AudioInputOTG` are NOT audio-graph nodes at all — they are passive tap/inject shims that read/write the SAME ring buffers via independent cursors with deliberately looser latency targets (looper: `OTG_LAG_TARGET=384` samples vs the real device path's `OUT_RD_TARGET=96`, a 4x headroom difference), because OTG's job is only to mirror audio to/from whatever host computer is on the cable, not to be the real-time-critical path.
Evidence: `/proc/asound/card0/stream0` (the AIR 192 4) showed `Status: Stop` on both playback and capture before this fix, confirming it was never opened. `../looper` source citations: `input_usb.cpp:206` (`AudioInputUSB::inHandler`, the real capture path), `output_usb.cpp:188` (`AudioOutputUSB::outHandler`, the real playback path), `output_otg.cpp:6-16` + `output_usb.cpp:63` (`AudioOutputUSB_tapOTG`, the passive OTG mirror reading the same ring with an independent, longer-lag cursor), `audio.cpp:147-148` (only `input`/`output` — the real USB-audio-interface objects — get `AudioConnection`s in the graph; the OTG objects do not).
Consequence: `aloop.conf`'s `instrument_device=` must be pinned correctly for the physical hardware in use (default `hw:0,0` assumes the instrument interface enumerates before the gadget, true when the gadget is `UAC2Gadget` and not a numbered `hw:N`). If the instrument interface fails to open, audio stays down entirely (matching the pre-fix retry/backoff behavior) since it is now the primary path — the gadget mirror failing to open is silent-degrade-only and never blocks startup.
Revisit if: a setup exists with no instrument USB audio interface at all (headless/OTG-only operation) — then `instrument_device=` would need an explicit "none" mode that falls back to the gadget as primary, which does not exist yet because no such deployment has been described.

## ADR-012 — Sampler (chromatic + drum-record) ported as a bounded native C++ module, not folded into the Faust home stack
Decision: looper's sampler subsystem (`patches/sampler.h`: note 65 held records ONE shared chromatic sample played back pitched per keybed key; note 66 held arms drum-record-mode, each keybed key recording into its OWN independent one-shot slot) IS reproduced in aloop, per explicit user request superseding this ADR's original "not ported" decision. `sampler.h` was already written as a bare-metal-independent, portable C++ class (no Circle/loopMachine/masterPhase dependency) — ported near-verbatim to `src/dsp/sampler/sampler.h`, renamed `Sampler`/namespaced `aloop`, otherwise byte-for-byte identical algorithms/constants.
Why: aloop's home stack is ONE shared Faust program (ADR-001's single-compile design) built around the 20-looper engine (`loop.dsp`), each looper being one feedback-delay ring bound to a fixed control group (`looper%2i/rec` etc, generated once via `par` at compile time). Drum-record-mode needs a DIFFERENT, independently-addressable per-key sample store (25 keybed keys, each its own record/play slot, unrelated to the 20 loopers) — a second, structurally distinct engine. Folding it into Faust (a second `par`-generated bank of 25 one-shot rings) would be a state-machine misfit (arm-then-record-one-shot vs the loopers' continuous record/play) forced through a compile-time-fixed abstraction that doesn't naturally express it. The originally-rejected alternative (b) — native C++ sample storage — is instead the RIGHT fit: `Sampler` is a genuinely separate, small, self-contained module (like the LV2 host, ADR's own suggested "revisit" path), not a violation of ADR-001 (which is about the DSP *effects/loop* signal path staying one Faust compile, not a blanket ban on any native C++ subsystem existing alongside it).
Evidence/implementation: `Sampler` is heap-allocated in `worker()` (`audio_thread.cpp`, same reasoning as `AloopLoopDsp`'s heap move, ADR-013 — its ~5.3MB of internal buffers are worth keeping off the thread stack) and published via a module-level `g_sampler` pointer, exposed through `AudioThread::sampler()` so the MIDI/control thread can push events (`ApcGrid`'s new `onSamplerBtn65Press/Release`, `onSamplerBtn66Press/Release`, `onKeybedNoteOn/Off` methods, `src/control/apc_grid.h/.cpp`) via the SAME lock-free SPSC event ring `sampler.h` already implements — no new cross-thread primitive needed. Per `sampler.h`'s own load-bearing invariant, `captureBlock`/`renderInto` run in `worker()` on the DRY input snapshot (`fin[]`) BEFORE the loop engine/effects chain (`faustHome.compute`), so sampler audio is recordable by a loop (under SHIFT fold) and receives the full effects chain exactly as looper's `renderInto`-before-the-chain ordering requires.
Consequence: `config/controls.conf`'s previously-unbound note-65/66/keybed range is now live. Every APC Key25 gesture from `docs/COMMAND-SURFACE.md` now maps 1:1 to looper except mark-point restart / loop-immediate (ADR-010, a genuine Faust-model limitation unrelated to the sampler).
Alternatives considered: (a) reusing `oneLooper` for one-shot sample slots — rejected, wrong state machine; (c) leaving it undocumented/unimplemented — rejected per explicit user direction that no reachable scope stays undone.
Revisit if: sampler audio needs to interact with microrepeat/varispeed in ways `sampler.h`'s independence-from-the-loop-engine design doesn't anticipate — not expected given looper's own design keeps them decoupled too.

## ADR-016 — Resonode engagement crossfades the WHOLE dry/pitch-lock term against the resonator output, never sums into dry upstream
Decision: `effects_runtime.dsp` gates Resonode via a `checkbox("fx/resonode/engaged")`-driven smoothed `resonodeEngageGate` that crossfades `(pitchStage(dry)*dryGate + dryWet)` against `resonodeOut` immediately before the shared `microStage:filterStage:delayStage:reverbStage` tail, rather than summing `resonodeOut` into `dry` upstream of that machinery and letting the existing dry-passthrough gates (keyed only to the multitranspose voices) decide what's audible.
Why: the original implementation summed the resonator's output into `dry` and ran the combined signal through the unchanged pitch-lock dry-passthrough gate, which is driven only by multitranspose voice gates — the resonator engaging never touched it, so raw dry (and `harmonize`'s own separate dry-passthrough term) stayed fully unmuted the entire time it was held. Audible result: the button engages the resonator, but the ordinary pass-through signal is still there too — exactly the failure mode ADR-004-adjacent "locked pitch must replace, never layer over, the original" rule already named for the transpose engine, just never extended to this instrument when it was added.
Evidence: verified via the DawDreamer JIT harness (`pitch.dsp` stubbed to a bare passthrough): engaged + a held voice decorrelates the output from the raw dry input (r≈0.07 vs r≈0.997 disengaged) while producing real excited-resonator amplitude; engaged with no voice held decays to near-silence within one `si.smoo` time constant of the engage edge. At `RESONODE_ENGAGED=0` the new formula is bit-for-bit the pre-fix formula (the resonator's output is silent there anyway, since voices are never gated unless the instrument is engaged), so the disengaged path has zero behavioral change.
Alternatives rejected: keeping the sum-into-dry topology and adding the resonator's own gate as a second independent multiplier alongside the multitranspose gate — rejected per the same reasoning ADR-004's sibling rule (loop-side "one gate, never two independently-paced ones") already established: two independently-smoothed gates racing during a transition produces a real audible hump, not a clean crossfade.
Revisit if: a future voice engine needs to coexist with both the resonator and multitranspose active simultaneously in a way this single shared crossfade point can't express — not currently needed, the two are mutually exclusive via the bank-select mechanism.

## ADR-017 — Granulator knob slots are 6 named-patch blend weights (convex combination), never 6 raw grain parameters
Decision: `ApcGrid::applyGranulatorMorph` treats each of the 4 LofiFx-bank patch knob slots as the blend weight of one of 4 fixed named grain patches (Glass/Cloud/Chop/Shatter — each a full point in grain-size/density/pitch-spray/position-jitter/scan-rate/reverse-probability/envelope-shape/live-source space), normalizes the weights to sum to 1, and pushes the single resulting blended point into `Sampler::setGrainPatch` via one atomic call.
Why: an earlier design mapped the 6 knobs 1:1 onto 6 independent raw grain parameters. Turning multiple knobs to their extremes simultaneously produced an incoherent, un-musical result — the parameters fight each other with no relationship to a real texture. Named patches give every knob position a musically-intentional destination; blending is a convex combination so any point in the 6-simplex is a coherent midpoint texture, and all-max is still a bounded, sane blend rather than the sum of six maxed-out raw parameters.
Evidence: the previous per-setter design (six independent raw setters) let a caller apply a partial/inconsistent blend mid-update; the new design recomputes derived state exactly once per morph via the single atomic `setGrainPatch` call. Grain-density gain compensation (`Sampler::m_grainGainComp`, `1/sqrt(max(1, grainMs*0.001*grainRateHz))`) is recomputed only when the blend changes (a knob turn), never per-note or per-active-voice-count, specifically to avoid the "dynamic `1/sqrt(activeVoices)` pumps because it renormalizes against a count that changes on every note-on/off mid-sustain" anti-pattern already named for multitranspose's own gain staging.
Alternatives rejected: 6 raw sliders (incoherent at extremes, the original problem); a dynamic per-active-voice gain renormalization (would pump, same anti-pattern class as multitranspose's rejected alternative).
Revisit if: a 7th genuinely distinct grain character is needed — add a 7th named patch to the table rather than exposing a new raw parameter.

## ADR-018 — Resonode voice-steal synthesizes a one-sample gate dip plus a frequency glide, rather than reassigning note/gate directly
Decision: `allocateResonodeVoice`'s steal path (reassigning a held voice's `fx/resonodevoice{v}/note` to a new key while `gate` stays at 1.0 throughout) is paired with two Faust-side additions in `resonode_synth.dsp`: `stealEvent`/`retriggerGate` (a synthetic one-sample gate dip exactly on the steal instant, so `pm.strike`'s and the wash's envelopes see a genuine rising edge and re-fire) and `freqGlide` (a one-pole glide to the new frequency over ~10ms on a steal, snapping instantly on a genuine fresh onset).
Why: WITNESSED via the DawDreamer JIT harness that a steal with no correction produced two real defects: no fresh strike (both envelopes key off a literal gate rising edge, and a gate that never drops never re-fires either), and a real click (`pm.modeFilter`'s biquad coefficients jump in one sample under the frequency change, reusing stale internal state under abruptly different coefficients — measured derivative 0.057, over 2x a genuine fresh strike's own onset derivative of 0.026).
Evidence: with both fixes applied, the steal-instant peak derivative (0.34–0.41) matches a constructed reference of two legitimately overlapping strikes (0.34–0.63) rather than the pre-fix silent-pitch-jump artifact. Every idle/fresh-onset/sustain/release/4-simultaneous-voice scenario renders bit-exact (or within float32 rounding) against the pre-fix DSP — both additions are no-ops outside the steal case specifically.
Alternatives rejected: forcing a real 0→1 gate edge from the control thread via a deadline-release mechanism (the "every momentary Faust gate must be explicitly released" pattern) — rejected as unnecessary complexity when the Faust-side synthetic-dip approach solves it with no cross-thread timing coordination needed.
Revisit if: a future voice-stealing instrument needs the steal to sound like a genuinely distinct new attack rather than an overlapping-strike continuation — not the design intent here.

## ADR-019 — Grid-beat visualization reads live DSP-derived beat index, never a separately-tracked UI counter
Decision: `AudioThread::Telemetry::gridBeatIndex` (0–15, or -1 with no master phrase established) is computed directly from `masterPhaseSamples`/`masterLen` — values the audio thread already tracks for loop quantization — and read by `apc_leds.h`'s rendering logic on the 4 dedicated top-right pads, wired through every `midi.cpp` `refresh()` call site.
Why: matches the project's existing "master phrase length comes from writeIdx telemetry, never wall-clock" discipline (see AGENTS.md's Control Surface section) — a separately-tracked UI-side beat counter would drift from the real DSP-side phrase position under any tempo change or Link resync, the same class of bug that discipline already exists to prevent elsewhere.
Evidence: verified via a standalone compiled+run C++ test covering all 16 beat indices plus the -1 (no master phrase) case, confirming correct cumulative fill (blank→yellow→red→green) behavior at each index.
Alternatives rejected: a separate wall-clock-driven LED animation counter — rejected on the same grounds the master-phrase-length rule already rejects wall-clock-derived timing anywhere near the loop-quantization system.
Revisit if: never — this is the same established pattern applied to a new UI surface, not a new tradeoff.

## ADR-020 — `effects_runtime.dsp`'s `REVAMT` UI ceiling is 2.0, not the ported `reverb.dsp`'s own 1.0
Decision: `effects_runtime.dsp`'s `REVAMT = hslider("REVAMT", 0.0, 0.0, 2.0, 0.001)` exposes a 0–2.0 range to the control map even though `effects/home/faust/reverb.dsp`'s own verified/ported formula (`reverb(amt,t,x) = x + revL*amt*0.25`) is untouched.
Why: direct user request for more reverb wet mix than the original hardware's UI ceiling allowed. Widening the range at this runtime-control wrapper layer (not the hardware-parity-ported DSP itself) simply lets `amt` scale past 1.0 into the same linear formula — nothing about the verified math changes below `REVAMT<=1.0`, so hardware parity there is unaffected.
Evidence: `reverb.dsp`'s formula is a plain multiply with no internal clamp, so doubling the exposed ceiling is a pure UI-range change, not a DSP change.
Alternatives rejected: raising the ceiling inside `reverb.dsp` itself — rejected, that file's contract is hardware-parity-verified and the extra range is a UI-only extension, not a hardware behavior.
Revisit if: never — this is a settled UI range, not an open question.

## ADR-021 — Home effects chain order is glitch(microrepeat) -> filter -> delay -> reverb
Decision: `effects_runtime.dsp`'s `mainOut = preChain : microStage : filterStage : delayStage : reverbStage`.
Why: two direct user corrections, in order. Original (pre-session) order was pitch -> delay -> reverb -> micro -> filter. First correction moved `filterStage` before `delayStage`/`reverbStage` so that turning the filter shapes what feeds the reverb/delay tails, not just the dry/direct signal (order became pitch -> filter -> delay -> reverb -> micro). Second correction, from the user's own words ("filter isnt applying to glitch, glitch should be before filter" and "glitch, once filtered, should feed into delay and reverb"), moved `microStage` before `filterStage` — glitch content must itself be filterable, which it was not when filter ran first.
Evidence: both corrections came directly from the user after listening to the live device; no numeric measurement applies to chain ORDER (it is an audible mix-bus topology decision, not a parity/CPU question).
Alternatives rejected: both earlier orderings (pitch->delay->reverb->micro->filter, and pitch->filter->delay->reverb->micro) — both superseded by direct user correction.
Revisit if: a future effect stage is added and its natural position in the signal path is ambiguous — ask the user rather than guessing an order.

## ADR-022 — Objekt renamed to Resonode; expanded to 6 modes/voice with real per-note velocity, patches re-swept on the new DSP
Decision: `objekt_synth.dsp` (and every "Objekt"-named C++/doc reference) is renamed to `resonode_synth.dsp` / "Resonode" — a name describing what it structurally is (a physical-modeling modal-resonator instrument), with no reference to Reason Studios' commercial "Objekt" product anywhere in the tree. The DSP itself gained two real capabilities in the same pass: the mode bank grew from 4 to 6 modes per voice (mode5/mode6, same strength-reduced-`pow()`/alias-guard pattern as modes 2-4), and a genuine per-voice MIDI-velocity input (`fx/resonodevoice{v}/vel`, plumbed from `onKeybedNoteOn`'s existing `vel` parameter through `dsp/aloop.dsp`/`effects_runtime.dsp`) scales each voice's exciter gain. The four named morphing patches (Percussive/MetalGlass/Strings/DanceBass) were RE-SWEPT from scratch against the new 6-mode DSP rather than assumed unchanged, since adding two modes measurably changes the acoustic result at any fixed (position,decay,damping,stretch) point — the re-sweep's own empirical answer, not an assumption either way, is what settled it: the top pick for all four target directions landed on the EXACT SAME grid point as the original 4-mode sweep (`kResonodePatches` needed zero numeric changes), because all four target directions are dominated by pushing decay/damping/position/stretch to a grid extreme, and the two added lower-weighted modes shift absolute feature values without changing which corner wins.
Why: the rename was requested directly (no product-name references, since this is an independent implementation, not a port of Reason's proprietary DSP). The mode/velocity expansion was scoped by what genuinely improves performative closeness to a physical-modeling resonator instrument without abandoning the two already-settled hard constraints: mic-only excitation (no synthetic strike) and the Pi 4 CPU budget. A velocity-driven exciter-BRIGHTNESS coupling (multiplying the exciter's pre-resonator lowpass cutoff by a per-voice velocity term) was implemented, measured, and then REJECTED before shipping: it defeated Faust's cross-voice common-subexpression sharing of the lowpass coefficient computation (all 4 voices previously computed `fi.lowpass(2, tone)` against the IDENTICAL `tone` signal, letting the compiler share that coefficient computation once; giving each voice a unique `tone*brightnessMul(velN)` argument forced 4 independent coefficient computations instead of 1), nearly doubling total render cost for a change that measured as acoustically negligible (spectral centroid within 2% across vel 0.2/0.6/1.0, since the resonator bank's own mode-frequency selectivity dominates timbre far more than the pre-filter cutoff — the same root cause already named in the tone-taper fix below). Velocity-driven GAIN (a plain multiply on the exciter's envelope output, independent of any shared filter coefficient) was kept: cost-neutral and produced a real, large loudness range (rms 0.222/0.415/0.504 across vel 0.2/0.6/1.0).
Evidence: DawDreamer JIT render-time A/B (12s render, x86_64, NOT `faust2bench`, NOT real Pi 4 hardware — a proxy only): old 4-mode/no-velocity median 0.153s; new 6-mode+velocity-gain-only median 0.286s (~1.86x); the rejected brightness-coupling variant measured 0.597s (~3.9x) for the same feature set, confirming the CSE-defeat hypothesis by isolating each contributing change independently (6-mode alone: ~1.98-2.15x; +velocity-gain-only: no further increase; +velocity-brightness-coupling: the extra ~2x on top). `test/resonode-sweetspot/verify_musical_controls.py` gained four new checks (`velocity_response`, `silent_without_live_input`, `new_mode_alias_guard`, `voice_steal_with_velocity_change`) alongside the three pre-existing ones (`tone_taper`, `morph_glide_click`, `no_fadein_regression`) — all seven pass against the shipped 6-mode+velocity-gain DSP. The patch re-sweep reused `sweep.py`'s existing 625-combo grid-search + `select_patches.py`'s empirical scoring methodology unchanged, adapted only for the renamed zones and the extra `vel` channel.
Alternatives rejected: keeping the tone-brightness velocity coupling despite its cost (rejected — no CPU-optimization justification for a change whose own measured acoustic effect was negligible); increasing voice count (4->6) instead of/in addition to mode count (rejected — voice count multiplies the WHOLE per-voice cost including the exciter and envelope stages, not just the mode bank, and 4 voices already matches the keybed-driven steal-allocator's established shape); assuming the old picks were still optimal without re-running the sweep, OR assuming they must have changed and hand-picking new values by ear/analogy (both rejected — the whole point of the empirical sweep methodology from the original patch selection is to not trust an assumption in EITHER direction about a parameter space that measurably changed; only re-running it settles the question).
Revisit if: real Pi 4 `faust2bench`/on-hardware `core_busy` measurement (not available in this sandbox) shows the 6-mode expansion pushes Core 1 over budget — the next lever is dropping mode6 alone (the smallest-weighted, least structurally important addition) rather than reverting the whole expansion.

## ADR-023 — LofiFx granulator latch flips on PRESS, not on release-if-quick-tap
Decision: `ApcGrid::onLofiFxPress` now toggles `m_granulatorLatched` (and applies it via `setGranulatorEnabled`) immediately on the press edge, unconditionally, every press. `onLofiFxRelease` no longer classifies press duration into "tap" (toggle) vs "hold" (no toggle) — it only handles the Resonode-disengage cleanup and bank revert. The 1-second Resonode-engage threshold in `pollHolds` is unchanged. `docs/demo/faust-engine.js`'s browser-demo mirror got the identical change for consistency.
Why: requested directly — pressing the button should latch the granulator instantly rather than waiting to see whether the press turns into a quick tap or a hold. This also simplifies away the previous design's "force-enable the granulator preview on every press regardless of latch state, then restore the latched state on release" workaround (see the pre-existing "LofiFx/granulator button" entry below, now updated in place) — that workaround existed specifically to make a tap's eventual texture audible from the first sample even though the latch decision only happened at release; once the latch decision itself happens at press, the workaround is no longer needed.
Evidence: reasoned through directly (this is a pure control-surface timing change, not a numeric DSP question) and cross-checked against every other consumer of `m_granulatorLatched`/`granulatorHeld`/`resonodeEngaged` state in the tree (`apc_leds.h`'s LED feedback block, `docs/demo/faust-engine.js`, `docs/demo/index.html`'s UI hint text) to confirm none of them assumed the old release-classified-toggle timing.
Alternatives rejected: keeping the toggle at release but shortening `kGranulatorTapMs` (rejected — doesn't address the actual ask, which is about press-vs-release timing, not tap-duration threshold); making every press force the latch ON rather than toggling it (rejected — a toggle preserves the ability to turn the granulator back off with a second press, matching the previous tap-to-toggle gesture's actual capability, just moved earlier).
Revisit if: real hardware testing shows a press that's about to become a 1-second Resonode hold audibly and distractingly flips the background granulator on/off at the same instant — the lever then would be suppressing the toggle specifically on presses that go on to cross the Resonode threshold, at the cost of the latch decision no longer being knowable at press-time (it would have to wait to see whether the hold threshold is crossed).

## ADR-024 — Dance Bass restored to `kResonodePatches` slot 3, replacing Wood/Membrane
Decision: slot 3 of Resonode's 4 named patches goes back to being Dance Bass (`position=0.42, decay=7.0, damping=0.15, stretch=-0.10`, the original, already grid-search-verified point from before ADR-022) instead of the Wood/Membrane patch ADR-022's follow-up commit put there. `collision` (which postdates the original Dance Bass sweep) is hand-set to `0.30` from a dedicated DawDreamer measurement, the same way the other three patches' collision values were hand-set. `select_patches.py`'s `TARGET_DIRECTION` dict, `docs/CONTROLS.md`, `docs/demo/index.html`, and `docs/demo/faust-engine.js`'s mirrored `RESONODE_PATCHES` array all revert their naming/values to match.
Why: requested directly ("we lost our dance bass, we must bring it back") — Dance Bass was never deprecated by design, it was silently swapped out by a later commit whose own message ("Dance Bass -> Wood/Membrane") frames it as a rename rather than the loss of a distinct, previously-shipped character. Both patches are legitimate points in the same 4-dimensional space, but the control surface only has 4 knob-blend slots, so keeping both simultaneously would need a 5th slot or a bank-switch gesture — out of scope for a restoration request. Slot 3 reverting to its pre-ADR-022-follow-up identity is the literal, minimal fix.
Evidence: `select_patches.py`'s original `DanceBass` target direction (heavy `lowFreqEnergyRatio` bonus, strong negative `spectralCentroidHz` weight, `stretchAbsPenalty` favoring near-harmonic tuning) re-run against the current 6-mode+collision+pitch-mod engine via the existing `sweep.py`/`select_patches.py` 625-combo grid-search harness lands on the identical grid point used before ADR-022's mode-bank expansion, for the same reason the other three patches' picks carried over unchanged (the target direction is dominated by pushing decay/damping to their sustain-favoring grid extreme and stretch toward zero, which added modes/collision/pitch-mod don't move). `collision=0.30` comes from a same-environment DawDreamer JIT sweep at the shipped point (note 40, held, collision 0.0-0.6): decay-tail energy (first-diff-RMS proxy) rises monotonically 0.138->0.243 (+76%) while `lowFreqEnergyRatio` stays above 0.97 across the whole swept range, confirming the dominant sub-bass character survives a meaningful grit/drive boost. A new permanent `dance_bass_shipped_patch` check in `verify_musical_controls.py` renders the exact shipped point at notes 28/36/48 and asserts `lowFreqEnergyRatio > 0.85`, a sustain ratio (RMS at 500-600ms vs 50-150ms) > 0.5, and finite/bounded output — measured 0.94-0.97 and 0.86-0.94 respectively, well inside margin.
Alternatives rejected: keeping Wood/Membrane and finding a 5th control surface slot (rejected — no free knob exists in the current LofiFx-bank layout; would need a new gesture, out of scope); keeping Wood/Membrane and discarding Dance Bass permanently (rejected — directly contradicts the request); re-deriving Dance Bass's `(position,decay,damping,stretch)` from scratch instead of restoring the historical, already-verified point (rejected — the re-sweep confirms the historical point is still the empirical optimum for the same target direction, so re-deriving would just reproduce it at the cost of ~35 minutes of redundant DawDreamer renders).
Revisit if: a future control-surface redesign adds a patch-bank-switch gesture (mirroring the LofiFx button's existing dual-mode-via-hold-threshold pattern) — Wood/Membrane's point (`0.60, 1.20, 0.35, 0.05, collision 0.25`) is still a legitimate, previously-verified character and could return as a 5th/6th named patch on a second bank rather than needing another sweep from scratch.

## ADR-025 — Resonode gains an internal exciter, a bounded damping law and a real bass level law
Decision: `resonode_synth.dsp` is no longer excited by the live signal alone. It gains four controls — `fx/resonode/input`, `/mallet`, `/bow`, `/hardness` — and the excitation bus becomes `sharedExciteIn(exciteIn)*input + internalExciter*(1-input)`, where `internalExciter` is a `hardness`-shaped noise source split between a struck (mallet) envelope and a sustained (bow) envelope. At `input = 1` the bus is bit-exactly the old signal, so reactor mode is unchanged. Three further changes ship with it: `highFreqDampExponent` is remapped from `1.934264*(-log(damping))/log(2)` (which reached 8.35 and made every partial above the fundamental die ~300x faster, leaving a bare sine) to `1.0*(1-damping)`; the mode-0-only `bassBoost` is replaced by a whole-voice `voiceBassTilt` of up to +6 dB below 180 Hz; and `collisionDrive`'s normaliser moves from `1/tanh(driveAmt)` to `1/driveAmt`, so collision is a unity-small-signal waveshaper instead of a make-up gain that rose to +17 dB at `collision = 1.0`. The input highpass moves 60 Hz -> 25 Hz. `ResonodePatch` grows `mallet`/`bow`/`hardness`, knob slot 0 becomes `input` while SHIFT is held, and `docs/demo/faust-engine.js` is re-mirrored (its `level` range was also stale: 0.0-1.5 against the shipped 2.0-60.0).
Why: requested directly — Resonode "isn't fun to use and doesn't make very useful sounds". Two of those were structural, not tuning: with the live signal as the only exciter, a silent room renders bit-exact silence no matter how hard a key is struck (this is why `verify_musical_controls.py` had a `silent_without_live_input` gate asserting it), and the damping law's exponent range meant the shipped Dance Bass patch (`damping = 0.15`) collapsed to a single partial.
Evidence: a new offline render harness at `tools/resonode-lab/` (faust -vec -fun -dfs -vs 32 -nvi -ct 0 -> C++ -> g++, 48 kHz / block 64) measures peak, RMS, crest, clip fraction, spectral centroid, four band-energy ratios, Goertzel fundamental level, transient/sustain ratios and decay time over deterministic burst and sustained-noise excitations. Pre-change baseline: silent input peak `0.000000`; Dance Bass at note 36 with sustained excitation peak `0.087370`, late-window band ratio `<120 Hz = 0.9529`, `120-500 Hz = 0.0463`, `500 Hz-2 kHz = 0.0007` — i.e. a near-sine at -21 dBFS. Post-change: silent input peak `0.201367` (reactor mode still `0.000000`); Dance Bass note 36 peak `0.403443` / RMS `0.124212` against a pre-change `0.087370` / `0.020171`, i.e. +13.3 dB peak and +15.8 dB RMS, with late band ratios `0.8529 / 0.0463 / 0.0007` -> `0.8514 / 0.1268 / 0.0217` and no clipping (`clip_frac = 0.0000`) at any measured point. (An earlier draft of this ADR quoted peak `0.579251`; that figure predates the collision normaliser fix below and is superseded by `0.403443`.) Faust codegen for the new file is 6.5 s wall on aarch64, far under the documented compile cliff.
Alternatives rejected: leaving excitation to the live signal and only fixing gain (rejected — does not address the silent-room case, which is the "not fun" half); widening the mode count (rejected — ADR-022/CPU history already settled 16 as what the Pi 4 sustains); a waveguide Object section for sub-bass weight (deferred — the measured bass band ratios are already dominated by `<120 Hz`, so the remaining character gap is elsewhere).
Follow-up (same ADR, measured after it landed): the collision normaliser alone left `collision` inert. `collisionDrive` runs per voice BEFORE the `outLevel` gain, where the signal is ~25x smaller, so tanh sits in its linear region and sweeping collision 0 -> 1.0 changed first-diff RMS by 0.03%. The voice now scales into the drive by `drivePreGain = outLevel*decayLoudnessNorm` and divides it back out, so the waveshaper sees the signal at its final level while staying per-voice. With `driveAmt = 1 + collision^2*6`: crest 9.78 -> 5.61 dB and peak 0.138264 -> 0.068477 across collision 0 -> 1.0, i.e. a real soft-clip, and the old `verify_musical_controls.py` gate that required first-diff RMS to RISE with collision is now wrong and asserts the opposite (a compressor lowers peak, crest and transient energy). Its `collision=0` identity check was already broken independently: it regex-stripped a literal `collisionDrive(bank(...))` signature that no longer exists, and raised RuntimeError. Both are rewritten.

Live witness (device, MIDI injection over tcp/9401 with udp/4445 telemetry polled concurrently, `.gm/witness/resonode-before.js`): before the deploy, engaging Resonode and holding a key produced `audio_peak.out` of 0.0018 / 0.0002 / 0.0005 at notes 36/48/60 against an input peak of ~0.004 -- about 20 dB BELOW the room noise feeding it. After: 0.250000 / 0.234300 / 0.126300 at the same notes against the same input, roughly 30 dB above it, with `xruns` 0 and `latency_bias_samples` unchanged. Engaging with no key held still reads exactly 0.000000, so the exciter is per-voice gated and does not leak. Deploying exposed one operational trap: uploading only `resonode.so` over an older `resonode.ttl` mismatches LV2 port indices, and the plugin faulted and disabled itself on first process; the whole bundle must go together.

Revisit if: hardware listening shows the noise-based internal exciter reads as "windy" rather than struck — the lever is a short impulse component on the attack edge (a pulse whose length tracks `hardness`), which is what the reviewed reference instrument's Impact section does.

## ADR-026 — Resonode gains per-partial Decay Scale and Gain tables plus a bounded Impact pulse on the attack edge
Decision: `resonode_synth.dsp` gets two material-dependent constant tables per mode index — `decayScale*`, which multiplies each partial's `invT60` (`poleRadius = modePole(freqFund, modeDecayScale(i)*exp(highFreqDampExponent*modeLogRatioLive))`), and `amp*`, which replaces `modeAmpBase(i) = pow(float(i+1), -0.85)` with five L2-normalised per-material gain curves blended by the same shape weights and `shapeWeightNorm` that already blend `modeRatio(i)`. Alongside them, `exciteFor` adds `impactSig = malletSrc*impactWindow(impactPhase(note, gate))*impactAmt*malletAmt*(1.0 - inputAmt)` outside `excEnv`, where `impactPhase` is a saturating ramp (`p -> min(1.0, p + 1/(impactLenS*SR))`, reset to 0 on `attackEdge`), `impactWindow(p) = 4p(1-p)` and `impactLenS = 0.0006 + 0.0134*(1 - hardness)`. `highFreqDampExponent` stays exactly `1.0*(1 - damping)`. No new `hslider`, so `kResonodePatches`, `kGranPatches`, the knob mapping and `apc_grid.cpp` are untouched.
Why: measured, not assumed — at note 36 with `decay = 7.0` (three of the four shipped patches) the base `invT60` is `(1/7)*(65.41/261.63) = 0.0357`, below `invT60Floor = 1/8.5 = 0.1176`, so every mode of every material was clamped to the 8.5 s ceiling. The decay law was therefore flat and only the ratio table distinguished materials, which is why the four patches read as one tone. Reaching distinct per-material T60s through `highFreqDampExponent` would need that exponent near 1.0-1.5, which ADR-025 forbids ("raising it above ~1.0 destroys the bass"); a per-partial T60 multiplier reaches the same T60s without touching it. The Impact pulse closes ADR-025's own "revisit if" clause: `excAttackS = 0.004` ramps the strike envelope away over exactly the 0.6-14 ms that defines an attack, so the strike had no fast component at all.
Evidence: `tools/resonode-lab` (faust `-vec -fun -dfs -vs 32 -nvi -ct 0`, 48 kHz, `--bs=128`), shipped patches, `--note=36 --vel=1.0 --dur=3.0 --exc=sustain`, late window 2.00-2.30 s. Late centroid / band ratios base -> new: Percussive 6245.4 -> 6171.9 Hz (lt120 .0516 -> .0488, 120-500 .1272 -> .1557, 500-2k .1729 -> .1651, 2k-8k .4893 -> .4759); Metal/Glass 6315.0 -> 6394.2 (lt120 .2358 -> .1132, 120-500 .2642 -> .2355, 500-2k .2067 -> .2832, 2k-8k .1272 -> .2110); Strings 1743.6 -> 1733.0 (near-identical by construction — `ampString` and the string decay law are the old curve); Dance Bass 1932.8 -> 1953.6 (lt120 .8310 -> .8973, 120-500 .1243 -> .0670). Dance Bass's note-36 late `<120 Hz` band therefore RISES out of the 0.8228-0.8514 band ADR-025 recorded, i.e. the shipped bass is strengthened, not regressed. Material identity (attack->body centroid drop, pure material, note 48, burst): the pre-change ordering put bar (1.40) below bell (1.54), which is backwards; decay-only still left bell at 2.02 and amp-only left bar at 1.48, so only the pair produces the physical ordering bar 2.76 > membrane 2.52 > plate 1.79 ~= string 1.82 > bell 1.54. Impact, `--exc=silence`, attack window 0-20 ms: attack centroid 259.8 / 792.6 / 1233.3 Hz at `hardness` 0.0 / 0.5 / 1.0, i.e. the pulse adds level at the mallet's own tone (`malletToneHz = 300 + hardness^2*14000`) rather than a fixed bright click. Transient ratio (rms 0-50 ms / 50-500 ms) rises on the percussive patches (Percussive 3.6023 -> 4.1899, Dance Bass 0.6752 -> 0.8208). `nonfinite=0` on all four patches at notes 36/48/60 plus both extreme corners; `clip_frac=0.0000` everywhere; worst `sat_frac=0.0001` (Percussive note 36). The impact is gated: at `--input=1.0` a material-only build and the shipped build render byte-identical wavs, and `--exc=silence --input=1.0` still renders exact 0.000000, so ADR-025's `silent_without_live_input` gate still holds. Faust codegen 9802 -> 10822 lines, wall 7.4 -> 9.0 s, far under the >120 s cliff.
Alternatives rejected: raising `highFreqDampExponent` (rejected — ADR-025 measured that it destroys the bass); a per-material inharmonicity offset (rejected — `stretch` plus the ratio tables already move the whole partial set, and a third offset would need a per-material `stretchBias` blend that is unmeasured); signal-dependent `modeCount` (rejected — 16 is a compile-time constant feeding `par(i, n, ...)` and the `route` matrices, so a signal-dependent count is not expressible without restructuring the mode bank); `impactAmt = 0.85` (rejected — Percussive reached peak 0.9869 with `sat_frac=0.0005`, no headroom left).
Cost: render CPU +5.5% of Resonode's own cost (1.434 -> 1.513 s for 4 voices, 3.0 s); the impact alone is +0.2%. No new filter, no delay, nothing on the audio path that adds latency.
Known trade-off: on Metal/Glass the transient ratio falls 1.0067 -> 0.8410, and the material table (not the impact) is responsible (material-only 0.8331, +impact 0.8410) — the patch's body grows more than its attack. Accepted because the same table is what produces the correct material ordering.
Revisit if: real-hardware listening says Metal/Glass lost its strike; the lever is `impactAmt` (headroom exists up to ~0.85) or a shorter `impactMaxS`.
Also: `tools/resonode-lab/render.cpp` gains `--spec-from=<ms> --spec-to=<ms>` (defaults 100/400, preserving the old behaviour) and an `attack_centroid_hz` / four `attack_band_*` line in `report()`, because the dumpable spectrum was hard-wired to 0.10-0.40 s and no attack-window number existed in-tree.

## ADR-027 — Granulator freeze: hold the live ring and force it as the grain source
Decision: `Sampler::feedLiveGrainSource` returns early when `m_grainFreeze > 0.5f`, and a grain's source choice becomes `useLiveSource = (m_grainFreeze > 0.5f) || ((m_grainLiveMix > 0.0f) && (rand < m_grainLiveMix))`, with a plain-float `setGrainFreeze(float)` latch written from the control side. On the surface, `ApcGrid` adds `m_granFreeze` and sets it from the scan-rate dial: turning knob slot 5 to the bottom eighth (`v01 <= kGranFreezeKnobSpan = 0.125`) freezes, anything above unfreezes, and `applyGranulatorMorph` pushes it to the sampler on every re-patch. `kGranPatchCount`, `kGranPatches` and `kGranDirectKnobRanges` are unchanged, so no knob is repurposed and no shipped feature loses its dial.
Why: `scanRate = 0` was never a freeze. Measured on the shipped patches, a frozen-by-scan-rate granulator either goes silent (liveMix 0: rms 0.00055, -65 dBFS, because the pinned scan sits on the buffer sample `_autoTrim`'s LEAD_DECLICK ramp mutes) or keeps moving (liveMix 0.75: spectrum correlation 0.881, centroid drift 1066 Hz). Freezing the ring instead of the scan head makes the held 2.7 s snapshot an actual static source.
Evidence: scratch harness driving `sampler.h` directly with `test-audio-corpus/instruments/piano_mid_C4.wav`, 5 s at N=64, `specCorr` = cosine similarity of the averaged 16384-pt magnitude spectrum of the first vs second half, `dC` = |centroid shift| between halves. Glass (liveMix 0.35): specCorr 0.7840 -> 0.9860, dC 291 -> 6 Hz, 17.56 -> 17.50 us per 64-sample block (no added cost, and -0.1 us at 16 voices). Chop (liveMix 0.20): specCorr 0.9797 -> 0.9825, dC 84 -> 2 Hz. With `m_grainFreeze` at its 0.0 default both edits are no-ops, so every shipped patch is bit-identical to before until the dial reaches the detent. Freeze adds no buffering to a source that is summed into `fin`, so no audio-path latency.
Alternatives rejected: a 5th named "Freeze" patch row (rejected — measured: without the ring write gate such a row ships either -65 dBFS silence or a moving spectrum, and with the gate it needs no row at all because freeze works on every patch); widening `kGranPatchCount` to 5 or 6 (rejected — 8 CCs serve 1 bank-identity slot + 4 weights + 3 dials; dropping any dial orphans a shipped feature: `apc_grid.cpp`'s scan bind is the only path that can carry freeze, spray is the only caller of `setGrainPitchQuantize` so all four interval sets would become unreachable, and density is directly in the acceptance criterion); grain transposition (deferred — measured character is large, 7.2x centroid span over +/-24 semitones at zero CPU, but there is no free knob slot to assign it to).
Revisit if: a second LofiFx page (a within-`kBankFlashMs` double-tap of the LofiFx pad, `m_granulatorHeld` already exists) frees weight slots — grain transposition is the first thing that should take one.

## ADR-028 — LV2 host refuses plugins whose audio port count exceeds the host's channel count; Resonode stereo width is closed as architecturally blocked
Decision: `Lv2Host::connect()` stores `numChannels_ = numChannels > 0 ? numChannels : 1` and `connectPorts()` counts audio ports per direction up front, disabling the plugin with a `[host] plugin ... wants N in / M out audio channels, host has C — disabled` line if either count exceeds `numChannels_`. With `numChannels_ == 1` (every plugin aloop ships today) the connected pointers are byte-for-byte what they were before, so this is a no-op for all five mono bundles. Per-channel buffers are deliberately NOT added yet: `process()` copies `n` floats, so widening the host to 2 would overread the caller's N-float `fin`/`resonodeInBuf`.
Why: aloop has no L/R bus anywhere. The 2-channel wire is master (ch0) / cue (ch1) (`audio_thread.cpp:1349-1353`), the internal path is one mono float per sample, and every shipped bundle is mono (`process = _ <: ...`). Today a stereo plugin dropped into `/effects/user` has all its audio ports aliased to one `ioBuffer_` — last write wins on output, input 2 is never distinct — which is silent corruption with no warning. The guard turns that into a loud, deterministic disable.
Evidence: `lv2_host.cpp:229-231` connected `ioBuffer_.data()` for every audio port; `lv2_host.cpp:279-282` memcpys only `n` floats each way; port discovery (`:147`) records only `isAudio`/`isInput` and reads no channel or group index; `audio_thread.cpp:1097-1106` averages input channels to mono; all of `effects/home/faust/*.dsp`, `delayverb.dsp`, `pitchtracker_ac.dsp` and `resonode_synth.dsp` are single-input/single-output.
Alternatives rejected: per-voice pan in Resonode (compiles, 7.196 s vs 7.145 s baseline, +0.7%, zero runtime cost — but `apc_grid.cpp:730-745` allocates lowest-free-index-first, so the 1- and 2-note playing that is the entire APC Key25 use case lands on voices 0 and 1, both L, width 0); alternating mode groups across L/R (27.4 s elaboration, 3.8x baseline, then failed with `sequential composition A:B — outputs [4] of A must equal inputs [2] of B`); either option summed back to mono (the standard `(L+R)/2` downmix is -6.02 dB, and our path has no summing stage to compensate, so `fx/resonode/level` would need re-tuning and every sweet-spot gate would re-open). Parity decides it outright: `tools/chain-render/parity.sh` gates `record_vs_inputfx`, `record_vs_cue` and `inputfx_vs_cue` at `le -120` dB, and if L/R were mapped onto the only available pair (master/cue) the residual becomes the whole L-R spread and all three rows fail — a stereo Resonode cannot both widen and keep those rows green in a mono path.
Revisit if: a real second MASTER channel exists (the Focusrite can present 4 outputs — confirm out3/out4 can be a second master pair and measure `snd_pcm_hw_params_set_channels` at 4 with `period_size=64` on the device). The DSP is not the blocker; the destination is. Until then, decide the destination before the DSP.

## ADR-029 — the Focusrite loopback, and the granulator live ring witnessed on hardware

Decision: the Focusrite Scarlett 18i8 3rd Gen is the host-side signal source for loopback
testing. It is attached to the HOST (webtop), not the Pi; the Pi's only instrument interface is
still the M-Audio AIR 192|4, so the loop is host USB -> Scarlett analogue out -> AIR 192 analogue
in -> aloop capture, with the AIR 192's own output fed back into a Scarlett analogue input as a
tap. `instrument_device_match` stays `AIR 192`.

Why: AGENTS.md had carried "No CLEAN ingress reaches `dry` (#4 UNWITNESSED; unblocker Focusrite
passthrough)" for a long time, and the granulator's live-source ring could not be witnessed
because the AIR 192 read silent. The Scarlett closes both.

Three separate things muted the Scarlett output, and none of them is visible from Pulse, which
reported the sink RUNNING with a live sink-input while the device emitted nothing:

1. `Line 05 Mute` and `Line 06 Mute` were `[on]`. Headphones 1 is Line Out 05/06.
2. `Analogue Output 05` (the output source selector) was `'Off'`. This was the binding one.
3. `Speaker Switching` was `'Off'`; it is now `'Main'`.

Fixed by `amixer -c 2 sset "Analogue Output NN" "PCM N"` for N in 1..8 (so every analogue output
carries its matching channel, and whichever jack is cabled gets signal) plus unmuting all eight.
Playback then goes through Pulse, because PulseAudio holds the device and `aplay -D plughw:2,0`
returns "Device or resource busy":

    paplay -d alsa_output.usb-Focusrite_Scarlett_18i8_USB_....analog-surround-71 \
      --channel-map=front-left,front-right,rear-left,rear-right,front-center,lfe,side-left,side-right \
      <8ch wav>

The channel map matters: without it paplay warns "Failed to determine channel map from file".

Evidence the loop closed: before the fix, a `parec` of the Scarlett's own multichannel input read
~0.00003 on every channel; after, ch04 = 0.8883 and ch05 = 0.2961. On the Pi, `audio_peak.in`
went from a pinned 0.0001 to 0.2542 with `peakOut` 0.2643.

Evidence the granulator's live ring works: `rc-service aloop restart` clears every captured
sampler buffer, so the first note after a restart has nothing to granulate from the captured
path. With the granulator latched and note 48 held as that first note, `audio_peak.out` read
0.2253 against an input of 0.2627. Before the live ring this was exactly zero, because
`captureBlock` returns immediately unless `m_recActive`. This closes the witness that was
blocked; `m_grainLiveMix` defaulting to 0.5 (shipped earlier) is what makes it audible without
touching a knob.

Alternatives rejected: moving the Scarlett to the Pi and pointing `instrument_device_match` at
it (rejected - it is a host-side source, and the Pi would then have no monitoring path back);
`aplay` direct to `plughw:2,0` (rejected - PulseAudio holds the device).

## Addendum — the output pair is master/cue, not stereo L/R (correction to ADR-028 and ADR-029)

Correction, not a new finding. The instrument PCM's two channels are **master** and **cue**, two
independent mono buses — they are not a stereo pair. `src/dsp/audio_thread.cpp:1343-1366`:

    float masterSample = rawLoopSum[i]*loopDirectGateNow + inputFxOut[i] + mixOnlyBuf[i];
    float cueSample    = fout[i] + mixOnlyBuf[i];
    buf[i*wireCh + 0] = ms32;                        // ch0 = MASTER
    buf[i*wireCh + 1] = cs32;                        // ch1 = CUE
    for (c = 2; c < wireCh; c++) buf[...] = cs32;    // any further channel duplicates CUE
    g_telem.outPeak  = |cueSample|;                  // telemetry audio_peak.out IS THE CUE BUS

Three consequences, two of which correct things said earlier:

1. **Every `peakOut` figure in ADR-029 and in this session's witnesses is the cue bus, not the
   gated master/audience output.** The witnesses still stand, and are arguably better than stated:
   cue carries the record path unconditionally (it is upstream of SUSTAINGATE), so those numbers
   were never affected by whether sustain or SHIFT was held. That is why they were stable across
   gate configurations. But the label was wrong and the numbers must not be read as "what the
   audience hears".

2. **The Focusrite loopback tap is capturing cue**, since the user's cable takes AIR 192 output
   channel 2. Also correct for witnessing, and the reason the tap read 0.8883 while the master
   would have been gated.

3. **ADR-028's stereo conclusion is stronger than written, not weaker.** It is not merely that
   there is no L/R bus: any channel beyond the second is filled with a duplicate of cue, so a
   4-channel PCM would give master, cue, cue, cue. True stereo needs a genuinely new third bus
   (a master-right) plus a change to how `wireCh` is filled and how `masterSample` is computed —
   not just wider buffers. Repurposing ch1 as "right" would destroy the performer's cue monitor.

AGENTS.md line 107 cites `masterSample`/`cueSample` at `:1353`/`:1354`; they are at `:1343`/`:1344`.

## ADR-030 — Grain transposition takes the spray dial's middle band; no fifth patch row, no second patch page

Decision: `Sampler` gains `setGrainTransposeCents(float)` / `grainTransposeCents()` and a
`m_grainTransposeCents` member defaulting to `0.0f`, applied inside `_grainPitchRatio()` as an addend
to the exponent in both the quantised-degree branch and the continuous-spray branch, plus a new
branch so transposition alone (spray 0) still shifts. The spray dial (LofiFx knob slot 7) becomes
three bands: `v01 <= 0.5` is the unchanged continuous spray, `0.5 < v01 <= 0.875` is integer-semitone
transposition −12..+12 (`kGranTransposeSemitones`, unison at `v01 = 0.6875`), and `v01 > 0.875` is the
four interval sets, now compressed from 64 MIDI steps to 16. `kGranPatchCount`, `kGranPatches`,
`kGranDirectKnobCount` and every other knob binding are untouched, and `m_granTransposeCents`
defaults to 0 and is written only from spray-knob `case 2`, so every shipped patch is bit-identical
until the dial enters the new band. Nothing was added to any `.dsp`.

Why: ADR-027 deferred grain transposition for want of a knob slot and named a second LofiFx page as
the unblocker. Measurement removed both premises. The spray dial's upper half was a 4-position
selector occupying 64 MIDI steps — 4 per set is enough, so 48 steps were free with no new gesture and
no lost capability. And the thing a second page would have bought (a "Tape" row) does not exist:
eight swept Tape candidates land at centroid 1440.2–1561.9 Hz / flux 0.0874–0.0967, entirely inside
the shipped four's 1079.5–1868.8 Hz / 0.0930–0.3348 (1308.7–1794.2 Hz on this run — see Evidence),
because the granulator has no filter and grain size/rate only move the centroid about ±20%. A row
that measures as indistinguishable from what is
already there cannot be justified, and a hidden second page also collides with ADR-023's press-edge
latch toggle.

Evidence: the prior session's scratch bench (`/tmp/granbench/bench.cpp`) drives `sampler.h` directly
with `test-audio-corpus/instruments/piano_mid_C4.wav` as the chrom buffer fed to the live ring, 48 kHz,
N=64, 5 s, deterministic RNG seed. It was **rebuilt and re-run against this commit's edited header**,
and every run below reports `nf=0` (nonfinite 0). Glass at ±2400/±1200/0 cents, 4 voices: centroid
450.5 / 753.7 / 1414.5 / 2742.7 / 5185.0 Hz — monotone, 11.5x span — at 17.652 / 17.786 / 17.504 /
17.515 / 17.252 µs per 64-sample block, i.e. flat within noise (transposition is one float add inside
a `pow` that already runs per grain spawn, ~0.037 spawns/block). Tape as a recipe (Cloud at −1200 c):
centroid 1794.2 → 1204.4 Hz, sub-500 Hz band 0.607 → 0.913, CPU 10.182 → 10.435 µs/block. Shipped
patches on the same bench: Glass 1414.5 Hz / 17.504 µs, Cloud 1794.2 / 10.182, Chop 1308.7 / 10.499,
Shatter 1385.4 / 12.836 — the eight Tape candidates (1440.2–1561.9 Hz) sit inside that span, which is
why no row can be justified. (The earlier session's runs on the same harness gave Glass 1247.6 Hz and
17.153 µs/block against ADR-027's recorded 17.56 µs/block, Cloud 1868.8 → 1335.0 at −1200 c with band
0.540 → 0.906 and specCorr 0.9787; the two runs agree in direction, magnitude and cost.) Resonode guard, since the edit lands next to it: `tools/resonode-lab`
rebuilt (`gen.sh` 9.77 s, no codegen cliff) and all four shipped patches re-rendered at notes
36/48/60 with `--exc=sustain --bs=128`, late window 2000–2300 ms — `nonfinite=0` and `clip_frac=0.0000`
on all twelve, Dance Bass note 36 `late_band_lt120 = 0.8973` and `late_centroid_hz = 1953.6`
(ADR-026's figures exactly, no regression), plus two extreme corners (note 127, 4 voices, all shape
weights and collision at 1.0; note 21, vel 0.05, all weights at 0.0) both `nonfinite=0`.

Latency: none. Transposition is a scalar on the grain read rate — no buffering, no new stage, no new
filter.

Alternatives rejected: a fifth `kGranPatchCount` row (measured indistinguishable, above); a second
LofiFx patch page via a within-`kBankFlashMs` double-tap (buys only transposition, costs a hidden
mode that fights ADR-023's press-edge latch); widening `kFxKnobCount` (the APC Key25 bank has exactly
8 CCs and all eight are bound).

Revisit if: a filter ever enters the granulator, at which point a genuinely dark row becomes
expressible and this ADR's rejection no longer holds.

## ADR-031 — Stereo output is opt-in behind `stereo_out`, refused unless the hardware grants 4 playback channels; `audio_peak.master` witnesses the gated bus

Decision: two independent landings.

1. `AudioConfig::stereoOut` (default `false`), parsed from `[audio] stereo_out =` in `aloop.conf`
   (shipped commented out, the in-repo convention). `worker()` computes
   `bool stereoOut = g_cfg.stereoOut && wireCh >= 4` — without a third and fourth wire channel cue
   has nowhere to go, so the flag refuses rather than stealing ch1. After `snd_pcm_hw_params()`
   succeeds, `configurePcm` reads back the **granted** channel count with
   `snd_pcm_hw_params_get_channels(hw, &grantedCh)` and, if it is below 4, prints
   `[audio] stereo_out=1 needs 4 playback channels, device granted N -- falling back to master/cue`
   and clears the flag. Only then does the wire fill write `stereoOut ? ms32 : cs32` into ch1. At
   `stereoOut == false` the emitted buffer is byte-for-byte what it was before. `otgBuf` keeps
   duplicating master, and `g_telem.outPeak` (the cue bus) is untouched, so every existing
   `audio_peak.out` witness stays comparable.
2. `AudioThread::Telemetry::masterPeak` is accumulated in the same per-sample loop that already
   computes `masterSample` and `cueSample` (two float ops per sample) and published as
   `audio_peak.master` alongside `in` and `out`. `out` is deliberately NOT renamed.

Why: ADR-028 closed Resonode stereo as architecturally blocked and said "decide the destination
before the DSP"; the addendum above showed any channel past the second is a cue duplicate. The
destination question is now measured **negative** for the shipped interface, which is exactly why the
change must be an inert opt-in rather than a new default: `/proc/asound/A4/stream0` Playback has one
altset only, `Channels: 2`, `Channel map: FL FR`, and `/proc/asound/A4/` contains only `pcm0c`,
`pcm0p` — `channels = 4` is impossible on the M-Audio AIR 192|4. The OTG gadget, the only second PCM
in the box, is a `S16_LE`, `period_size: 256 / buffer_size: 1024` = 21.33 ms best-effort mirror
against the instrument path's 5.33 ms, opened `SND_PCM_NONBLOCK` with `-EAGAIN` swallowed; and when
no host is attached `otgBuf` is never filled and never written, so cue moved there would be lost with
no fallback and the performer would go deaf. Widening `cfg.channels` instead is not an option either:
`audio_thread.cpp:483-505` passes `ch` to `Lv2Host::connect(N, ch)` and `process()` memcpys exactly
`nframes` floats, so a wider `channels` would let ADR-028's own guard admit a 2-in/2-out plugin and
corrupt it. Hence a dedicated key.

Evidence: measured on the live device (Pi `192.168.137.132`, ssh2) — the AIR 192 altset/channel
readings above; gadget `pcm0p/sub0/hw_params` and `p_chmask=3`/`c_chmask=3`; `dmesg` shows
`dwc2 … bound driver configfs-gadget.aloop` with no `[audio] OTG gadget mirror … unavailable` line,
i.e. `otgReady == true` right now. Signature risk on the new ALSA call was resolved against
alsa-lib v1.2.11's own `include/pcm.h`: `int snd_pcm_hw_params_get_channels(const snd_pcm_hw_params_t *params, unsigned int *val)`.
Compilation was verified locally with both `#ifdef` regions live: `g++ -fsyntax-only` over
`src/dsp/audio_thread.cpp` with generated `loop_pre.cpp`/`loop_post.cpp` in place, `-Ieffects/home/faust`
for `pitch_ffi.h`, and alsa-lib v1.2.11 headers — clean. Parity is unaffected: `tools/chain-render/parity.sh`
builds every row from the `record`/`cue`/`inputfx` Faust taps produced by `chain_render`, and the ALSA
wire buffer is never compared, so Stage 1 cannot move the `le -120` rows.

Latency: none in either mode. The master peak reads a sample already computed in the same loop.

Alternatives rejected: moving cue to the OTG gadget (21.33 ms, 16-bit, droppy, and lost entirely when
nothing is attached); repurposing ch1 as "right" by default (destroys the performer's cue monitor —
the standing rule is that stereo must never take cue away); keying the fallback on the requested count
rather than the granted one (a device that silently narrows the request would drop cue with no
message); making Resonode stereo now (ADR-028: a 2-output bundle is disabled by its own guard, and
per-channel buffers are a precondition).

Revisit if: a 4-channel instrument interface is actually attached to the Pi. Two measurements are
required before `stereo_out = 1` is trusted there, and neither has been run: (a) `audio_peak.in` must
be re-baselined, because `fin[i] = (recAcc / wireCh) / 2147483648.0f` divides by 4 instead of 2 on a
4-out/2-in interface, dropping the record path 6.02 dB, and `mixOnlyBuf[i] = fullNorm - fin[i]` shifts
with it; (b) cue physically relocates from output 2 to outputs 3/4, a re-patch that must be witnessed.
Until both are done the key stays commented out.

## Addendum — a netbooted client loses hot-deploys on every reboot

Observed while closing the master-bus witness: a device that had been verified running
`0cd0cc0416345d49d36aa0710185cef9` (the 0d0c3f0 build) later reported `2af0406bf6acd3a0f93edc94df7c3e40`
— the pre-session binary baked into the image. The cause is that a netbooted client runs from tmpfs, so
anything sftp'd to /opt/aloop/aloop is gone the moment it boots again. This is distinct from the
SD-booted Pi 4 that AGENTS.md already describes, where hot-deploy does persist.

Consequence for anyone measuring: check `md5sum /opt/aloop/aloop` before trusting any hot-deploy, and
expect to re-deploy after a power cycle. It also means a witness taken against a hot-deployed binary is
only valid until the next reboot; to make a change survive, it has to go into the served netboot payload,
not onto the running filesystem.

## ADR-032 — the granulator gets a tonal control carried on the patch blend

Decision: the granulator gains a per-voice tonal filter whose cutoff is a ninth field on
`GranPatch`, convex-blended exactly like the other eight, so it costs no knob slot. Sampler
applies two cascaded one-poles (12 dB/oct) to the granular voice output, and `toneNorm` maps
0..1 logarithmically onto 120 Hz .. 18 kHz. `toneNorm` defaults to 1.0 and `_grainToneAlpha()`
returns exactly 1.0 at or above 0.999, so the filter is a bit-exact bypass until a patch blend
sets it — no shipped patch changes by default.

Why: while trying to ship a "Tape" patch, eight swept candidates all measured centroid
1440-1562 Hz, entirely inside the shipped four's 1308-1794 Hz range. The cause is that grain
size and rate only move the spectral centroid about +/-20 percent, so with no filter the patch
space cannot produce a warm character at all. Measured with the filter off, all four shipped
patches sit at ~11.5 kHz centroid — they are sonically distinguishable by grain behaviour but
not by tone.

Evidence (bench: Sampler instantiated standalone, 5 s render, note 60, broadband source,
centroid over the last 3 s, `nf=0` in every run):
  toneNorm sweep  0.00 -> 1.00 gives 444.3 / 650.8 / 963.2 / 1419.7 / 2069.3 / 2965.4 /
  4156.8 / 5661.5 / 7414.0 / 9188.9 / 11506.9 Hz — monotone, a 26x span.
  Per patch with tone off (1.00): Glass 11506.9, Cloud 11528.0, Chop 11522.5, Shatter 11508.4 —
  indistinguishable. With tone on: Glass 9962.9, Cloud 1922.6, Chop 6022.4, Shatter 8854.6 —
  separated across 5.2x. Cloud's shipped value is 0.25, which lands it near 1100 Hz, below the
  ~1300 Hz floor that made a warm patch unreachable before.

Alternatives rejected: a single one-pole (rejected — measured range was only 4499-11507 Hz on a
broadband source, never warm); a dedicated knob (rejected — all eight LofiFx slots are taken).

Also observed, not changed: `_noteOn` only spawns a voice when `m_drumLoaded[k]` or
`m_chromLoaded`, so with nothing captured no voice exists to consume the live grain ring at all.
Feeds to the ring are simply unused. This is the cold-start path a new user hits, and it is worth
its own row rather than a change to voice allocation made without measurement.

## ADR-033 — the granulator can start from nothing captured

Decision: `_noteOn` gains an `else if (m_granOn)` branch that spawns a voice bound to the live
grain ring (`m_grainLiveRing`, `kGrainLiveRingSpan`) when no drum key is loaded and the chromatic
buffer is not loaded.

Why: ADR-032 recorded this as observed-but-not-changed. It is the first thing a new user hits —
latch the granulator, play a key, get nothing — because with no loaded buffer no voice is created
at all, so every feed to the live ring is simply unused. The live ring added earlier could only be
reached once something else had already been captured.

Evidence: the standalone bench renders the four shipped patches with and without a preceding
capture. Cold (nothing captured): Glass rms 0.255447 peak 0.888947, Cloud 0.053945 / 0.291229,
Chop 0.128241 / 0.654480, Shatter 0.198451 / 0.647827. Warm (captured first): 0.257467 /
0.942261, 0.054013 / 0.288483, 0.128883 / 0.637634, 0.199653 / 0.668915. The two are within a few
percent, so the ring supplies the same material either way and the cold path now sounds.
nonfinite=0 in every run, and the branch only fires when the granulator is on and nothing is
loaded, so ordinary sampler playback is untouched.
## Decisions, 2026-10-18 (user delegated all decisions)

- Granulator surface: four patches (Glass, Cloud, Chop, Shatter) and three dials stand. Glass and Chop overlap under the pre-registered v1 rule (rate 35.0 vs 32.2 Hz, envelope mean -24.93 vs -24.87 dB, centroid 325.5 vs 327.4 Hz). Recorded as an outcome, with no patch change. Source: CI artifact 39156877282, sha 568f77da.
- Freeze: the v1 absolute envelope rule (std below 1.0 dB) fails because the 10 ms dB std is dominated by gap windows (percentiles, CI run 39157107149). Freeze steadiness is measured by the v2 relative rule (Freeze p50-p95 no larger than unfrozen Cloud, same run). It passes (3.8884 dB vs 5.2211 dB, artifact 39157263802, sha 6efedab6). The v1 FAIL stands as recorded. v2 is accepted as the Freeze measure, with its stated limitation: it shows freezing adds no level variation, not absolute steadiness.
- Reboot persistence: deferred until the hold variant passes its corpus gate. It has not passed (not admitted), so no persistence change is made.
- Stop condition: the stop hook lives outside the repo. This project does not edit it.
- gm commit-message lint: the fix is in the gm repo. It is not edited from here, and the blocker row stays open.
- CLI witness: the --json lock records exist (live record .gm/witness/lock-trumpet-59.json). Binary md5 and lockbin sha256 move to plan-provenance-fields.
- Tracker admission: the deduplicated ceiling candidate (sha 4e8907ac) is admitted only if its CI render (row pitch-ceiling-dedup-render) passes R1 to R4. Otherwise it is rejected, and the reason is recorded here.
## Correction, 2026-10-18

- plan-provenance-fields was closed with commit 2e630eca (the summariser) as its delivering commit, in error. The delivering commit is 4092c099 (the tool change that fills the four provenance fields). The resolver can't repair a closed row, so this line is the record. The witness (.gm/witness/lock-trumpet-59-prov.json) and its evidence are correct.
