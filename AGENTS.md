# aloop — current-state constraints

Real Pi 4 `192.168.137.100`, root/aloop; a real Pi 3B+ netboots from the host.

**aloop is a BEHAVIOR clone of `../looper`, never a source clone** — looper is Circle bare-metal; never vendor its source, never add `LOOPER_DIR`/`loopMachine.cpp`/an effects-bridge shim. The equivalence proof is an A/B, not shared source. DSP = Faust (rwtable + recursive heads); discrete control (command edge-detection, dynamic loop length, MIDI, file I/O) = a thin native shim feeding Faust params.

# Working rules

- **No comments in code, ever** (C++/.dsp/JS/shell/YAML/config, and config-like files such as `.gitignore`); one sighting => sweep that whole file; never trust an in-repo comment — "already cached / already cheap" is a claim, not a fact. Before deleting one, check whether it encodes a witnessed root cause; if so it moves here. Exempt: `#!`, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, commented-out keys that are the only record of an option (`config/aloop.conf`: `disable_core3_lv2`, `latency_trim_samples`). Vendored third-party trees (`vendor/`) and regenerated Faust output are not swept.
- **Never add audio-path latency** — the ~7 ms block latency must never grow, even temporarily; stop and ask first. Exempt: a wet effect's own engaged-only algorithmic latency (`ef.transpose`, SNAC).
- **No WSL, no Docker here, ever** — no `wsl.exe` for builds/checks/probes/installs; missing compute => GitHub CI/CD (`gh`, native `ubuntu-24.04-arm`) or the kaggle CLI. A stopped Ubuntu distro remains; uninstalling destroys it — ask first.
- **Test on real hardware, never ask the user to reproduce input** — MIDI injection (`tcp/9401`, `test/hardware/midi-inject.js`) or SSH. Link needs a real peer: `test/hardware/link-peer.cpp`, host-built `-static` with `-DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -lws2_32 -lwinmm -liphlpapi -mthreads`, `-I` roots `build/_deps/abletonlink-src/{include,modules/asio-standalone/asio/include}`, output inside `build/` (`.deploy/` gets wiped).
- **Telemetry (udp/4445) answers in ~190 ms from the 5 Hz loop; the lag JITTERS by tens of ms.** Never rate from two endpoint samples vs the host clock: least-squares slope over every poll of a >=20 s watch, skipping ~6 s after FINISH; <12 surviving polls => report too-short window, not a rate. Measure SLIP: `readpos` vs `master_phase_beats * beatLen` from the SAME reply. Clean slate is read off `loopers.play` before the press, never back-extrapolated from a `Date.now()` round trip. `master_phase_beats` publishes at 0.00001 beat. **Replies TEAR**: `looperReadPos` is published early in the block, `masterPhaseBeats` later, and `snapshotTelemetry()` is a non-atomic struct copy — ~1 reply in 200 mixes two blocks, showing as a lone ~N-sample step that snaps back. Never read a raw grid-lock spread: despike with `despikedSpread()` from `test/hardware/lib/gridlock.js` (drops a sample whose ±2 neighbours all sit >16 samples away). A torn FIRST poll offsets every later sample from it — that is what a "67-sample drift" over a soak really is.
- **Compiling clean proves nothing** — x86_64 A/B passed while aarch64 codegen SIGSEGV'd (`-mapp`); before accepting any `.dsp` optimization regenerate real C++ and diff byte-for-byte. Heap-allocate large DSP instances (stack-local `AloopEffectDsp` faults STATUS_STACK_OVERFLOW, ~320 MB). `tools/loop-quantization-sim` scales per-sample constants by `kSimSpeedup = 48000/SIM_SAMPLE_RATE`.
- **Logs carry wall-clock `t=<sec>.<ms>`** (`CLOCK_MONOTONIC`); WebSearch before irreversible hardware steps; SSH via a JS `ssh2` client, never `ssh.exe`/`sshpass`. **SFTP `rename()` is not POSIX `rename(2)`** — overwriting an existing remote path needs an explicit unlink first on this device's sftp-server.
- **Faust compile-time cliff**: a NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile time (`modeCount=24` SIGALRMs ~2 min into `-i -a lv2.cpp`) — declare new controls in `effects_runtime.dsp`, thread in as plain signal args. This is why a new pitch/shifter engine is a C++ engine bridged by one `ffunction` call (as `pitch_ffi.h` already does), never hand-written per voice in Faust.

# Debugging techniques that paid off here

- **`core_busy` undercounts**: covers only `compute()`, not the read-compute-write cycle with the blocking `readi()`. Cross-check telemetry against OS ground truth (`/proc/<tid>/stat` utime+stime vs `/proc/uptime`, `mpstat` per-CPU).
- **`schedstat` voluntary_ctxt_switches separates blocked from spinning**: blocked in an ALSA hardware wait => ~750/sec; ~46/sec at 95% on-CPU means hot, not waiting.
- **On-CPU time exceeding the app's own timers => read the code BETWEEN the timed spans** for string-keyed, allocating or unbounded work. That gap found per-block `targetToZone()` + two map lookups behind 39047 climbing xruns (resolve-once caching; xruns -> 0).
- **A crash fix can UNMASK a second bug** free-riding on it — a watchdog-disabled plugin costs ~0% CPU, so enabling it exposes the real cost. Re-measure the SAME live metrics (core_busy, xruns, diag-gap) after any crash fix.
- **Packaging must separate "validates something" from "is a runtime effect"**: a blanket `cp *.lv2` is how CI-only `aloop.lv2` (built from the source the native path already runs) got deployed and run twice. Hence the exclusion list in `lib-boot-tree.sh`.
- **Verify the test tool before trusting its verdict**, especially one built in an investigation that never reached a successful end-to-end run.
- **Live-reload deploy (SFTP swap + `rc-service` restart, seconds) beats a netboot power-cycle (minutes)** for hardware A/B.

# Boards, images, boot trees

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`: `pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`); only `boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config` (cmdline/USB-gadget) dispatch per board; `boot_tree_apkovl` is shared. `board_supports_usb_gadget`/`board_wifi_irq_name`/`board_firmware_names` are authoritative. USB-audio gadget: pi4 dwc2 UAC2 only (pi3 no OTG, pi5 RP1 host-only, opi-prime unproven); `boot_tree_fetch_opi` uses `dl.armbian.com/orangepiprime/Trixie_current_minimal`. ROM order SD -> USB -> Network: a card wiped of `bootcode.bin` falls through to network; confirm which path booted.

## apkovl assembly constraints

- `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/` never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"` in the service file, not `local.d`; `depend()` needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never `apk add` at boot; alsa-lib also needs `vendor/share-alsa/` or `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` + `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line (`tr '\n' ' '` + `tr -s ' '`); `core.autocrlf=true` corrupts scripts — fix via `rm` + `git checkout --`. NTFS has no exec bit: new vendored files need both `tar --mode='+x'` lists; verify via `tar -tvzf` (LAST match).
- `lib-boot-tree.sh` excludes `aloop.lv2`/`resonode.lv2`/`pitchtracker.lv2`/`delayverb.lv2` from the home-stack copy.

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.** Split `faust2lv2`: `faust -i -a lv2.cpp` emits `.cpp`, `$HOST_CXX` compile+run emits `.ttl`, only the final `-shared .so` link targets the device. Verify `objdump -p foo.so | grep NEEDED` -> `libc.musl-aarch64.so.1`, never `libc.so.6`.

**`upload-artifact@v4` `path:`**: a literal path flattens the dir's CONTENTS at the zip root, dropping the `.lv2/` wrapper — always use a wildcard.

**`disable_core3_lv2` in `/etc/aloop.conf`** (commented out in `config/aloop.conf`): `= 1` makes the worker skip `homeFx.process()`/`userFx.process()` — fully silent, survives `rc-service aloop restart`; grep it before debugging silence as a code bug.

**Build traps**: the loop engine is TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around `delayverb.lv2`; both must update `audio_thread.cpp`'s includes in the SAME commit or CI ships an engine-less binary. Link is fetched non-shallow.

# Deploy, netboot, CI

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process** (`config/aloop.conf` `[remote] token=`, `udp/4446`, `remote_control.cpp`; client `image/aloop-reboot.js`). If `aloop` crashed, nothing listens — `respawn_max=0`; SSH `reboot` is the fallback. Verify before trusting device state: `/proc/uptime` and `md5sum /opt/aloop/aloop` vs deployed, BEFORE reading logs.

**Netboot self-update, two paths.** Automatic: `image/serve-netboot-win.js` polls `build-binary.yml`/`build-lv2.yml` green `main` every 30 s (blind to `image/**`); needs an elevated shell. Manual: `image/build-netboot.sh`, where all four `*_LV2_DIR` vars plus `ALOOP_BIN`/`OUT`/`NETBOOT_SERVER` are **mandatory**. A new bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js` — neither reads the other's list. Both workflows gate on source paths, so a packaging/docs-only commit gets no run — pass `--sha`/`DSP_SHA`. Before rebooting onto a rebuilt root, `md5sum opt/aloop/aloop` in the new `.netboot-serve/aloop.apkovl.tar.gz`.

**Netboot facts**: publish is a staged-directory atomic `mv` (staging a SIBLING of the live dir). `SERVER_IP` is baked into the root's `cmdline.txt` ONCE — restarting the server does not rewrite it; rebuild with `NETBOOT_SERVER` and power-cycle. **TFTP ok but ZERO HTTP requests = hung until power-cycled** (diskless init does NOT retry). Fast DSP iteration: `node image/dsp-hotdeploy.js --target home|guitar|both`. `ubuntu-24.04-arm` runners; `build-image.yml` downloads BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2` from the SAME green run. Rolling `latest` hard-gates on a real bundled binary (`payload_check`); artifacts need `retention-days: 3`. `get_parameters_description()` returns params ALPHABETICALLY — a harness binds the wrong control silently.

`LEASE_SECS = 86400`; `ensureCorrectSubnetMask()` rewrites the netboot NIC mask every startup — a /16 mask broadcasts every OFFER/ACK, so the Pi re-DISCOVERs forever with zero TFTP reads. A Windows Firewall rule can silently make the Pi unreachable. Netboot log: only remote HTTP requests count toward the stall diagnosis; initramfs window 150 s; a zero-DISCOVER watchdog fires.

# Mesh networking

## aloop <-> esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) + `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc single-AP mesh for Link's multicast peer discovery (`224.76.78.75:20808`, hardcoded in Link).

| Invariant | aloop | esp-idf-link |
|---|---|---|
| SSID | `ssid=ticker` (hostapd/wpa_supplicant) | `wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |
| Transport | CLOCK-ONLY: `enableStartStopSync(false)`, never `setIsPlaying` | CLOCK-ONLY: no transport shared |

Host election is MAC-ordered — never "host if scan found nothing". `src/net/autoap.sh` hosts `ticker` never `aloop`, needs >=1 active `network={}` block before `start_ap()` does anything, and `start_ap()` clears previous hostapd too. The AP is open: `hostapd.conf` carries only `ssid=ticker` + `channel=6`.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; the audio thread reads a lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated at the session tempo (5 Hz => ~0.4 beat stale).
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` is the unconditioned version and the only writer of `weOwnTempo` — never gate `linkSpeedRatio` on it. Match tempo by read RATE (`linkSpeedRatio=linkBpm/recordedBpm` -> `effSpeed`), never a position jump; `imposeTempo()` republishes via `publishSnapshot()` in the same call, or the finish edge quantizes against a stale snapshot and doubles the take.
- **CLOCK-ONLY (table above): tempo+phase shared, transport never** — pausing locally leaves peers playing, none can start/stop us, and `midi_clock.cpp` never emits `0xFC` (not on pause, not on exit): it keeps pulsing `0xF8`, sends one `0xFA` when an output is first discovered.
- **Local transport never stops: a paused looper is MUTED, not stopped.** `ApcGrid::updateLocalTransport` starts it once and never reports stopped; `g_localTransportRunning` defaults true. The 4 beat-pad LEDs track `gridBeatIndex` whether or not anything plays. Proof: `test/hardware/verify-transport-stays-running.js`.
- Readiness: `depend(){ after local autoap; }` plus `waitForNetworkInterface()`.
- Residual phase error is a bounded trim on `masterPhaseSamples` ONLY (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`, else it saturates into a 51-cent detune). `masterPhaseBuf` ramps per-sample (never `std::fill()` block-constant) at `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`; `effSpeed = g_manualSpeedMul*linkSpeedRatio` carries the TEMPO alone — **the trim must never reach the DSP's `effSpeed`**. `eff_speed` reads exactly `1.0000` with no loop recorded. Tempo must hold `kTempoStableBlocksThreshold = sr/N` blocks; after a tempo jump measure only after ~6 s.
- **Our material never moves for Link: the session moves to us.** Only the idle grid snap remains (`!anyAudible`); a join, or a peer reappearing after the count flickers 1->0->1, IMPOSES our phase (`requestPhaseImpose(...)` -> `forceBeatAtTime` off-thread) at circular error > `kJoinSnapErrBeats=0.25`. `wasLinkDriving`/`wasLinkSynced` clear when Link stops driving, so a reconnect reads as a join and snaps; the join snap is suppressed on the block that CREATES the grid.
- **A take is born at grid 0** (`masterJustCreated`): grid pinned to 0, beat 0 forced on the session at that instant — take start, grid downbeat and session downbeat are one moment, `eff_speed` stays 1.0000.

**Two quantums — 16 transport, 128 phase CAPTURE.** `kLinkQuantum=16.0` is PAIRED (transport anchor, `beatNow()`, 24-PPQN clock); `controlTick()` captures phase at `kLinkPhaseQuantumBeats=128.0`, publishing `quantumMicroBeats` — consumers fold with `(quantumMicroBeats/1e6)`, never `16.0`. `cmd/recorded_beats` is the FOLD BASIS: unknown => no Link target. `applyRecPlayCycle` publishes bpm/beats BEFORE `master_len`; `pinLinkThreadsToControlCore` -> `kControlCore=2`; `[link] enabled = true` parses as a word, not `%d`.

## MIDI clock fan-out

`midi_clock.cpp` owns its thread: 24 PPQN `0xF8` to every MIDI output but the control surface; no `/dev/snd/seq`, it walks `/proc/asound/card*/midi*`, rescans every 2 s. Ticks are SCHEDULED off the beat timeline: `LinkBridge::microsAtBeat()` stamps the next whole pulse, the thread sleeps to it, then spins the final `kSpinNs=500000` (0.5 ms). A missed pulse is DROPPED, never bursted — a burst reads as a tempo spike to any device PLL. The surface is excluded by USB id (`09e8:0027`): `midi.cpp` scans that id first, then falls back to enumeration order; the clock skips EVERY matching card, waiting `kSurfaceGraceSeconds=15.0` for `controlSurfaceCard()`.

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate: **instrument** (default `hw:0,0`) tight-latency capture+playback, blocking; **OTG gadget** (`f_uac2`) best-effort MIRROR, NONBLOCK (`-EAGAIN` expected), MASTER on all channels, never cue. Instrument **S32_LE only** — `int32_t` buffer, divisor `2147483648.0f`; skip the OTG S16 conversion when the gadget is not connected. `period_size` = `block_size` exactly (not via `snd_pcm_set_params()`); `start_threshold` = one period; **4 periods min**; `src/usb/f_uac2-gadget.sh` `req_number` must be **4**, not the kernel default 2. Gadget is STEREO — L/R averaged to mono for Faust. `AloopPreDsp`/`AloopPostDsp`/`Sampler` are `std::make_unique`'d at startup.

**`instrument_device` is NOT the config literal**: `instrument_device_match` (default `AIR 192`) substring-matches `/proc/asound/cards` at EVERY open (USB moves `hw:0` between boots).

**Resolve string-keyed lookups ONCE, never per block** — control WRITE and telemetry READ cache `(ParamStore slot, Faust zone float*)` at startup. `FaustUI`'s bargraph adders must do `zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan. `targetToZone()` needs a case for every control target — a missing case returns `""`, silent. Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`; `Sampler`'s `captureBlock` reads that `prevFiltOut`, never `fin`.

**SHIFT (`fx/monitorfold`) fold is a CROSSFADE**: `fin[i] = fin[i]*(1-combinedFold) + prevLoopSum[i]*combinedFold`, `combinedFold = min(1, foldGain+glitchFoldGain)`; both gains ramp at `kFoldStepPerSample = (1/16)/N`. `foldTarget` needs SHIFT held AND no transpose voice gated; `glitchFoldTarget` from `fx/microrepeat_div > 0.5`. Three consumers differ: the Faust `MONITORFOLD`/`GLITCHFOLD` zones get the ramped gains, `freeXposeBuf` the RAW `monitorFoldVal > 0.5` threshold, `loopDirectGateNow` one-pole at `kLoopDirectPole=0.9355`.

**Latency bias is MEASURED, not a constant.** `snd_pcm_delay`: capture after `readi`, playback before `writei`; `capDelay + playDelay + N` (gate `< 16384`) averaged over a 4 s window -> `latency_bias_samples = N + roundTripEst + trim` (raw `alsa_roundtrip_samples`). It MUST be a window average, never a fast EMA (USB queue jitter re-anchors every playing take). `latencyBias = latencyBiasSamples + (shiftHeldThisTake ? kShiftFoldBlockLatencySamples : 0)` (shift term 64), written at FINISH from `m_looperShiftHeldDuringTake` (latched at ARM off `monitorFold > 0.5`) — the WHOLE round trip anchors a take, or it comes back late. `latency_trim_samples` in `[audio]` covers the rest (USB packetisation); `/run/aloop/latency_trim` is polled on the control tick so it tunes live. `pollHolds` rewrites `latencybias` on every looper with content when the measurement moves, correcting recorded takes too; unmeasured falls back to `kBlockSize`; `verify-lineup.js` reads the live bias, never a literal 64.

# Faust DSP

## Language gotchas

- **`&` binds tighter than `>`/`<`** — unparenthesised comparisons are silently always true.
- `par()`-replicated UI controls silently duplicate — `button()`/`hslider()` inside a `par()`-instantiated function RE-ELABORATES per call site even hoisted; thread as a plain signal input.
- No runtime branching — `select2`/`ba.if` choose among ALREADY-COMPUTED signals. Hence Guitar/LofiFx are a permanent Core-3 LV2 bundle, cost FLAT in held voices.
- Direct call syntax substitutes whole expressions, not buses — `f(loop(...), a, b)` binds all of `loop(...)` to the FIRST parameter.
- **Recursion is `namedStep ~ _`**: Faust takes no lambda left of `~` (`\(prev).(...) ~ _` is a syntax error). When two recursive signals reference each other, delay BOTH cross-references (`x'` and `y'`) or the evaluator hits "stack overflow in eval" on an instantaneous cycle; a 1-sample delay on a re-trigger is inaudible. Use `select2(c,a,b)` (a when c==0), `ma.modulo(x,L)` to wrap a float phase, `int()` for a sample index. Compile through real `faust` as the witness — local review cannot catch eval-cycle errors; after 2 eval failures re-derive as an explicitly past-only system instead of guessing delays.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/fast-math. **Not shipped**: `-mapp` (aarch64 SIGSEGV), `-fm def`, `ba.tabulate`, per-effect LV2 splitting, `-omp`/`-sch` (fights `pthread_setaffinity_np` pinning), `-mcd`/`-dlt`, `-clang`, `-mem`, `-vs 16` (SIGALRMs ~2 min into `dsp/aloop_pre.dsp`).

`effects/home/faust/chain.dsp` looks dead but is not — `build-lv2.yml` copies it into the homestack, so deleting it breaks the LV2 build.

**Two `dsp_generated.cpp` exist.** `tools/dsp-cli/build.bat` writes `tools/dsp-cli/dsp_generated.cpp` (gitignored, regenerated every run) and that is the one `dsp_cli.cpp` includes. The **root** `dsp_generated.cpp` is tracked but referenced by nothing — an orphan Faust 2.85.9 snapshot of `multitranspose.dsp`, generated with `-lang cpp -fpga-mem-th 4 -ct 1 -cn AloopEffectDsp -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0`. Its `-ct 1`/`-mcd 16`/`-single` deliberately contradict the shipped flags because it is a host harness artifact, not a device build — do not "fix" it to match.

**Buffer sizes**: `delay.dsp`/`delayverb.dsp` `MAXD=52000`; `microrepeat.dsp` `MR_MAX=36000`; `bitcrush.dsp` `BITS_MAX=24` not 16 (S32_LE never round-trips int16); `flanger.dsp` `MAXD=4096`/`flutter.dsp` `MAXD=1024` — at their ceiling, do NOT shrink. `SLEW=0.0001` slew carries NO drift term.

## `multitranspose.dsp` — poly pitch-LOCK, 6 voices

`NVOICES=6`, additive with the mono SNAC engine below; each voice owns an `EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep whose step MUST stay block-aligned (`m_sinceBlock==0`). `minTrackHz=60.0` floors `freqDet`. `engaged` held by release counter `engageReleaseHoldS=0.06` — never gate on `gate>0.5` or `voiceEnv>0`; `reengage()` must not leak the previous note's grain-clock state. Bus: fixed 0.6 gain + static `ma.tanh`, never `1/sqrt(activeVoices)`. Formant (CC53, deadzone 60-68) via `LpcFormantShifter` (`vowelFormant.h`, `kOrder=44`, `kHpPole=0.5925`, `kAnalysisHop=2048`, `kOctavesMax=3.0`); `beginBlock(n)` runs the reflection glide + `reflectionToDirect` once per `kCoeffUpdateHopSamples=64` samples. LPC live on mono AND poly; only the legacy grain shifter's `setFormantDepth()` is mono-only (`pitch_ffi.h`).

## Free-transpose engine (`soladSnacOctaver.h`)

`-12` live pitch engine (`pitch_ffi.h`, `pitch.dsp`'s `dubfx_pitch_tick` `ffunction`): SNAC + solad PSOLA + formant grain stage. `DL=32768` (131072 corrupts the Pi's 32-bit-pointer build), `MIN_PERIOD=48`, `DUBFX_BS=64` (poly 16), ~1.333 ms engaged. `m_xfadeLen` DIVIDED by the pitch ratio (clamped >=1.0) or readers drift. The splice cooldown divides by the rate the audio path burns gap at — read `m_scale`, never `m_targetScale`. Past +17 semitones a flat 0.9-period cooldown outruns `upshiftTargetLag()`'s 1.5-period reserve. Splice optima: `m_respliceFrac` 1.0, `SINC_TAPS` 16, `m_transientHold` 2 periods, slope weight 80.0, crossfade 1.0 period.

**Upshift clicks were FIXED here**: the gap emergency (`:171`, `gap < SINC_HALF+2` = 10; `gap = m_wr - rdActive`, `:155`) calls `triggerSplice(false)`, which EARLY-RETURNS while `m_xfadeRemain > 0` (`:463`) — for a whole crossfade the head keeps advancing at `m_scale` while the writer advances 1, the gap goes negative, and `readSinc` (`:361`, reads to `base+8`) wraps via `& MASK` and returns audio a whole `DL` late. Clamping `m_rdA`/`m_rdB` to `m_wr - (SINC_HALF+2)` right after the advance makes the head hold until a splice can run again; NO latency added, since it only ever holds the head back. Evidence (`tools/dsp-cli/bisect-glitch-threshold.js`, corpus at -24..+24): 63 glitches before, 1 after; RMS unchanged; pitch identical to baseline in every measured case. The old "+18 semitones" boundary was corpus-specific — the count grows with the shift RATIO (marimba_mid_C5B5 alone had 58, from +2 upward).

**Tremolo/AM subharmonic lock — FIXED; the reported mechanism was wrong.** The anti-jitter clamp walks nowhere: the wrong lock is already there on the FIRST completed detection (carrier 440 / mod 64 / depth 1: `t=0.0640s period=655` against a true 109.09, ratio 6.00, -3103 cents) — no prior estimate exists for a clamp to walk from; the clamp only slows recovery afterwards. What actually happens is that SNAC takes the highest local peak of r(k), and when the modulation period falls inside the lag range (64 Hz = 750 samples) the modulation wins outright (measured ratios 2.91 / 3.00 / 6.00 / 6.12). Second, real failure mode: frames with no periodicity at all (onsets, piano decay) carry r(k) ~ 0.9999 at every lag, and peak-picking there returns the search floor. `detectPitchStep()` now runs YIN-style cumulative-mean normalized difference d'(k) = d(k)/mean(d(1..k)) on the same sweep (no extra MACs), picks the FIRST local minimum below `kDiffAccept` 0.15 whose raw r is >= `kFirstPeakRatio` x the best candidate's r, else the global d' minimum if < `kDiffStrict` 0.05, else the classic SNAC peak rule — and that last resort is refused unless d' at its lag is < `kDiffFallback` 0.50 (no periodicity => no lock). The window is envelope-flattened first (|x| moving average over ~half the last period, floor 5% of mean |x|) and the parabolic refinement is corrected: for a minimum the delta is `(c-a)/(2(2b-a-c))`, not `(a-c)/(2b-a-c)` (2x and sign-flipped). Measured: AM grid (`dsp_cli --am-probe grid=1`, 108 cases) worst 3371.9 -> 425.7 cents, mean of per-case means 227.44 -> 6.18, mod=64 subset 1326.94 -> 7.25, cases averaging >25c 20 -> 6. 16-file corpus (320 configs) fail rows 75 -> 33, rows over 60c 69 -> 19, mean |cents| 134.82 -> 29.46, median 6.57 -> 0.71, p90 678.78 -> 21.84, clicks 86964 -> 89533, degradation-fails 10 -> 18. Tracker cost unchanged (153 detections: 0.097 s -> 0.089 s), no buffering or lookahead added, so no audio-path latency. Still open: `m_confidence` (1 - d') is published but nothing consumes it, the confidence-gated band that holds the last stable estimate is unbuilt, and material above the 1000 Hz `MIN_PERIOD` ceiling still cannot be resolved.

**Measurement trap**: `build/wav-pitch-yin.js` caps detection at ~900 Hz (`minLag = SR/900`), so it silently reports the octave below for any target above that — never trust it above 900 Hz without subharmonic correction.

## `pitchtracker.lv2`/DawDreamer

`pitchtracker_ac.dsp` — own bundle, `Lv2Host pitchTrackerFx` (`/effects/pitchtracker`): a 37-candidate autocorrelation grid with `subharmonicPromote` + `energyReady`/`holdLastGood` onset gating. DawDreamer's `FaustProcessor` refuses `ffunction` externs: `verify_highoctave_transient.py` is unconditionally red.

# Storage: USB ring recording

`src/storage/usb_recorder.{h,cpp}`: RT side keeps a fixed heap `int16_t` ring (5 s) fed by `pushBlock(prevFiltOut.data(), N)`; the 5 Hz loop does file I/O in `poll()` (fixed chunks, cyclically `O_TRUNC`-reopened). `[storage]`: `usb_record`, `usb_mount_point`, `usb_chunk_minutes` (10), `usb_chunk_count` (6). Clip export (note 93) keys off `m_looperHasContent`, not `wrapLen`. UNVERIFIED.

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never a bare `nullptr` — Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in the sigsetjmp watchdog `runOne()` uses; a faulting plugin is disabled and the host continues. `readTtl()` must strip trailing slashes from the bundle path (lilv's resolved path has one, `bundlePath` never does). `setControl` matches Faust's MANGLED port symbol (`fx2/FLANGEAMT` -> `fx2_FLANGEAMT_3`).

## Resonode: own LV2 bundle, called conditionally

`resonode_synth.dsp` pulled off the always-on Faust graph into `resonode.lv2` (`Lv2Host resonodeFx`, `/effects/resonode`), called only when `fx/resonode/engaged`; per-voice `note`/`gate`/`vel` are LV2 ports from `ApcGrid`'s MIDI handlers. `resonodeIn` is ZEROED when engaged with no plugins loaded; output re-enters the crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING never layering the original. `RESONODE_ENGAGED` is written via `fui.set()` in the worker loop, bypassing `targetToZone` — two consumers, audit both. The NaN/Inf guard after `resonodeFx.process()` zeroes the block, rate-limited `[diag-resonode]`.

`modeCount=16` (24 hits a real `faust` SIGALRM ceiling), 4 voices, excited ONLY by live mic; the SHARED exciter is broadband highpass(60Hz)+lowpass(tone) — never a per-voice bandpass. `couple` (knob7): nearest-neighbor `letrec` skew-symmetric exchange, `coupleSmallGainMax=0.45`, clamp `coupleGuardCeil=8.0` (tanh rejected — never exactly identity). Constants: `positionDriftEnv` ~350ms, `stretchJitterAmt=0.02`, `bassBoostAmt` 0.35 (<220Hz). `kResonodePatches` knobs1-4 = pos/decay/damp/stretch + collision; knobs 5-7 = `fx/resonode/{tone,level,couple}`.

## delayverb: own LV2 bundle, called conditionally

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves; `.process()` only when `delayVerbActive`. **Two separate instances** (`delayVerbFxCue` + `delayVerbFxMaster`) — sharing one corrupted its feedback state; `delayVerbActive` requires BOTH `hasPlugins()`. `cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never `cc70`/`cc71` (APC sends NOTES 70/71 ch0). `0x5B` -> `cmd/clearall` is owned ONLY by `midi.cpp`; a second `controls.conf` binding races `ApcGrid`'s shadow reset. **Tracktion Engine is REJECTED** — do not re-open.

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`midi.cpp`): APC Key25 pads/buttons are **channel 0**, the keybed and sustain CC64 **channel 1** — keybed notes on ch0 do nothing. SHIFT is `kApcBtnShift=0x62` (note 98) ch0; sustain is CC64 (`d2>=64`), latching `m_sustainLatched`. **A live capture is not representative until SHIFT and latch-sustain are both sent** (`raw 90 62 7f` then `raw B0 40 7F`, >=0.3s apart).

Every momentary Faust gate must be explicitly released or it sticks at 1 forever: `looperN/erase` (`pollHolds` releases after ~50ms), `looperN/finishreq`, `cmd/clearall`. Every abandon path (`applyRecPlayCycle`'s `rawSamples<=0` abort, `pollHolds`'s hold-erase loop, `onClearAll`) must ALSO pulse `finishreq=1` with `finishtarget` = real telemetry `widx`, or `pend` stays latched; both BEFORE `rec=0` (`rec=0` on FINISH or it re-records forever). ARM on PRESS, FINISH on a **second PRESS**; a press during a far-extend wait is a NO-OP (abort is hold-to-erase only). `kLooperCount=20`; `looperN/hascontent` is the real content slot (Faust's `wrapLen` clamps to min 1). Telemetry `loopers.stateflags`: bit0 `pend`, bit1 `fin`, bit2 `act`, bit3 `gate`. **`loop.dsp` writes `wlenNext` only at FINISH and wipe never resets it** — `wraplen>1` is NOT proof of content: track `m_looperWrapLenStaleAfterWipe` (set on clear-all and hold-erase, cleared at FINISH) or the 5 Hz self-heal resurrects wiped loopers as paused. Guitar-fx held REDIRECTS looper pads to `onSidechainLooperToggle`.

## Content phase-anchor

Playback anchors to a shared `masterPhase` grid, never a per-take offset.

**ARM records from the press and anchors at the NEAREST fine-grid node.** `kFineGridBeats=0.125`; at `armEdge` `rsmNext = rsmNearestNode` (circular correction <= half a cell, no forward-only bias). Gates: `verify_phase_anchor.py` (each HALF of a cell); `verify-lineup.js` (arms several loopers in ONE MIDI burst; finished length within 2.5 beats of the pad hold).

**Per-loop beat scale `s`**: latched `1/ratioClamped` at `finishEdge`, `1.0` at `armEdge` (`beatLenNow = oneBeat/ratioClamped` once `masterLen>=0.5`, `cycleInc = sNext*masterLen`). A BEAT-LENGTH ratio, never `wlen/masterLen` (near-cut/far-extend can EXTEND a take, 5->8 beats). `coffNext` advances by `cycleInc` on the `masterPhaseWrapped` edge (10th `loop.dsp` input), never per block. Read-head rate is `s*masterPhaseSlope`, so a take drifts off the grid IFF `s != 1`. `effSpeed==1.0` exactly is what makes `varispeedActive` false, i.e. a take rigidly bound to `s*(masterPhase-rsm)+bias+coff` with no integration.

**Quantize in master-grid BEATS, not drifted-tempo samples**: divide the raw write index by `tempoScale` (`recordedBpm/curBpm`), drop the division from the finish target, assert read heads against the ABSOLUTE grid beat captured at arm, not `rsm`.

**FINISH length is near-cut/far-extend** (`pickAnchorGridBeats`: 16/8/4/2/1/0.5/0.25/0.125, eps 0.01), CAPPED at one phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot past the last passed node within `cutTolerance = max(1 beat, min(anchor/2, takeLen/8))` cuts to it now, else extends to the next tier. Ceiling `kMaxLoopSamples` (48000*60), floor 64. `dsp/loop.dsp` clamps `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))`, `snappedWrapLen = ceil(finishTakeLen/anchorGridLenNow) * anchorGridLenNow` — a varispeed-shifted `beatLenNow` cannot re-snap 16 beats to 32.

**The first (master-establishing) take OWNS the tempo.** `master_len` stays the raw write index; `deriveTempoQuant(seconds, anchor)` picks a power-of-2 beat count {1..128} whose bpm is log-closest to `anchor` (synced Link tempo with peers, else 120) inside `anchor/2..anchor*2`. `cmd/recorded_bpm`/`cmd/recorded_beats` follow; `LinkBridge::imposeTempo()` pushes that bpm, landing `effSpeed` on 1.0000 (adopting peer tempo TRUNCATED the take). Measure the grid against `master_len_samples / recorded_beats`, the exact published basis, never the rounded `link.bpm`. Gate `tools/loop-quantization-sim/first-loop-tempo-owner.js`; proof `test/hardware/verify-first-loop-owner.js`.

Sim gates (CI, plus `.github/workflows/test-phrase-anchor.yml` gating `dsp/loop.dsp`): `arm-boundary.js` (pend resolves `armEdge > cancelPend > armPulseGrid`), `long-take-quantize.js`, `tempo-change.js`, `join-late.js`, `read-head-lineup.js`, `mismatched-masters.js`, `tempo-drift-take.js`, `beat-count-race.js`, `first-loop-tempo-owner.js`, `varispeed-record.js`.

Hardware gates sharing `test/hardware/lib/gridlock.js`: `verify-multi-looper-soak.js` (N takes; lock ±2 samples over 90-120 s, pair offsets <=1), `verify-peer-tempo-follow.js` (host peer sweeps 120->132->120 bpm; lock -9..8, pair spread 17). The sweep peer is `build/link-peer-sweep.exe` — `link-peer.cpp`'s 4th arg is a spec `"atSec:bpm,..."`; build `-static`, and run only ONE host peer at a time (udp 20808). Both wired into `run-all-verifications.js`, where exit 2 means a missing prerequisite => skip, not fail. A tempo jump needs ~8 s of trim settle skipped before lock samples count.

## Varispeed punch is BAKED into the take

`cmd/halfspeed`/`cmd/doublespeed` drive `g_manualSpeedMul` (0.5/1/2); `effSpeed = g_manualSpeedMul * linkSpeedRatio`. `dsp/loop.dsp`'s 9th of 10 inputs is `manualSpeed` (`manualSpeedBuf` block-constant), separating punch from Link ratio: `manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = clamp(effSpeed/manualSafe, 0.1, 8.0)`, `speedClamped = clamp(effSpeed, 0.1, 8.0)`. Beat lengths use `ratioClamped`, never `speedClamped` (`beatLenNow`, `sNext`) — the punch must not scale the grid, or the C++ `finishtarget` (no manual term) stops matching the DSP's `snappedWrapLen` and a take doubles. Each take latches `v` = `manualSafe` at `finishEdge` (1.0 at `armEdge`); `vBaked = v != 1.0`, `speedForTake = v / manualSafe`, read head advances `speedClamped * sNext * speedForTake` = `v * ratioNow / ratioRec` — finished at 0.5x stays 0.5x. `resyncCoeff` is `0.0005`, forced to `0.0` on `manualPunchActive|vBaked`. Gates `tools/loop-quantization-sim/varispeed-record.js`, `test/hardware/varispeed-record.js` (keep the MIDI injection socket alive across idle gaps).

## Granulator — note 69 SHIFT-disambiguates (`src/dsp/sampler/sampler.h`)

Both on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap toggles Resonode engage (always wins, forces granulator off; disengage releases held voices). Resonode-engaged keybed drives 4 voices via `Lv2Host::setControl` to `fx/resonodevoice{v}/{note,gate,vel}`. Granulator is C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/`posJitterMs`/`scanRate`/`reverseProb`/`envShape`), `MAX_GRAINS=48` across `VOICES=16`, budgeted PER VOICE once per block — spawn period raised to fit the share, spawns refused past it, and gain compensation tracks the BUDGETED spawn period, not the requested overlap. `scanRate=0` freezes; negative `rate` reverses. Direct dials (knobs 5-7) override the patch blend once touched (`m_lofiFxKnobTouched`); `kGranPatchCount` 4.

## FX pages: 3 pages x regular/shift x 8 knobs

Each FX page (Dub, Guitar, LofiFx) has two independently-latching 8-knob banks via `ApcGrid::onFxKnobCC`, `kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 = Formant on Dub):

| Page | Regular | Shift |
|---|---|---|
| Dub | `fx/{reverb,delay,time,hp,lpres,lp,pitch}`, CC53 Formant | `fx/dubgate/*`+`fx/dublfo/*`, 4-beat clock |
| Guitar | `fx2/{FLANGE,TREMOLO,BANKSPEED,PHASER,DIST,VINYL,FLUTTER}AMT`, CC53 `fx2/GATEAMT` | dual-ADSR to `Sampler` |
| LofiFx | `fx2/BITCRUSHAMT` + 4 patch weights | direct dials (knobs 5-7) |

## Groove: swing + volume gates on the beat pads

`kApcBeatPadNotes={15,23,31,39}` are one-of-four latching selectors; `fx/shuffle/mode` (0..4) picks a swing from `kGrooveSwings[5]` as `{gridBeats, ratio}` — 8th grid 0.50/0.54/0.58, 16th grid 0.58/0.66, where `gridBeats` is the swing grid and `ratio` the groovebox swing percentage. Every ODD cell of that grid is delayed by `(ratio-0.5)*2*gridBeats*grooveBeatLen`, HARD-CAPPED at `kGrooveSwingMaxSeconds = 0.040` (40 ms). Swings are indexed by MODE, so pad N's offset is `kGrooveSwings[N]` (`[0]` is straight); reported as `groove.swing_grid_beats`. Note 7 (`kApcPadGateMod`) HELD while a beat pad is pressed turns the same pads into `fx/gate/mode` (0..4) with `kGrooveGatePeriodBeats[5] = {1.0, 1.0, 0.5, 1.0, 1.0}`: off, chop 1 beat, chop 1/2 beat, pump (duck floor 0.12, exp release 0.18 beat), swell. The gate multiplies `loopSumPreBuf` — the ONE point reaching master out, the cue loop term and the SHIFT-fold tap identically. Ramps are raised-cosine with `gateRamp01 = min(0.25, (3 ms in samples / grooveBeatLen) / gatePeriodBeats)`. **`grooveBeatLen` is TEMPO-derived** (`sr*60/(recordedBpm*effSpeed)`, else Link bpm, else 120) — never `masterLen/recordedBeats`; `beatLenSamplesShared` is still `masterLen/recordedBeatsShared` but feeds only the legacy grid. `grooveFreeBeatPos` keeps the gate alive with no loop recorded. Telemetry `groove{shuffle,gate,beat_len_samples,gate_min,gate_max,swing_offset_samples,swing_grid_beats}`. Proof `test/hardware/verify-groove-gates.js` (pump `gate_min` 0.22-0.28, no pad displacing >45 ms); PASSES as of c4eccdf.

`dsp/loop.dsp` varispeed has NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked` exact); the instant jump and the swing hard clip are INTENTIONAL — never smooth either. Loop ring reads use Catmull-Rom cubic; taps wrap at `wrapLen`, not `MAXLEN`.
