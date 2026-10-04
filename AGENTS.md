# aloop — current-state constraints

Real Pi 4 `192.168.137.100`, root/aloop; a real Pi 3B+ netboots from the host. **aloop is a BEHAVIOR clone of `../looper`, never a source clone** — looper is Circle bare-metal; never vendor its source, never add `LOOPER_DIR`/`loopMachine.cpp`/an effects-bridge shim. DSP = Faust (rwtable + recursive heads); discrete control (command edge-detection, dynamic loop length, MIDI, file I/O) = a thin native shim feeding Faust params.

# Working rules

- **No comments in code, ever** (C++/.dsp/JS/shell/YAML/config, config-like `.gitignore`); one sighting => sweep that whole file; never trust an in-repo comment. Before deleting one, check whether it encodes a witnessed root cause; if so it moves here. Exempt: `#!`, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, commented-out keys that are the only record of an option (`config/aloop.conf`: `disable_core3_lv2`, `latency_trim_samples`). `vendor/` and regenerated Faust output are not swept.
- **Never add audio-path latency** — the ~7 ms block latency must never grow, even temporarily; stop and ask first. Exempt: a wet effect's own engaged-only algorithmic latency (`ef.transpose`, SNAC).
- **No WSL, no Docker here, ever** — no `wsl.exe` for builds/checks/probes/installs; missing compute => GitHub CI/CD (`gh`, native `ubuntu-24.04-arm`).
- **Test on real hardware, never ask the user to reproduce input** — MIDI injection (`tcp/9401`, `test/hardware/midi-inject.js`) or SSH. Link needs a real peer: `test/hardware/link-peer.cpp`, host-built `-static` with `-DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -lws2_32 -lwinmm -liphlpapi -mthreads`, `-I` roots `build/_deps/abletonlink-src/{include,modules/asio-standalone/asio/include}`, output inside `build/`.
- **Telemetry (udp/4445) answers in ~190 ms from the 5 Hz loop; lag JITTERS tens of ms.** Rate only by least-squares slope over every poll of a >=20 s watch, skipping ~6 s after FINISH. SLIP = `readpos` vs `master_phase_beats * beatLen` from the SAME reply. **Replies TEAR** (`looperReadPos` early, `masterPhaseBeats` later, `snapshotTelemetry()` non-atomic) — despike with `despikedSpread()` (`test/hardware/lib/gridlock.js`); a torn FIRST poll offsets every later sample from it.
- **Compiling clean proves nothing** — x86_64 A/B passed while aarch64 codegen SIGSEGV'd (`-mapp`); regenerate real C++ and diff byte-for-byte. Heap-allocate large DSP instances (stack-local `AloopEffectDsp` faults STATUS_STACK_OVERFLOW).
- **Logs carry wall-clock `t=<sec>.<ms>`** (`CLOCK_MONOTONIC`); WebSearch before irreversible hardware steps; SSH via a JS `ssh2` client, never `ssh.exe`/`sshpass`. **SFTP `rename()` is not POSIX `rename(2)`** — overwriting an existing remote path needs an explicit unlink first.
- **Faust compile-time cliff**: a NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile time (`modeCount=24` SIGALRMs ~2 min into `-i -a lv2.cpp`) — declare new controls in `effects_runtime.dsp`. Hence a new pitch/shifter engine is C++ bridged by one `ffunction` call, never hand-written per voice in Faust.
- **A crash fix can UNMASK a second bug** (a watchdog-disabled plugin costs ~0% CPU): re-measure the SAME live metrics after any crash fix. Packaging must separate "validates something" from "is a runtime effect" — a blanket `cp *.lv2` deployed and ran CI-only `aloop.lv2` twice; hence the exclusion list in `lib-boot-tree.sh`.

**Debugging techniques that paid off**: `core_busy` undercounts — it covers only `compute()`, not the read-compute-write cycle with the blocking `readi()`; cross-check against OS ground truth (`/proc/<tid>/stat` utime+stime vs `/proc/uptime`, `mpstat` per-CPU). `schedstat` voluntary_ctxt_switches separates blocked from spinning: blocked in an ALSA hardware wait => ~750/sec; ~46/sec at 95% on-CPU means hot, not waiting. On-CPU time exceeding the app's own timers => read the code BETWEEN the timed spans for string-keyed or allocating work (that gap found per-block `targetToZone()` + two map lookups behind 39047 climbing xruns -> 0). Live-reload deploy (SFTP swap + `rc-service` restart) beats a netboot power-cycle. Verify the test tool before trusting its verdict.

# Boards, images, boot trees

- `image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`: `pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`); only `boot_tree_fetch`/`boot_tree_config` dispatch per board; `boot_tree_apkovl` is shared. USB-audio gadget: pi4 dwc2 UAC2 only. ROM order SD -> USB -> Network: a card wiped of `bootcode.bin` falls through to network.
- `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/` never appear. `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"` in the service file, not `local.d`; `depend()` needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never `apk add` at boot (the stock Alpine RPi apks repo is RSA-signed and lacks `hostapd`); alsa-lib also needs `vendor/share-alsa/` or `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` + `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line (`tr '\n' ' '` + `tr -s ' '`); `core.autocrlf=true` corrupts scripts — fix via `rm` + `git checkout --`. NTFS has no exec bit: new vendored files need both `tar --mode='+x'` lists; verify via `tar -tvzf` (LAST match).
- `lib-boot-tree.sh` excludes `aloop.lv2`/`resonode.lv2`/`pitchtracker.lv2`/`delayverb.lv2` from the home-stack copy.

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.** Split `faust2lv2`: `faust -i -a lv2.cpp` emits `.cpp`, `$HOST_CXX` compile+run emits `.ttl`, only the final `-shared .so` link targets the device. Verify `objdump -p foo.so | grep NEEDED` -> `libc.musl-aarch64.so.1`.

**`disable_core3_lv2` in `/etc/aloop.conf`** (commented out in `config/aloop.conf`): `= 1` makes the worker skip `homeFx.process()`/`userFx.process()` — fully silent, survives `rc-service aloop restart`. Grep `^\s*disable_core3_lv2\s*=\s*1` (anchored so the shipped config's own commented-out line cannot false-positive) before debugging silence as a code bug.

**Build traps**: the loop engine is TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around `delayverb.lv2`; both must update `audio_thread.cpp`'s includes in the SAME commit or CI ships an engine-less binary. **`dsp/effects_runtime.dsp` is imported ONLY by `dsp/aloop.dsp`** (CI packaging-reproducibility, never shipped) — the shipped entry points import `effects_runtime_pre.dsp`/`effects_runtime_post.dsp`, so a `dryGate` fix landed in the wrong file.

# Deploy, netboot, CI

- **The `REBOOT:<token>` UDP listener lives INSIDE the aloop process** (`config/aloop.conf` `[remote] token=`, `udp/4446`, `remote_control.cpp`; client `image/aloop-reboot.js`). `aloop` crashed => nothing listens (`respawn_max=0`); SSH `reboot` is the fallback. Verify device state via `/proc/uptime` and `md5sum /opt/aloop/aloop` BEFORE reading logs.
- **Netboot self-update, two paths.** Automatic: `image/serve-netboot-win.js` polls `build-binary.yml`/`build-lv2.yml` green `main` every 30 s (blind to `image/**`). Manual: `image/build-netboot.sh`, where all four `*_LV2_DIR` vars plus `ALOOP_BIN`/`OUT`/`NETBOOT_SERVER` are **mandatory**. A new bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js`. Both workflows gate on source paths — pass `--sha`/`DSP_SHA`. Fast DSP iteration: `node image/dsp-hotdeploy.js --target home|guitar|both`.
- **Netboot facts**: publish is a staged-directory atomic `mv` (staging a SIBLING of the live dir). `SERVER_IP` is baked into the root's `cmdline.txt` ONCE — restarting the server does not rewrite it; rebuild with `NETBOOT_SERVER` and power-cycle. **TFTP ok but ZERO HTTP requests = hung until power-cycled** (diskless init does NOT retry). Only remote HTTP requests count toward the stall diagnosis; initramfs window 150 s; a zero-DISCOVER watchdog fires.
- `ubuntu-24.04-arm` runners; `build-image.yml` downloads BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2` from the SAME green run. Rolling `latest` hard-gates on a real bundled binary (`payload_check`); artifacts need `retention-days: 3`. `get_parameters_description()` returns params ALPHABETICALLY — a harness binds the wrong control silently. `LEASE_SECS = 86400`; `ensureCorrectSubnetMask()` rewrites the netboot NIC mask every startup — a /16 mask broadcasts every OFFER/ACK, so the Pi re-DISCOVERs forever with zero TFTP reads.

# Mesh networking

aloop (Pi 4) + `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc single-AP mesh for Link's multicast peer discovery (`224.76.78.75:20808`, hardcoded in Link). Change BOTH sides or the mesh splits.

| Invariant | aloop | esp-idf-link |
|---|---|---|
| SSID | `ssid=ticker` (hostapd/wpa_supplicant) | `wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |
| Transport | CLOCK-ONLY: `enableStartStopSync(false)`, never `setIsPlaying` | CLOCK-ONLY: no transport shared |

`src/net/autoap.sh` hosts `ticker` never `aloop`, needs >=1 active `network={}` block before `start_ap()` does anything, and `start_ap()` clears previous hostapd too. The AP is open: `hostapd.conf` carries only `ssid=ticker` + `channel=6`.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; the audio thread reads a lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated at the session tempo (5 Hz => ~0.4 beat stale).
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` is the unconditioned version and the only writer of `weOwnTempo` — never gate `linkSpeedRatio` on it. Match tempo by read RATE (`linkSpeedRatio=linkBpm/recordedBpm` -> `effSpeed`); `imposeTempo()` republishes via `publishSnapshot()` in the same call, or the finish edge doubles the take.
- `imposeTempo()` latches `g_ownedBpm`, re-imposed by `controlTick()` on every peer count settling `kPeerSettleTicks=2` ticks (~400 ms), join or leave — a 1->0->1 flicker never settles. Stable-count tempo changes are still FOLLOWED. `resetTempoAuthority()` clears it with `cmd/recorded_bpm`.
- **CLOCK-ONLY: tempo+phase shared, transport never.** Pausing locally leaves peers playing, none can start/stop us, `midi_clock.cpp` never emits `0xFC`. aloop IS the mesh's sole transport emitter; `publishTransport` must use `setIsPlayingAndRequestBeatAtTime`, not `setIsPlaying` (the stop path keeps plain `setIsPlaying`). `applyRemoteTransport` must reset `m_lastRemotePhaseMicroBeats` to -1 when arming `m_remoteStartPending`.
- **Local transport never stops: a paused looper is MUTED, not stopped.** `ApcGrid::updateLocalTransport` starts it once and never reports stopped; `g_localTransportRunning` defaults true. Readiness: `depend(){ after local autoap; }` plus `waitForNetworkInterface()`.
- Residual phase error is a bounded trim on `masterPhaseSamples` ONLY (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`, else it saturates into a 51-cent detune). `masterPhaseBuf` ramps per-sample (never `std::fill()`) at `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`; `effSpeed = g_manualSpeedMul*linkSpeedRatio` carries the TEMPO alone — **the trim must never reach the DSP's `effSpeed`**. **`masterPhaseSamples` advances at `linkSpeedRatio` ALONE, never x `g_manualSpeedMul`**; `resyncCoeff` closes residual with a ~42 ms time constant. `eff_speed` reads exactly 1.0000 with no loop recorded. Tempo must hold `kTempoStableBlocksThreshold = sr/N` blocks; after a jump measure only after ~6 s.
- **Our material never moves for Link: the session moves to us.** Only the idle grid snap remains (`!anyAudible`); a join, or a peer reappearing after the count flickers 1->0->1, IMPOSES our phase (`requestPhaseImpose(...)` -> `forceBeatAtTime` off-thread) at circular error > `kJoinSnapErrBeats=0.25`. `wasLinkDriving`/`wasLinkSynced` clear when Link stops driving, so a reconnect reads as a join. The join snap is suppressed on the block that CREATES the grid.
- **A take is born at grid 0** (`masterJustCreated`): grid pinned to 0, beat 0 forced on the session at that instant — take start, grid downbeat and session downbeat are one moment.

**Two quantums — 16 transport, 128 phase CAPTURE.** `kLinkQuantum=16.0` is PAIRED (transport anchor, `beatNow()`, 24-PPQN clock); `controlTick()` captures phase at `kLinkPhaseQuantumBeats=128.0`, publishing `quantumMicroBeats` — consumers fold with `(quantumMicroBeats/1e6)`, never `16.0`. `cmd/recorded_beats` is the FOLD BASIS: unknown => no Link target. `applyRecPlayCycle` publishes bpm/beats BEFORE `master_len`; `pinLinkThreadsToControlCore` -> `kControlCore=2`; `[link] enabled = true` parses as a word, not `%d`. Two-device phrase offset has three causes: stopping a transport you did not start, master length not snapped to whole beats at the Link-driven tempo, and a creation snap using a snapshot stamped BEFORE master creation.

**RESOLVED — `eff_speed` holds 1.0000: our tempo is re-imposed on every peer-count change.** `imposeTempo()` fired once (master-establishing take), so a later merge left `cmd/recorded_bpm` behind and `beatLenSamplesShared` vs `groove.beat_len_samples` differ by exactly `effSpeed` — a NON-INTEGER groove-cell count (4.418 measured, must be 4; the "18 beats per cycle" mechanism). `controlTick()` re-imposes `g_ownedBpm` whenever the peer count settles `kPeerSettleTicks=2` ticks (~400 ms); stable-count tempo changes are still FOLLOWED (`verify-peer-tempo-follow.js`). Witnessed at 118.656 recorded: a peer sweeping to 132 gave `eff_speed` 1.1125, and on its LEAVE (2->1) the session returned to 118.656, `eff_speed` 1.0000, 4.000 cells — before the fix that leave held 0.5522 / 4.418 cells. Both directions log `peers now N` then `first loop owns the tempo: session set to <identical value>`; an external change has neither. A fresh host peer adopts our tempo on join, so only the leave direction shows a numeric correction. `build/link-peer.exe` is a stale pre-sweep build: use `build/link-peer-sweep.exe`.

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — **instrument** (default `hw:0,0`) tight-latency blocking capture+playback; **OTG gadget** (`f_uac2`) best-effort NONBLOCK MIRROR (`-EAGAIN` expected), MASTER on all channels, never cue. Instrument **S32_LE only** (`int32_t` buffer, divisor `2147483648.0f`). `period_size` = `block_size` exactly; `start_threshold` = one period; **4 periods min**; `src/usb/f_uac2-gadget.sh` `req_number` must be **4**. Gadget is STEREO — L/R averaged to mono for Faust.

**`instrument_device` is NOT the config literal**: `instrument_device_match` (default `AIR 192`) substring-matches `/proc/asound/cards` at EVERY open (USB moves `hw:0` between boots).

**Resolve string-keyed lookups ONCE** — control WRITE and telemetry READ cache `(ParamStore slot, Faust zone float*)` at startup. `FaustUI`'s bargraph adders must do `zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan. `targetToZone()` needs a case for every control target — a missing case returns `""`, silent. Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`; `Sampler::captureBlock` reads that `prevFiltOut`, never `fin`.

**SHIFT (`fx/monitorfold`) fold is a CROSSFADE**: `fin[i] = fin[i]*(1-combinedFold) + prevLoopSum[i]*combinedFold`, `combinedFold = min(1, foldGain+glitchFoldGain)`; both ramp at `kFoldStepPerSample = (1/16)/N`. `foldTarget` needs SHIFT held AND no transpose voice gated; `glitchFoldTarget` from `fx/microrepeat_div > 0.5`. Three consumers differ: the Faust `MONITORFOLD`/`GLITCHFOLD` zones get the ramped gains, `freeXposeBuf` the RAW `monitorFoldVal > 0.5` threshold, `loopDirectGateNow` one-pole at `kLoopDirectPole=0.9355`.

**Latency bias is MEASURED.** `snd_pcm_delay`: capture after `readi`, playback before `writei`; `capDelay + playDelay + N` averaged over a 4 s window -> `latency_bias_samples = N + roundTripEst + trim`. It MUST be a window average, never a fast EMA. `latencyBias = latencyBiasSamples + (shiftHeldThisTake ? 64 : 0)`, written at FINISH from `m_looperShiftHeldDuringTake` (latched at ARM off `monitorFold > 0.5`) — the WHOLE round trip anchors a take. `latency_trim_samples` in `[audio]`; `/run/aloop/latency_trim` is polled on the control tick. `pollHolds` rewrites `latencybias` on every looper with content when the measurement moves; unmeasured falls back to `kBlockSize`; `verify-lineup.js` reads the live bias, never a literal 64.

# Faust DSP

## Language gotchas

- **`&` binds tighter than `>`/`<`** — unparenthesised comparisons are silently always true.
- `par()`-replicated UI controls silently duplicate — `button()`/`hslider()` inside a `par()`-instantiated function RE-ELABORATES per call site even hoisted; thread as a plain signal input.
- No runtime branching — `select2`/`ba.if` choose among ALREADY-COMPUTED signals. Hence Guitar/LofiFx are a permanent Core-3 LV2 bundle, cost FLAT in held voices.
- Direct call syntax substitutes whole expressions, not buses — `f(loop(...), a, b)` binds all of `loop(...)` to the FIRST parameter.
- **Recursion is `namedStep ~ _`**: Faust takes no lambda left of `~`. When two recursive signals reference each other, delay BOTH (`x'`, `y'`) or the evaluator hits "stack overflow in eval". Compile through real `faust` as the witness. `dsp/loop.dsp`'s take-state recursions had to be MERGED into one.

## Compiler flags

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/`-mapp`/fast-math/`-mem`/`-vs 16`. **Not shipped**: `-mapp` (aarch64 SIGSEGV), `-fm def`, `ba.tabulate`, per-effect LV2 splitting, `-omp`/`-sch` (fights `pthread_setaffinity_np`), `-mcd`/`-dlt`, `-clang`, `-vs 16` (SIGALRMs ~2 min into `dsp/aloop_pre.dsp`).

## `multitranspose.dsp` — poly pitch-LOCK, 6 voices

`NVOICES=6`, additive with the mono SNAC engine below; each voice owns an `EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep (`BLOCK=64`) whose step MUST stay block-aligned (`m_sinceBlock==0`). `minTrackHz=60.0` floors `freqDet`. `engaged` held by release counter `engageReleaseHoldS=0.06` — never gate on `gate>0.5` or `voiceEnv>0`; hold the voice through its release tail or note-off plays 50 ms unshifted dry. Bus: fixed 0.6 gain + static `ma.tanh`, never `1/sqrt(activeVoices)`. Formant (CC53, deadzone 60-68) via `LpcFormantShifter` (`vowelFormant.h`, `kOrder=44`, `kHpPole=0.5925`, `kAnalysisHop=2048`, `kOctavesMax=3.0`); `beginBlock(n)` runs the reflection glide + `reflectionToDirect` once per `kCoeffUpdateHopSamples=64`. Still ABSOLUTE-pitch-lock (`shiftTarget = targetNote - heldDetNote`).

## Free-transpose engine (`soladSnacOctaver.h`)

`-12` live pitch engine (`pitch_ffi.h`, `pitch.dsp`'s `dubfx_pitch_tick` `ffunction`): SNAC + solad PSOLA + formant grain stage. `DL=32768` (131072 corrupts the Pi's 32-bit-pointer build), `MIN_PERIOD=48`, `DUBFX_BS=64` (poly 16), ~1.333 ms engaged. `m_xfadeLen` DIVIDED by the pitch ratio (clamped >=1.0) or readers drift. The splice cooldown divides by the rate the audio path burns gap at — read `m_scale`, never `m_targetScale`. **Upshift clicks fixed (ad1318e)**: clamp `m_rdA`/`m_rdB` to `m_wr - (SINC_HALF+2)` right after the advance, or the gap emergency lets the head pass the writer and `readSinc` returns audio a whole `DL` late. No latency added.

**Tremolo/AM subharmonic lock — FIXED (174b755). The old "anti-jitter clamp walks to a subharmonic" diagnosis is WRONG** — the bad lock is on the FIRST completed detection, before any prior estimate exists: SNAC takes the highest local peak of r(k), so a modulation period inside the lag range wins outright, and non-periodic frames carry r(k)~0.9999 at every lag so peak-picking returns the search floor. `effects/home/faust/snacPeriodTracker.h` now runs YIN-style cumulative-mean normalized difference (`kDiffAccept` 0.15 / `kDiffStrict` 0.05 / `kDiffFallback` 0.50 cascade; envelope-flattened first). Parabolic refinement CORRECTED to `(c-a)/(2(2b-a-c))`. No latency. Open: `m_confidence` unconsumed, confidence-gated hold unbuilt, >1000 Hz (`MIN_PERIOD=48`) unresolvable.

`GrainFormant` shifts pitch a full octave past ~0.5 formant mix (window-vs-hop limit); `m_inEpoch` free-runs by `Tin` instead of locking to pitch marks. SNAC period bias (-4 c @82 Hz -> -43 c @880 Hz, 0.1 c spread = bias not jitter) is deliberately NOT corrected. `subharmonicPromote` checks `coarseFreq*2/*3` but never `coarseFreq/2`; a ratio within 5% of 2.0x/0.5x needs 60 confirm blocks. `trackingAllowed` = `trustedTracker > 0.5` ALONE. Key pitch-lock runaway: use the `everTrusted` latch and reseed `heldDetNote` to `targetNote` at EVERY `attackEdge` until trust is established once — seeding at `ba.time==0` is useless on real hardware. `extFreqDet` analyzes `fin` only — trust only when `free<0.5`.

## `pitchtracker.lv2`/DawDreamer

`pitchtracker_ac.dsp` — own bundle, `Lv2Host pitchTrackerFx` (`/effects/pitchtracker`): a 37-candidate autocorrelation grid with `subharmonicPromote` + `energyReady`/`holdLastGood` onset gating. DawDreamer's `FaustProcessor` refuses `ffunction` externs: `verify_highoctave_transient.py` is unconditionally red.

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never a bare `nullptr` — Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in the sigsetjmp watchdog `runOne()` uses; a faulting plugin is disabled and the host continues. `readTtl()` must strip trailing slashes from the bundle path. `setControl` matches Faust's MANGLED port symbol (`fx2/FLANGEAMT` -> `fx2_FLANGEAMT_3`).

## Resonode

`resonode_synth.dsp` pulled off the always-on Faust graph into `resonode.lv2` (`Lv2Host resonodeFx`, `/effects/resonode`), called only when `fx/resonode/engaged`; per-voice `note`/`gate`/`vel` are LV2 ports from `ApcGrid`'s MIDI handlers. `resonodeIn` is ZEROED when engaged with no plugins loaded; output re-enters the crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING never layering the original. `RESONODE_ENGAGED` is written via `fui.set()`, bypassing `targetToZone` — two consumers, audit both. The NaN/Inf guard after `resonodeFx.process()` zeroes the block, rate-limited `[diag-resonode]`.

## delayverb

`delayverb.dsp` -> `delayverb.lv2` in two halves; `.process()` only when `delayVerbActive`. **Two separate instances** (`delayVerbFxCue` + `delayVerbFxMaster`) — sharing one corrupted its feedback state; `delayVerbActive` requires BOTH `hasPlugins()`. `cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71` (APC sends NOTES 70/71 ch0). `0x5B` -> `cmd/clearall` owned ONLY by `midi.cpp`. **Tracktion Engine is REJECTED**. Microrepeat recordability uses `loop.dsp`'s record-only 2nd input `glitchIn` (fed `prevGlitchTap` as `fins[1]`), never a one-block feedback loop.

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`midi.cpp`): APC Key25 pads/buttons are **channel 0**, the keybed and sustain CC64 **channel 1**. SHIFT is `kApcBtnShift=0x62` ch0; sustain is CC64 (`d2>=64`), latching `m_sustainLatched`. **A live capture is not representative until SHIFT and latch-sustain are both sent** (`raw 90 62 7f`, then `raw B0 40 7F`, >=0.3s apart).

Every momentary Faust gate must be explicitly released or it sticks at 1 forever: `looperN/erase` (`pollHolds` releases after ~50ms), `looperN/finishreq`, `cmd/clearall`. Every abandon path (`applyRecPlayCycle`'s `rawSamples<=0` abort, `pollHolds`'s hold-erase loop, `onClearAll`) must ALSO pulse `finishreq=1` with `finishtarget` = real telemetry `widx`, or `pend` stays latched; both BEFORE `rec=0` (`rec=0` on FINISH or it re-records forever). ARM on PRESS, FINISH on a **second PRESS**; a press during a far-extend wait is a NO-OP (abort is hold-to-erase only). `kLooperCount=20`; `looperN/hascontent` is the real content slot. Telemetry `loopers.stateflags`: bit0 `pend`, bit1 `fin`, bit2 `act`, bit3 `gate`. **`loop.dsp` writes `wlenNext` only at FINISH and wipe never resets it** — `wraplen>1` is NOT proof of content: track `m_looperWrapLenStaleAfterWipe` (set on clear-all and hold-erase, cleared at FINISH) or the 5 Hz self-heal resurrects wiped loopers as paused. Guitar-fx held REDIRECTS looper pads to `onSidechainLooperToggle`.

## Content phase-anchor

**ARM records from the press, anchored at the NEAREST fine-grid node.** `kFineGridBeats=0.125`; at `armEdge` `rsmNext = rsmNearestNode` (circular correction <= half a cell). Gates: `verify_phase_anchor.py`; `verify-lineup.js` (arms several loopers in ONE MIDI burst; finished length within 2.5 beats of the pad hold).

**Per-loop beat scale `s`**: latched `1/ratioClamped` at `finishEdge`, `1.0` at `armEdge`; `cycleInc = sNext*masterLen` advances on the `masterPhaseWrapped` edge (10th `loop.dsp` input), never per block. Read-head rate is `s*masterPhaseSlope`, so a take drifts off the grid IFF `s != 1`. `effSpeed==1.0` exactly is what makes `varispeedActive` false.

**FINISH length is near-cut/far-extend** (`pickAnchorGridBeats`: 16/8/4/2/1/0.5/0.25/0.125, eps 0.01), CAPPED at one phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot within `cutTolerance = max(1 beat, min(anchor/2, takeLen/8))` cuts to it now, else extends to the next tier. Ceiling `kMaxLoopSamples` (48000*60), floor 64. `dsp/loop.dsp` clamps `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))`; `snappedWrapLen = ceil(finishTakeLen/anchorGridLenNow) * anchorGridLenNow`. `cmd/master_len`'s fallback must run whenever Link is not the length driver — nested inside `if (g_link)` it never ran when the Link object was NULL.

**The first (master-establishing) take OWNS the tempo.** `master_len` stays the raw write index; `deriveTempoQuant(seconds, anchor)` picks a power-of-2 beat count {1..128} whose bpm is log-closest to `anchor` (synced Link tempo with peers, else 120) inside `anchor/2..anchor*2`. `cmd/recorded_bpm`/`cmd/recorded_beats` follow; `LinkBridge::imposeTempo()` pushes that bpm, landing `effSpeed` on 1.0000 (adopting peer tempo TRUNCATED the take). Measure the grid against `master_len_samples / recorded_beats`, the exact published basis, never the rounded `link.bpm`.

## Varispeed punch is BAKED into the take

`cmd/halfspeed`/`cmd/doublespeed` drive `g_manualSpeedMul` (0.5/1/2); `effSpeed = g_manualSpeedMul * linkSpeedRatio`. `dsp/loop.dsp`'s 9th of 10 inputs is `manualSpeed` (`manualSpeedBuf` block-constant): `manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = clamp(effSpeed/manualSafe, 0.1, 8.0)`, `speedClamped = clamp(effSpeed, 0.1, 8.0)`. Beat lengths use `ratioClamped`, never `speedClamped` (`beatLenNow`, `sNext`) — the punch must not scale the grid, or the C++ `finishtarget` (no manual term) stops matching `snappedWrapLen` and a take doubles. Each take latches `v` = `manualSafe` at `finishEdge` (1.0 at `armEdge`); `vBaked = v != 1.0`, `speedForTake = v / manualSafe`, read head advances `speedClamped * sNext * speedForTake` = `v * ratioNow / ratioRec` — finished at 0.5x stays 0.5x. `resyncCoeff` is `0.0005`, forced to `0.0` on `manualPunchActive|vBaked`. Gates `tools/loop-quantization-sim/varispeed-record.js` + `test/hardware/varispeed-record.js` (keep the MIDI injection socket alive across idle gaps).

## FX pages: 3 pages x regular/shift x 8 knobs

| Page | Regular | Shift |
|---|---|---|
| Dub | `fx/{reverb,delay,time,hp,lpres,lp,pitch}`, CC53 Formant | `fx/dubgate/*`+`fx/dublfo/*`, 4-beat clock |
| Guitar | `fx2/{FLANGE,TREMOLO,BANKSPEED,PHASER,DIST,VINYL,FLUTTER}AMT`, CC53 `fx2/GATEAMT` | dual-ADSR to `Sampler` |
| LofiFx | `fx2/BITCRUSHAMT` + 4 patch weights | direct dials (knobs 5-7) |

## Groove: swing + volume gates on the beat pads

`kApcBeatPadNotes={15,23,31,39}` one-of-four latching selectors; `fx/shuffle/mode` (0..4) picks `kGrooveSwings[5]` = `{gridBeats, ratio}` — 8th 0.50/0.54/0.58, 16th 0.58/0.66. Every ODD cell is delayed `(ratio-0.5)*2*gridBeats*grooveBeatLen`, HARD-CAPPED `kGrooveSwingMaxSeconds = 0.040`. Pad N's offset is `kGrooveSwings[N]` (`[0]` straight). Note 7 (`kApcPadGateMod`) HELD + a beat pad pressed turns the pads into `fx/gate/mode` (0..4), `kGrooveGatePeriodBeats[5] = {1.0, 1.0, 0.5, 1.0, 1.0}`: off, chop 1 beat, chop 1/2 beat, pump (duck floor 0.12, exp release 0.18 beat), swell. Gate multiplies `loopSumPreBuf` — the ONE point reaching master out, cue loop and SHIFT-fold identically. Ramps are raised-cosine. **`grooveBeatLen` is TEMPO-derived** (`sr*60/(recordedBpm*effSpeed)`, else Link bpm, else 120) — never `masterLen/recordedBeats`; `beatLenSamplesShared` feeds only the legacy grid. `grooveFreeBeatPos` keeps the gate alive with no loop. Proof `test/hardware/verify-groove-gates.js`; PASSES c4eccdf.

`dsp/loop.dsp` varispeed has NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked` exact); the instant jump and the swing hard clip are INTENTIONAL — never smooth either.

**Beat pads are BEAT-SCHEDULED, never polled.** `Telemetry::gridBeatIndex` comes from the 5 Hz-frozen `LinkSnapshot` with NO extrapolation (unlike `linkTargetSamples`, which does extrapolate), so it steps only at control-tick boundaries — witnessed on the Pi as a constant 200.9 ms staleness at 217 bpm, landing the light 200-300 ms late and jittering per beat. `ApcLeds::refreshBeatPads` bypasses `kRefreshMs`, driven by `LinkBridge::beatMarkNow()` (whole beat + `timeAtBeat(w+1,kLinkQuantum)`); the MIDI thread sleeps `poll()` to it, capped 100 ms so MIDI input still wakes it, and RE-READS the beat after the wake so a late wake draws the right beat. Never re-gate beat pads on `kRefreshMs`; never derive display timing from `gridBeatIndex`.

Loop ring reads use Catmull-Rom cubic; taps wrap at `wrapLen`, not `MAXLEN`.