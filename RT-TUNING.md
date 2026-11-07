# RT tuning — why each knob exists

The goal: worst-case scheduling jitter in the **tens of microseconds** so a
64-sample (1.333 ms) audio block never misses its deadline. Every setting in
`kernel/cmdline.txt` and `kernel/rt-tune.sh` maps to a specific latency source.

| Knob | Where | Why |
|------|-------|-----|
| **PREEMPT_RT kernel (OPTIONAL, not shipped)** | `kernel/build-rt-kernel.sh` config fragment | ADR-011 ships Alpine's stock `linux-rpi` kernel with the full userspace RT tuning below. Building a PREEMPT_RT kernel is an OPTIONAL on-hardware step, taken only if a measured stock-kernel run misses the 64-sample no-xrun target. `kernel/build-rt-kernel.sh` writes `rt.fragment` (`KVER` defaults to 6.12) and does NOT build a kernel; no CI job builds one. |
| `isolcpus=domain,managed_irq,1,3` | `cmdline.txt` | Removes cores 1 and 3 (the audio cores) from the general scheduler, so only our pinned threads run there — nothing else steals a time slice. **WITNESSED GAP, this session (real Pi 4):** the bare `isolcpus=1,3` form only isolates the *scheduler domain* (ordinary userspace tasks) — it does NOT exclude per-CPU kernel housekeeping threads. Live inspection (`/proc/<tid>/stat`'s last-run-cpu field for every thread on the system) found `kworker/1:0-events`, `ksoftirqd/1`, and `kworker/1:1-rcu_gp` all currently schedulable on CPU1 (the home-FX audio core) alongside the pinned SCHED_FIFO audio thread — despite `rcu_nocbs=1,3` already moving RCU *callback processing* off these cores (a related but distinct mechanism: `rcu_nocbs` stops callbacks from running there, it does not stop the `rcu_gp`/`kworker` *threads themselves* from being schedulable there). Any one of these firing mid-block is a real, sporadic multi-microsecond stall on an otherwise-idle-looking core — the kind of jitter that shows up as occasional xruns without moving average `core_busy%` much, and plausibly why adding more DSP work (shrinking the per-block slack that used to silently absorb these stalls) made a pre-existing gap suddenly audible as crackling. **Fix:** the extended `isolcpus=domain,managed_irq,...` form (kernel 5.8+; `kernel/build-rt-kernel.sh` defaults to `KVER=6.12`) additionally excludes IRQ-affinity-managed interrupt handling and general kernel-thread placement from the isolated cores, not just the scheduler domain. This is a cmdline-only change verified reachable on this kernel version; a real cyclictest run (see below) is still needed to confirm it closes the gap in practice, not just in theory. |
| `nohz_full=1,3` | `cmdline.txt` | Stops the periodic scheduler tick on the audio cores; the tick is a recurring source of jitter. |
| `rcu_nocbs=1,3` + `rcu_nocb_poll` | `cmdline.txt` | Moves RCU callback processing off the audio cores (another background jitter source). |
| `threadirqs` | `cmdline.txt` | Runs IRQ handlers in threads so their priority can be set — lets audio threads out-prioritize non-audio interrupts. |
| `governor=performance` | `rt-tune.sh` | Frequency scaling parks the CPU; waking it costs microseconds. Pin to max clock. |
| deep C-states disabled | `rt-tune.sh` | Deep idle states take microseconds to exit — enough to blow a block. Disabled on the audio cores. |
| **network/USB IRQ affinity → control core** | `rt-tune.sh` | **The mechanism that makes Link-over-WiFi not glitch audio.** WiFi/USB interrupts are steered onto Core 2, so the audio cores never service them. This is *the* condition behind feasibility Requirement 1. Works on Pi 4; Pi 5's RP1 blocks it (ADR-006). |
| `SCHED_FIFO` + high rtprio | audio threads | The audio threads run under real-time scheduling above everything else, so they always get the CPU when a block is due. |
| `mlockall` + unlimited memlock | audio process | Locks all memory into RAM so the audio thread never page-faults (a fault would blow the deadline). |
| pinned thread affinity | ONE audio thread | `setRealtimeSelf(g_cfg.homeFxCore, ...)` pins the single worker to Core 1; `user_fx = 3` is a config label passed to `Lv2Host::loadDir` as a log string, with no second pinned worker. |
| **flush-to-zero (FTZ) / denormals-are-zero (DAZ)** | `audio_thread.cpp`'s `setFlushToZero()` | **Configured once at audio-thread startup** (`src/dsp/audio_thread.cpp:290`, before the first DSP block). Denormal (subnormal) floats occur naturally in any decaying IIR filter/feedback loop asymptotically approaching zero (reverb tails, delay-line feedback, envelope followers decaying toward silence) — on both ARM and x86, denormal arithmetic can be 10-100x slower than normal-range floats (the FPU falls back to a microcoded slow path). The three effect chains (dub Faust zones, the `guitar_lofi_fx.dsp` LV2 with its eight permanently-live stages, and the granulator) are all computed every block regardless of which bank the UI shows — Faust has no runtime branching, `select2`/`ba.if` choose among already-computed signals rather than skipping their computation — so every decaying-filter path can sit in denormal territory. Sets the AArch64 FPCR's FZ bit (inline asm — no portable C++ API on ARM) once at audio-thread startup, before any DSP compute runs. |

## How we know it's tuned (the verification, needs hardware)

The proof is a `cyclictest` run under simultaneous audio + WiFi/AP + MIDI load,
confirming worst-case wakeup latency stays under the block budget with zero
xruns over a long run. That measurement **requires a real Pi 4** and is parked as
a hardware-dependent row (ADR-009) with the exact command documented:

```
cyclictest -m -S -p 95 -i 200 -d 0 -h 400 -D 600 -q > /tmp/cyclictest.out 2>&1   # test/hardware/test-rt-jitter.sh
```

Until that runs on hardware, the tuning is *configured correctly by design* but
the jitter number is not yet *measured* — and we say so rather than claiming it.
