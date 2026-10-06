# aloop — current-state constraints

Real Pi 4 `192.168.137.100`, root/aloop; Pi 3B+ netboots from host. **aloop is a BEHAVIOR clone of `../looper`, never a source clone**: never vendor its source, never add `LOOPER_DIR`/`loopMachine.cpp`/an effects-bridge shim. DSP = Faust (rwtable + recursive heads).

# Working rules

- **No comments in code, ever** (C++/.dsp/JS/shell/YAML/config, config-like `.gitignore`); one sighting => sweep file. Exempt: `#!`, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, commented-out keys that are only record of an option (`config/aloop.conf`: `disable_core3_lv2`, `latency_trim_samples`). `vendor/` + regenerated Faust output not swept.
- **Never add audio-path latency**: ~7 ms block latency must never grow, even temporarily; stop and ask first. Exempt: engaged wet effect's own algorithmic latency (`ef.transpose`, SNAC).
- **No WSL, no Docker here, ever**; missing compute => GitHub CI/CD (`gh`).
- **Test on real hardware, never ask user to reproduce input**: MIDI injection (`tcp/9401`, `test/hardware/midi-inject.js`) or SSH. Link needs real peer: `test/hardware/link-peer.cpp`, host-built `-static` with `-DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -lws2_32 -lwinmm -liphlpapi -mthreads`, `-I` roots `build/_deps/abletonlink-src/{include,modules/asio-standalone/asio/include}`.
- **Telemetry (udp/4445) answers in ~190 ms from 5 Hz loop; lag JITTERS tens of ms.** Rate only by least-squares slope over every poll of >=20 s watch, skipping ~6 s after FINISH. SLIP = `readpos` vs `master_phase_beats * beatLen` from SAME reply. **Replies TEAR** (`looperReadPos` early, `masterPhaseBeats` later, `snapshotTelemetry()` non-atomic): despike with `despikedSpread()` (`test/hardware/lib/gridlock.js`); torn FIRST poll offsets all later samples.
- **Compiling clean proves nothing**: x86_64 A/B passed while aarch64 codegen SIGSEGV'd (`-mapp`); regenerate real C++ and diff byte-for-byte. Heap-allocate large DSP instances (stack-local `AloopEffectDsp` faults STATUS_STACK_OVERFLOW).
- `t=<sec>.<ms>` logs; WebSearch before irreversible hardware steps; SSH via JS `ssh2` client, never `ssh.exe`/`sshpass`. **SFTP `rename()` is not POSIX `rename(2)`**: overwriting remote path needs unlink first.
- **Faust compile-time cliff**: NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile time (`modeCount=24` SIGALRMs ~2 min into `-i -a lv2.cpp`; `-vs 16` ~2 min into `dsp/aloop_pre.dsp`); declare new controls in `effects_runtime.dsp`. Hence new pitch/shifter engine is C++ bridged by one `ffunction` call, never hand-written per voice in Faust.
- **Crash fix can UNMASK a 2nd bug**: re-measure SAME live metrics after any crash fix.

**Debugging that paid off**: `core_busy` undercounts (only `compute()`, not blocking `readi()` cycle): cross-check `/proc/<tid>/stat` utime+stime vs `/proc/uptime`, `mpstat` per-CPU. `schedstat` voluntary_ctxt_switches ~750/sec = ALSA-blocked, ~46/sec at 95% CPU = hot.

# Boards, images, boot trees

- `image/lib-boot-tree.sh` is BOARD-parameterized (`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`); only `boot_tree_fetch`/`boot_tree_config` dispatch per board. USB-audio gadget: pi4 dwc2 UAC2 only.
- `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/` never appear. `aloop` OpenRC needs `rc_ulimit="-l unlimited -r 95"` in service file, not `local.d`; `depend()` needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never `apk add` at boot (stock Alpine RPi apks repo lacks `hostapd`); alsa-lib needs `vendor/share-alsa/` or `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` + `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line; `core.autocrlf=true` corrupts scripts (fix: `rm` + `git checkout --`). NTFS has no exec bit: new vendored files need both `tar --mode='+x'` lists; verify via `tar -tvzf` (LAST match). Hashing root requires extracting it: `tar -xzOf | md5sum` reads duplicated `./opt/aloop/aloop` member + returns wrong hash.
- `lib-boot-tree.sh` excludes `aloop.lv2`/`resonode.lv2`/`pitchtracker.lv2`/`delayverb.lv2` from home-stack copy.

# Device runtime environment

**Alpine/musl/aarch64: glibc/x86_64 artifacts silently fail to load.** Split `faust2lv2`: `faust -i -a lv2.cpp` emits `.cpp`, `$HOST_CXX` compile+run emits `.ttl`, only final `-shared .so` link targets device. Verify `objdump -p foo.so | grep NEEDED` -> `libc.musl-aarch64.so.1`.

**`disable_core3_lv2` in `/etc/aloop.conf`** (commented out in `config/aloop.conf`): `= 1` makes worker skip `homeFx.process()`/`userFx.process()`; fully silent, survives `rc-service aloop restart`. Match `^\s*disable_core3_lv2\s*=\s*1` (anchored; commented-out line false-positives) before debugging silence as code bug.

**Build traps**: loop engine is TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around `delayverb.lv2`; both must update `audio_thread.cpp` includes in SAME commit or CI ships engine-less binary. **`dsp/effects_runtime.dsp` is imported ONLY by `dsp/aloop.dsp`** (never shipped): shipped entry points import `effects_runtime_pre.dsp`/`effects_runtime_post.dsp`.

# Deploy, netboot, CI

- **The `REBOOT:<token>` UDP listener lives INSIDE aloop process** (`config/aloop.conf` `[remote] token=`, `udp/4446`, `remote_control.cpp`; client `image/aloop-reboot.js`). `aloop` crashed => nothing listens; SSH `reboot` is fallback. Verify device state via `/proc/uptime` + `md5sum /opt/aloop/aloop` BEFORE reading logs.
- **Netboot self-update, two paths.** Automatic: `image/serve-netboot-win.js` polls `build-binary.yml`/`build-lv2.yml` green `main` every 30 s (blind to `image/**`). Manual: `image/build-netboot.sh`, where all four `*_LV2_DIR` vars plus `ALOOP_BIN`/`OUT`/`NETBOOT_SERVER` are **mandatory**. New bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js`. Both workflows gate on source paths; pass `--sha`/`DSP_SHA`. Fast DSP iteration: `node image/dsp-hotdeploy.js --target home|guitar|both`.
- **Netboot facts**: publish is staged-directory atomic `mv` (staging SIBLING of live dir, `OUT_NEW="${OUT}.new.$$"`). `SERVER_IP` baked into root's `cmdline.txt` ONCE: restarting server does not rewrite it; rebuild with `NETBOOT_SERVER` and power-cycle. **TFTP ok but ZERO HTTP requests = hung until power-cycled**; initramfs window 150 s; zero-DISCOVER watchdog fires. Boot reaching `modloop-rpi` + `aloop.apkovl.tar.gz` over HTTP then 2nd DISCOVER is up. HTTP is **`192.168.137.1:8080`**, paths `/aloop.apkovl.tar.gz` + `/boot/modloop-rpi` (not port 80, no bare `modloop-rpi`: a wrong-path 404 is not a server fault); the log tags host-side requests `this host, not the Pi`, so host probes never masquerade as Pi traffic.
- `ubuntu-24.04-arm` runners; `build-image.yml` downloads BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2` from SAME green run, whose log names `binary run:`/`lv2 run:` ids `build-netboot.sh` inputs come from. Rolling `latest` hard-gates on real bundled binary (`payload_check`); artifacts need `retention-days: 3`. `get_parameters_description()` returns params ALPHABETICALLY: harness binds wrong control silently. `LEASE_SECS = 86400`; `ensureCorrectSubnetMask()` rewrites netboot NIC mask every startup: /16 mask broadcasts every OFFER/ACK, so Pi re-DISCOVERs forever with zero TFTP reads.

# Mesh networking

aloop (Pi 4) + `../esp-idf-link` form ONE ad-hoc single-AP mesh for Link's multicast peer discovery (`224.76.78.75:20808`, hardcoded in Link); change BOTH sides or mesh splits.

| Invariant | aloop | esp-idf-link |
|---|---|---|
| SSID | `ssid=ticker` (hostapd/wpa_supplicant) | `wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |
| Transport | CLOCK-ONLY: `enableStartStopSync(false)`, never `setIsPlaying` | CLOCK-ONLY: no transport shared |

`src/net/autoap.sh` hosts `ticker` never `aloop`, needs >=1 active `network={}` block before `start_ap()` does anything.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; audio thread reads lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated at session tempo (5 Hz => ~0.4 beat stale).
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` is unconditioned version + only writer of `weOwnTempo`; never gate `linkSpeedRatio` on it. Match tempo by read RATE (`linkSpeedRatio=linkBpm/recordedBpm` -> `effSpeed`); `imposeTempo()` republishes via `publishSnapshot()` in same call, or finish edge doubles take. It latches `g_ownedBpm`, re-imposed by `controlTick()` on every peer count settling `kPeerSettleTicks=2` ticks (~400 ms), join or leave; 1->0->1 flicker never settles. `resetTempoAuthority()` clears it with `cmd/recorded_bpm`.
- **CLOCK-ONLY: tempo+phase shared, transport never.** `midi_clock.cpp` never emits `0xFC`. aloop IS mesh's sole transport emitter; `publishTransport` must use `setIsPlayingAndRequestBeatAtTime`, not `setIsPlaying` (stop path keeps plain `setIsPlaying`). `applyRemoteTransport` must reset `m_lastRemotePhaseMicroBeats` to -1 when arming `m_remoteStartPending`. 24-PPQN out has NO sink on this hardware: the only rawmidi is `midiC1D0` = APC Key 25 (`09e8:0027`), excluded as control surface, so `outs.count == 0` and `MidiClock::run()` skips every pulse — the re-anchor guard (`session phase moved back N pulse(s)`) firing 0 times is CORRECT, not a bug; verifying it needs an external MIDI sink attached. Log witness: `/var/log/aloop.log` `[midi-clock] started` with no `sending clock to`.
- **Local transport never stops: paused looper is MUTED, not stopped.** `ApcGrid::updateLocalTransport` starts it once, never reports stopped; `g_localTransportRunning` defaults true.
- Phase trim bounded, on `masterPhaseSamples` ONLY (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`, else 51-cent detune). `masterPhaseBuf` ramps per-sample (never `std::fill()`) at `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`; `effSpeed = g_manualSpeedMul*linkSpeedRatio` carries TEMPO alone: **trim must never reach DSP's `effSpeed`**. `masterPhaseSamples` advances at `linkSpeedRatio` ALONE, never x `g_manualSpeedMul`; `resyncCoeff` closes residual, ~42 ms time constant. `eff_speed` reads exactly 1.0000 with no loop recorded. Tempo must hold `kTempoStableBlocksThreshold = sr/N` blocks; after jump measure after ~6 s.
- **Our material never moves for Link: session moves to us.** Only idle grid snap remains (`!anyAudible`); join (incl. reappearing peer) IMPOSES our phase (`requestPhaseImpose(...)` -> `forceBeatAtTime` off-thread) at circular error > `kJoinSnapErrBeats=0.25`. `wasLinkDriving`/`wasLinkSynced` clear when Link stops driving, so reconnect reads as join. Join snap suppressed on block that CREATES grid.
- **Take born at grid 0** (`masterJustCreated`): grid pinned 0, beat 0 forced on session at that instant.

**Two quantums: 16 transport, 128 phase CAPTURE.** `kLinkQuantum=16.0` is PAIRED (transport anchor, `beatNow()`, 24-PPQN clock); `controlTick()` captures phase at `kLinkPhaseQuantumBeats=128.0`, publishing `quantumMicroBeats`; consumers fold with `(quantumMicroBeats/1e6)`, never `16.0`. `cmd/recorded_beats` is FOLD BASIS: unknown => no Link target. `applyRecPlayCycle` publishes bpm/beats BEFORE `master_len`; `pinLinkThreadsToControlCore` -> `kControlCore=2`; `[link] enabled = true` parses as word, not `%d`. `build/link-peer.exe` stale: use `build/link-peer-sweep.exe`. Two-device phrase offset, 3 causes: stopping a transport you did not start; master length not snapped to whole beats at the Link-driven tempo; creation snap using a snapshot stamped BEFORE master creation.

# Audio thread and ALSA

`worker()` opens two PCMs: **instrument** (default `hw:0,0`) tight-latency blocking capture+playback; **OTG gadget** (`f_uac2`) best-effort NONBLOCK MIRROR (`-EAGAIN` expected), MASTER on all channels, never cue. Instrument **S32_LE only** (`int32_t` buffer, divisor `2147483648.0f`). `period_size` = `block_size`; `start_threshold` = one period; **4 periods min**; `src/usb/f_uac2-gadget.sh` `req_number` must be **4**. **`instrument_device` is NOT config literal**: `instrument_device_match` (default `AIR 192`) substring-matches `/proc/asound/cards` at EVERY open.

**Resolve string-keyed lookups ONCE**: control WRITE + telemetry READ cache `(ParamStore slot, Faust zone float*)` at startup. `FaustUI` bargraph adders must do `zones[full(l)]=z` or `hbargraph()` falls through to O(n) scan. `targetToZone()` needs case for every control target; missing case returns `""` (silent). Recording taps `loop.dsp` `prevFiltIn` fed from `prevFiltOut`; `Sampler::captureBlock` reads that `prevFiltOut`, never `fin`.

**SHIFT (`fx/monitorfold`) fold is CROSSFADE**: `fin[i] = fin[i]*(1-combinedFold) + prevLoopSum[i]*combinedFold`, `combinedFold = min(1, foldGain+glitchFoldGain)`; both ramp at `kFoldStepPerSample = (1/16)/N`. `foldTarget` needs SHIFT held AND no transpose voice gated; `glitchFoldTarget` from `fx/microrepeat_div > 0.5`. Three consumers differ: Faust `MONITORFOLD`/`GLITCHFOLD` zones take ramped gains, `freeXposeBuf` RAW `monitorFoldVal > 0.5` threshold, `loopDirectGateNow` one-pole at `kLoopDirectPole=0.9355`.

**Latency bias is MEASURED.** `snd_pcm_delay`: capture after `readi`, playback before `writei`; `capDelay + playDelay + N` averaged over 4 s window -> `latency_bias_samples = N + roundTripEst + trim`. MUST be window average, never fast EMA. `latency_trim_samples` in `[audio]`; `/run/aloop/latency_trim` polled on control tick. `pollHolds` rewrites `latencybias` on every looper with content when measurement moves; unmeasured falls back to `kBlockSize`.

**Resample (SHIFT) bias is DERIVED, never constant.** `D_fold = 2N` (full fold: no instrument round trip), `D_dry = N + roundTripEst` = shipped `latency_bias_samples`. Bias = `round(D_dry*(1-f) + (2*blockSize + L_chain)*f)`; `f` = mean `combinedFold` over take (`resampleFoldSum`/`resampleFoldSamples`; PREVIOUS block's fold), windowed ARM(`armResampleFoldWindow`)->FINISH; unwindowed => `shiftHeld ? 1 : 0`. `L_chain = 128*engagedFraction + 128*shiftFraction` (`resampleChainSum`/`Samples`, prev block's `engagedZone`/`SEMIS`); `engagedZone` written 1, never cleared, so shift term tests `|SEMIS|>0.01`, never `engagedZone`. Shifting costs 132..1218 samples; `+128` = p25 (139) rounded DOWN onto 16-sample grid: under-correcting, proportional. Telemetry `resample_fold`/`resample_chain`; `[diag-latency]` logs at FINISH when `f > 0.01`; tolerance ±16 samples (`kToleranceSamples`, `verify-late-lineup.js`); the intra-take sawtooth (~±170) no scalar removes.

# Faust DSP

## Language gotchas

- **`&` binds tighter than `>`/`<`**: unparenthesised comparisons are silently always true.
- `par()`-replicated UI controls RE-ELABORATE per call site: `button()`/`hslider()` inside `par()`-instantiated function duplicates even hoisted; thread as plain signal input.
- No runtime branching: `select2`/`ba.if` choose among ALREADY-COMPUTED signals. Hence Guitar/LofiFx are permanent Core-3 LV2 bundle, cost FLAT in held voices.
- Direct call syntax substitutes whole expressions, not buses: `f(loop(...), a, b)` binds all of `loop(...)` to FIRST parameter.
- **Recursion is `namedStep ~ _`**: Faust takes no lambda left of `~`. Two mutually-referencing recursive signals must BOTH be delayed (`x'`, `y'`) or evaluator hits "stack overflow in eval". `dsp/loop.dsp` take-state recursions MERGED into one.

## Compiler flags

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/`-mapp`/fast-math/`-mem`/`-vs 16`. **Not shipped**: `-mapp` (aarch64 SIGSEGV), `-fm def`, `ba.tabulate`, per-effect LV2 splitting, `-omp`/`-sch` (fights `pthread_setaffinity_np`), `-mcd`/`-dlt`, `-clang`.

## `multitranspose.dsp` — poly pitch-LOCK, 6 voices

`NVOICES=6`; each voice owns `EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep (`BLOCK=64`) whose step MUST stay block-aligned (`m_sinceBlock==0`). `minTrackHz=60.0` floors `freqDet`. `engaged` held by release counter `engageReleaseHoldS=0.06`: never gate on `gate>0.5`/`voiceEnv>0` or note-off plays 50 ms unshifted dry. Bus: fixed 0.6 gain + static `ma.tanh`, never `1/sqrt(activeVoices)`. Formant (CC53, deadzone 60-68) via `LpcFormantShifter` (`vowelFormant.h`, `kOrder=44`, `kHpPole=0.5925`, `kAnalysisHop=2048`, `kOctavesMax=3.0`); `beginBlock(n)` runs reflection glide + `reflectionToDirect` once per `kCoeffUpdateHopSamples=64`.

## Free-transpose engine (`soladSnacOctaver.h`)

`-12` live pitch engine (`pitch_ffi.h`, `pitch.dsp` `dubfx_pitch_tick` `ffunction`): SNAC + solad PSOLA + formant grain stage. `DL=32768` (131072 corrupts Pi's 32-bit-pointer build), `MIN_PERIOD=48`, `DUBFX_BS=64` (poly 16), 128 smp engaged (64 ffi + 64 solad read offset), 0 bypassed. `m_xfadeLen` DIVIDED by pitch ratio (clamped >=1.0) or readers drift. Splice cooldown divides by rate path burns gap at: read `m_scale`, never `m_targetScale`. **Upshift clicks**: clamp `m_rdA`/`m_rdB` to `m_wr - (SINC_HALF+2)` right after advance, or gap emergency lets head pass writer and `readSinc` returns audio whole `DL` late.

**Tremolo/AM subharmonic lock: old "anti-jitter clamp walks to a subharmonic" diagnosis is WRONG.** Bad lock lands on FIRST completed detection: SNAC takes highest local peak of r(k), so modulation period in lag range wins; non-periodic frames carry r(k)~0.9999 at every lag => peak-picking returns search floor. `effects/home/faust/snacPeriodTracker.h` runs YIN-style cumulative-mean normalized difference (`kDiffAccept` 0.15 / `kDiffStrict` 0.05 / `kDiffFallback` 0.50 cascade; envelope-flattened first); parabolic refinement CORRECTED to `(c-a)/(2(2b-a-c))`. OPEN: `m_confidence` unconsumed; confidence-gated hold unbuilt; >1000 Hz (`MIN_PERIOD=48`) unresolvable.

`GrainFormant` shifts pitch full octave past ~0.5 formant mix; `m_inEpoch` free-runs by `Tin`. SNAC period bias (-4 c @82 Hz -> -43 c @880 Hz) deliberately NOT corrected. `subharmonicPromote` checks `coarseFreq*2/*3` but never `coarseFreq/2`; ratio within 5% of 2.0x/0.5x needs 60 confirm blocks. `trackingAllowed` = `trustedTracker > 0.5` ALONE. Key pitch-lock runaway: use `everTrusted` latch + reseed `heldDetNote` to `targetNote` at EVERY `attackEdge` until trust established once. `extFreqDet` analyzes `fin` only: trust only when `free<0.5`.

## `pitchtracker.lv2`/DawDreamer

`pitchtracker_ac.dsp` own bundle, `Lv2Host pitchTrackerFx` (`/effects/pitchtracker`): 37-candidate autocorrelation grid with `subharmonicPromote` + `energyReady`/`holdLastGood` onset gating. DawDreamer's `FaustProcessor` refuses `ffunction` externs: `verify_highoctave_transient.py` always red. It is **host faust witness** (`test/phrase-anchor/harness.py`, real libfaust, real flags, full `MAXLEN`): faustwasm rejects `-fun`/`-nvi`/`-vec` + needs `dsp.start()` before `compute()`.

# LV2 hosting

`Lv2Host::instantiate()` needs NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never bare `nullptr`: Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in sigsetjmp watchdog `runOne()` uses. `readTtl()` must strip trailing slashes from bundle path. `setControl` matches Faust's MANGLED port symbol (`fx2/FLANGEAMT` -> `fx2_FLANGEAMT_3`).

## Resonode

`resonode_synth.dsp` pulled off always-on Faust graph into `resonode.lv2` (`Lv2Host resonodeFx`, `/effects/resonode`), called only when `fx/resonode/engaged`; per-voice `note`/`gate`/`vel` are LV2 ports from `ApcGrid` MIDI handlers. `resonodeIn` ZEROED when engaged with no plugins loaded; output re-enters crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING never layering original. `RESONODE_ENGAGED` written via `fui.set()`, bypassing `targetToZone`: two consumers, audit both. NaN/Inf guard after `resonodeFx.process()` zeroes the block, rate-limited `[diag-resonode]`.

## delayverb

`delayverb.dsp` -> `delayverb.lv2` in two halves; `.process()` only when `delayVerbActive`. **Two separate instances** (`delayVerbFxCue` + `delayVerbFxMaster`): sharing one corrupted its feedback state; `delayVerbActive` requires BOTH `hasPlugins()`. `0x5B` -> `cmd/clearall` owned ONLY by `midi.cpp`. **Tracktion Engine is REJECTED**. Microrepeat recordability uses `loop.dsp` record-only 2nd input `glitchIn` (fed `prevGlitchTap` as `fins[1]`), never one-block feedback loop.

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`midi.cpp`): APC Key25 pads/buttons **channel 0**, keybed + sustain CC64 **channel 1**. SHIFT = `kApcBtnShift=0x62` ch0; sustain CC64 (`d2>=64`) latches `m_sustainLatched`. **Live capture unrepresentative until SHIFT + latch-sustain both sent** (`raw 90 62 7f`, then `raw B0 40 7F`, >=0.3s apart).

Every momentary Faust gate needs explicit release or sticks at 1: `looperN/erase` (`pollHolds` ~50ms), `looperN/finishreq`, `cmd/clearall`. Every abandon path (`applyRecPlayCycle` `rawSamples<=0` abort, `pollHolds` hold-erase, `onClearAll`) must pulse `finishreq=1` + `finishtarget` = real telemetry `widx`, both BEFORE `rec=0`, or `pend` stays latched (`rec=0` on FINISH or re-records forever). ARM on PRESS, FINISH on 2nd PRESS; press during far-extend wait = NO-OP (abort = hold-to-erase only). **`kHoldEraseMs = 1000`** (apc_grid.h:19): press held >= 1000 ms = hold-to-erase; `pollHolds` erases looper, clears `m_looperHasContent`, `!anyHasContent && m_masterLenSamples != 0` self-heal zeroes `cmd/master_len`/`cmd/recorded_bpm`/`cmd/recorded_beats` + calls `link->resetTempoAuthority()`. Hardware witnesses use ~150 ms presses. `kLooperCount=20`; `looperN/hascontent` = real content slot. `loopers.stateflags`: bit0 `pend`, bit1 `fin`, bit2 `act`, bit3 `gate`. **`loop.dsp` writes `wlenNext` only at FINISH; wipe never resets it**: `wraplen>1` NOT proof of content; track `m_looperWrapLenStaleAfterWipe` (set clear-all/hold-erase, cleared FINISH) or 5 Hz self-heal resurrects wiped loopers as paused. Guitar-fx held REDIRECTS looper pads to `onSidechainLooperToggle`.

## Content phase-anchor

**ARM records from press, anchored at NEAREST fine-grid node.** `kFineGridBeats=0.125`; at `armEdge` `rsmNext = rsmNearestNode` (circular correction <= half cell). Gates: `verify_phase_anchor.py`; `verify-lineup.js` (several loopers in ONE MIDI burst; length within 2.5 beats of pad hold).

**Per-loop beat scale `s`**: latched `1/ratioClamped` at `finishEdge`, `1.0` at `armEdge`; `cycleInc = sNext*masterLen` advances on `masterPhaseWrapped` edge, never per block. Read-head rate is `s*masterPhaseSlope`, so take drifts off grid IFF `s != 1`.

**FINISH length is near-cut/far-extend** (`pickAnchorGridBeats`: 16/8/4/2/1/0.5/0.25/0.125, eps 0.01), CAPPED at one phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot within `cutTolerance = max(1 beat, min(anchor/2, takeLen/8))` cuts now, else extends to next tier. Ceiling `kMaxLoopSamples` (48000*60), floor 64. `snappedWrapLen = ceil(finishTakeLen/anchorGridLenNow) * anchorGridLenNow`, `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))`. `cmd/master_len` fallback must run whenever Link is not length driver: nested inside `if (g_link)` it never ran with NULL Link.

**First (master-establishing) take OWNS tempo.** `master_len` stays raw write index; `deriveTempoQuant(seconds, anchor)` picks power-of-2 beat count {1..128} whose bpm is log-closest to `anchor` (synced Link tempo with peers, else 120) inside `anchor/2..anchor*2`. `cmd/recorded_bpm`/`cmd/recorded_beats` follow; `LinkBridge::imposeTempo()` pushes that bpm, landing `effSpeed` on 1.0000 (adopting peer tempo TRUNCATED take). Link-driven length path must not pin `looperLen`/`MLB`/`recorded_beats` over take that already exists. Measure grid against `master_len_samples / recorded_beats`, exact published basis, never rounded `link.bpm`.

## Varispeed punch: BAKED into dry take, REPLAYED out of SHIFT resample

`cmd/halfspeed`/`cmd/doublespeed` are APC **NOTES 70/71 ch0** (never cc70/cc71) -> `g_manualSpeedMul` (0.5/1/2) -> `effSpeed`. `loop.dsp` 9th input is `manualSpeed`, 10th `foldNow` (raw SHIFT `freeXpose`): `manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = clamp(effSpeed/manualSafe, 0.1, 8.0)`, `speedClamped = clamp(effSpeed, 0.1, 8.0)`. Beat lengths use `ratioClamped`, never `speedClamped`: else C++ `finishtarget` (no manual term) stops matching `snappedWrapLen` + take doubles.

**Dry take** (`foldNext == 0`): latches `v = manualSafe` at `finishEdge` (1.0 at `armEdge`); `vBaked = v != 1.0`, `speedForTake = v / manualSafe`.

**SHIFT-resample take** (`foldNext == 1`, sticky from `armEdge`): fold tap is post-varispeed, so punch is IN captured audio (that audio IS performance); read it at LIVE punch alone (`vNext` forced to 1.0 at `finishEdge`, so `vBaked` false, `speedForTake = 1.0`). **Never divide captured punch back out** (`speedForTake = 1/rateStored`): neutral 440 Hz, tap pattern discarded; `kRateDecim = 64` flickered `resyncCoeff` 0/0.0005 in one take.

## FX pages: 3 pages x regular/shift x 8 knobs

| Page | Regular | Shift |
|---|---|---|
| Dub | `fx/{reverb,delay,time,hp,lpres,lp,pitch}`, CC53 Formant | `fx/dubgate/*`+`fx/dublfo/*`, 4-beat clock |
| Guitar | `fx2/{FLANGE,TREMOLO,BANKSPEED,PHASER,DIST,VINYL,FLUTTER}AMT`, CC53 `fx2/GATEAMT` | dual-ADSR to `Sampler` |
| LofiFx | `fx2/BITCRUSHAMT` + 4 patch weights | direct dials (knobs 5-7) |

## Groove: swing + volume gates on beat pads

`kApcBeatPadNotes={15,23,31,39}` one-of-four latching selectors; `fx/shuffle/mode` (0..4) picks `kGrooveSwings[5]` = `{gridBeats, ratio}`: 8th 0.50/0.54/0.58, 16th 0.58/0.66. Every ODD cell delayed `(ratio-0.5)*2*gridBeats*grooveBeatLen`, HARD-CAPPED `kGrooveSwingMaxSeconds = 0.040`. Note 7 (`kApcPadGateMod`) HELD + beat pad turns pads into `fx/gate/mode` (0..4), `kGrooveGatePeriodBeats[5] = {1.0, 1.0, 0.5, 1.0, 1.0}`: off, chop 1 beat, chop 1/2 beat, pump (duck floor 0.12, exp release 0.18 beat), swell. Gate multiplies `loopSumPreBuf`: ONE point reaching master out, cue loop + SHIFT-fold identically. **`grooveBeatLen` is TEMPO-derived** (`sr*60/(recordedBpm*effSpeed)`, else Link bpm, else 120): never `masterLen/recordedBeats`.

`dsp/loop.dsp` varispeed has NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked` exact); instant jump + swing hard clip INTENTIONAL: never smooth either.

**Beat pads are BEAT-SCHEDULED, never polled.** `Telemetry::gridBeatIndex` is 5 Hz-frozen `LinkSnapshot` with NO extrapolation (unlike `linkTargetSamples`), so steps at control ticks: 0..217 ms behind at 217 bpm (mean 105 ms). `ApcLeds::refreshBeatPads` bypasses `kRefreshMs`, driven by `LinkBridge::beatMarkNow()` (whole beat + `timeAtBeat(w+1,kLinkQuantum)`); MIDI thread sleeps `poll()` to it, capped 100 ms, RE-READS beat after wake. Telemetry `beat_mark` + `beat_pad_mark` (seq/index/late_ms/bpm) witness it; `beat_pad_mark` advances only while `beatClockUsable` holds (Link peer, bpm > 1, `master_len_samples > 0`), so witness needs `build/link-peer-sweep.exe 217 16 0` on host plus real finished take. Device witness CONFIRMED (93 transitions, 150 ms presses, 120.56 bpm / 8 beats): median 0.6 ms, mean 0.6, p95 1.1, max 1.1; host soak median 9.2.

Loop ring reads use Catmull-Rom cubic; taps wrap at `wrapLen`, not `MAXLEN`.
