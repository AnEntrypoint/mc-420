# aloop - current-state constraints

Real Pi 4 `192.168.137.100`, root/aloop; Pi 3B+ netboots from host. aloop is BEHAVIOR clone of `../looper`, never source clone:never vendor its source, never add `LOOPER_DIR`/`loopMachine.cpp`/an effects-bridge shim. DSP = Faust (rwtable + recursive heads).

# Working rules

- No comments in code, ever (C++/.dsp/JS/shell/YAML, `.gitignore`); 1 sighting:sweep file. Exempt: `#!`, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, commented-out option keys (`config/aloop.conf`), `vendor/` + regenerated Faust output.
- Never add audio-path latency:~7 ms block latency must never grow, even temporarily; stop and ask first. Exempt:engaged wet effect's own algorithmic latency (`ef.transpose`, SNAC).
- No WSL, no Docker here, ever; missing compute:GitHub CI/CD (`gh`).
- Test on real hardware, never ask user to reproduce:MIDI injection (`tcp/9401`, `test/hardware/midi-inject.js`) or SSH. Link needs real peer: `test/hardware/link-peer.cpp`, host `-static` `-DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -lws2_32 -lwinmm -liphlpapi -mthreads`. No CLEAN audio ingress reaches `dry`:AIR 192 silent (`audio_peak.in 0.0002`); `snd-pcm-oss` 8000 Hz U8, NO resampling (~150 xruns/s at 48k; 8k stalls aloop, tracker caps 166 Hz via `MIN_PERIOD=48`); no aplay/arecord/sox/python3, no alsa-utils apk.
- `snd-aloop` ingress WORKS but is jiffies-paced and TEARS, so ANY click/tear witness through it INVALID (floor 17 glitches vs host 0, drift ±15 > effect; torn stream never sets SNAC `trusted` latch:poly transpose never engages on real corpus, only steady tones + cello). `modprobe snd-aloop` > card 2; writer `hw:2,1,0`, aloop `hw:2,0,0`; `period_size=64` + HZ=250:3.1x slow, 41 discontinuities/6 s of 220 Hz sine, xruns 125/s, tear 0.25-7/s; only timer `G0` (4000 µs), `timer_source` can't point at card:unfixable without raising `period_size` (forbidden).
- `tools/dsp-cli/dsp_cli.cpp`:file-in/file-out WAV, no audio device:cross-compiled aarch64 build characterizes engine on Pi against real corpus with NO ingress. Musl-static via `.github/workflows/build-dsp-cli-aarch64.yml` (`ubuntu-24.04-arm` + `alpine:3.20`, `g++ -O2 -std=c++17 -static`). On Pi: `./dsp_cli --solad in=corpus/piano_mid_C4.wav out=/tmp/o.wav semis=24 normrms=0.21 && ./dsp_cli --glitch-check /tmp/o.wav threshold=0.25 minGapMs=5`. Faust verification in CI only:DawDreamer can neither compile (900 s kill) nor render (OOM) here.
- aarch64 vs host:characterization-identical, NOT bit-identical. Locked recipe (6 s clips, `normrms=0.21`, `--glitch-check threshold=0.25 minGapMs=5`):nine cells EXACT:vocal_female_vibrato 0/11/46, piano_mid_C4 1/4/5, marimba_mid_C5B5 2/5/4 (+0/+12/+24); column sums -24/-12/0/+12/+19/+24:Pi 3/9/19/209/142/199 vs host 4/9/19/212/144/200:down-clean/up-dirty fold-back HOLDS on device. ±2 counts = noise floor. Codegen PINNED:CI compiles committed `tools/dsp-cli/dsp_generated.cpp` (host 2.85.9); `--solad` returns at `dsp_cli.cpp:1097` BEFORE `AloopEffectDsp` at 1100:codegen LINK-only. Residual:ENGINE only; live witness DEFERRED.
- Injector: `.github/workflows/build-audio-injector.yml`; musl needs `linux-headers` + `snd_pcm_hw_params_malloc` (never `alloca`).
- Witness hygiene:held transpose voice whose target EQUALS detected note reads "no shift", pick distinct targets; `rc-service aloop restart` between MIDI scenarios.
- Telemetry (udp/4445) answers ~190 ms from 5 Hz loop; lag JITTERS tens of ms. Rate only by least-squares slope over every poll of >=20 s watch, skipping ~6 s after FINISH. SLIP = `readpos` vs `master_phase_beats * beatLen` from SAME reply. Replies TEAR:despike with `despikedSpread()` (`test/hardware/lib/gridlock.js`); torn FIRST poll offsets all later samples.
- Compiling clean proves nothing:x86_64 A/B passed while aarch64 codegen SIGSEGV'd (`-mapp`); regenerate real C++ and diff byte-for-byte. Heap-allocate large DSP instances (stack-local `AloopEffectDsp` faults STATUS_STACK_OVERFLOW). Crash fix can UNMASK 2nd bug:re-measure SAME live metrics afterwards.
- WebSearch before irreversible hardware steps; SSH via JS `ssh2`, never `ssh.exe`/`sshpass`. Windows Firewall silently black-holes Pi, rule it out before debugging netboot/SSH as device fault.
- Faust codegen cliff:NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile time (`modeCount=24` SIGALRMs ~2 min into `-i -a lv2.cpp`); declare new controls in `effects_runtime.dsp`. Current `effects/pitchtracker-src/pitchtracker_ac.dsp` on shipped `ubuntu-24.04-arm`:no taps 10.2 s; 12 refine-only taps 10.2 s; 22 taps FIXED lag 10.8 s; demote alone (6 taps) 12.6 s; promote alone (4 taps) 16.1 s; demote+promote and shipped 22-tap file >120 s (exit 142); 13 mixed taps 79.6 s. NOT flags:all 7 sets (`-vec -fun -dfs -vs 32 -nvi -ct 0` minus each, `-vs 8`, none) SIGALRM 120-124 s; 120 s alarm is faust's own (150 s sleep survives). NOT lv2:SIGALRMs under minimal `tools/pitchtracker-render/pt_arch.cpp`, yet `detectedFreq(x) : (_,!)` alone compiles inside alarm. KILLED: `ba.if` vs arithmetic mux2, `mem` before index, all lags from one `int(ma.SR/coarseFreq)` or one rounded (120-121 s); numpy `model_ac_tracker.py` `shared1/2/3` rejects shared lags (-1896 c at 1046.5 Hz trunc, -66 c at 1318.5 Hz rounded). Cost is what FEEDS the index, not taps (13 rwtable taps 0.0 s):keep every index a function of `coarseFreq` alone. Read signal-lag taps from 4096-deep `rwtable`, never variable-lag `@` (bit-identical lags 3..3200 under `-vec -vs 32`, incl. per-sample-varying; modulo-bounded counter, never float accumulator:not integer-exact past 2^24). New pitch/shifter engine: C++ bridged by one `ffunction`, never per-voice Faust.
- `multitranspose.dsp` internal zcr tracker (`:35`) is LIVE whenever `extFreqDetApplies` is false (`:142`) but has ZERO CI coverage:`test/pitch-tracker-transient` feeds true freq on channel 4.
- Branches:consolidate onto `main`, then delete, always (locally AND remote); verify `git log main..<branch>` empty first. Never touch branch a running subagent commits to. Never delete `origin/gh-pages` (live Pages demo).
- Verification gates:in `run-all-verifications.js` exit 2 = missing prerequisite:skipped, not failed.

Debugging: `core_busy` undercounts (only `compute()`, not blocking `readi()` cycle):cross-check `/proc/<tid>/stat` utime+stime vs `/proc/uptime`, `mpstat` per-CPU. Telemetry CANNOT see zone pins: `g_telem.recordedBeats` reads ParamStore (`audio_thread.cpp:843`) while pins write Faust ZONE POINTERS; buggy and fixed binaries publish identical `recorded_beats=8`.

# Device, image and boot

Pi 4 CPU topology, `nproc` = 2 is EXPECTED, not defect:cmdline carries `isolcpus=domain,managed_irq,1,3 nohz_full=1,3 rcu_nocbs=1,3`, isolating cores 1 and 3 for RT audio; housekeeping 0 and 2. Do not "fix" it; `kControlCore=2` (Link pinning) is valid housekeeping core.

`image/lib-boot-tree.sh` BOARD-parameterized (`pi3`/`pi4`/`pi5`/`opi-prime`); only `boot_tree_fetch`/`boot_tree_config` dispatch per board. `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/` never appear. `aloop` OpenRC needs `rc_ulimit="-l unlimited -r 95"` in its service file, not `local.d`; `depend()` needs `after local autoap`. Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`, never `apk add` at boot; alsa-lib needs `vendor/share-alsa/` or `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` + `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`. `cmdline.txt`/`extlinux.conf` APPEND stays one line; `core.autocrlf=true` corrupts scripts.

Alpine/musl/aarch64:glibc/x86_64 artifacts silently fail to load. Split `faust2lv2`: `faust -i -a lv2.cpp` emits `.cpp`, `$HOST_CXX` compile+run emits `.ttl`, only final `-shared .so` link targets device; verify `objdump -p foo.so | grep NEEDED` > `libc.musl-aarch64.so.1`.

`disable_core3_lv2` in `/etc/aloop.conf`: `= 1` makes worker skip `homeFx.process()`/`userFx.process()`, fully silent, survives `rc-service aloop restart`. Match `^\s*disable_core3_lv2\s*=\s*1` before debugging silence as code bug.

Build traps:loop engine TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around `delayverb.lv2`; both must update `audio_thread.cpp` includes in SAME commit or CI ships engine-less binary. `dsp/effects_runtime.dsp` imported ONLY by `dsp/aloop.dsp` (never shipped):shipped entry points import `effects_runtime_pre.dsp`/`effects_runtime_post.dsp`.

# Deploy, netboot, CI

- `REBOOT:<token>` UDP listener INSIDE aloop process (`config/aloop.conf` `[remote] token=`, `udp/4446`, `remote_control.cpp`):crashed `aloop` means nothing listens; SSH `reboot` fallback.
- Netboot self-update, 2 paths. Automatic: `image/serve-netboot-win.js` polls `build-binary.yml`/`build-lv2.yml` green `main` every 30 s. Manual: `image/build-netboot.sh`, all 4 `*_LV2_DIR` vars plus `ALOOP_BIN`/`OUT`/`NETBOOT_SERVER` mandatory. New bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js`. `serve-netboot-win.js` logs only execFile `e.message`, so `build-netboot.sh` fatal diagnostics must go to stderr or failed rebuild logs empty reason.
- Netboot facts: `SERVER_IP` baked into root `cmdline.txt` ONCE, restarting server never rewrites it; rebuild with `NETBOOT_SERVER` and power-cycle. TFTP ok but ZERO HTTP requests = hung until power-cycled. HTTP `192.168.137.1:8080`, paths `/aloop.apkovl.tar.gz` + `/boot/modloop-rpi` (not port 80, no bare `modloop-rpi`); `ensureCorrectSubnetMask()` rewrites netboot NIC mask every startup:/16 mask broadcasts every OFFER/ACK, so Pi re-DISCOVERs forever with zero TFTP reads; binding HTTP during change gives `EADDRNOTAVAIL`, restart once mask settles.

# Mesh networking

aloop (Pi 4) + `../esp-idf-link` form ONE ad-hoc single-AP mesh for Link multicast peer discovery (`224.76.78.75:20808`); change BOTH sides or mesh splits. Invariants (aloop / esp-idf-link):SSID `ssid=ticker` / `wifi_start_link_ap("ticker")`; open auth `key_mgmt=NONE` / `wifi_connect_sta("ticker", "")`; AP/DHCP `192.168.4.1/24` + dnsmasq `.2-.20` / `esp_netif_set_ip_info` same; channel `channel=6` / SoftAP ch6; quantum `kLinkQuantum=16.0` / `LINK_QUANTUM 16.0`; host election lowest MAC/BSSID wins; transport CLOCK-ONLY, `enableStartStopSync(false)`, never `setIsPlaying`.

`src/net/autoap.sh` hosts `ticker` never `aloop`, needs >=1 active `network={}` block before `start_ap()` does anything.

brcmfmac: `iw dev wlan0 scan` while hostapd beacons knocks wlan0 off AP mode (channel flaps to 5 GHz chanspecs, `brcmf_escan_timeout`); hostapd stays alive with NO BSS, so no peer can ever associate. `iw dev wlan0 info` `type AP` is the ONLY truth: `/run/aloop/wifi_role` still says `ap` with the BSS down. `autoap.sh` AP branch watchdogs `ap_up()` every tick and gates `scan_mesh_bssid` behind `AP_SCAN_IDLE=90` s of client-less idle.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; audio thread reads lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated at session tempo.
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` unconditioned, only writer of `weOwnTempo`; never gate `linkSpeedRatio` on it. Match tempo by read RATE (`linkSpeedRatio=linkBpm/recordedBpm` > `effSpeed`); `imposeTempo()` republishes in same call or finish edge doubles take. It latches `g_ownedBpm`, re-imposed by `controlTick()` when peer count settles `kPeerSettleTicks=2` ticks (~400 ms) on join/leave, else joining peer merges its own 120.000 session and `eff_speed` settles 1.0067. `resetTempoAuthority()` clears it.
- CLOCK-ONLY:tempo+phase shared, transport never shared. `midi_clock.cpp` never emits `0xFC`; aloop IS mesh's sole transport emitter, so `publishTransport` must use `setIsPlayingAndRequestBeatAtTime` (stop keeps plain `setIsPlaying`) and `applyRemoteTransport` must reset `m_lastRemotePhaseMicroBeats` to -1 when arming `m_remoteStartPending`. 24-PPQN out has NO sink:only rawmidi is `midiC1D0` = APC Key 25, excluded as control surface, so `outs.count == 0`, `MidiClock::run()` skips every pulse.
- Local transport never stops:paused looper MUTED, not stopped. `ApcGrid::updateLocalTransport` starts once, never reports stopped; `g_localTransportRunning` defaults true.
- Phase trim applies to `masterPhaseSamples` ONLY (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`, else 51-cent detune). `masterPhaseBuf` ramps per-sample (never `std::fill()`) at `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`; `effSpeed = g_manualSpeedMul*linkSpeedRatio` carries TEMPO alone; `masterPhaseSamples` advances at `linkSpeedRatio` ALONE; `resyncCoeff` closes residual ~42 ms. Tempo must hold `kTempoStableBlocksThreshold = sr/N` blocks; measure ~6 s after jump.
- Our material never moves for Link:session moves to us. Only idle grid snap (`!anyAudible`); join IMPOSES our phase (`requestPhaseImpose(...)` > `forceBeatAtTime` off-thread) at circular error > `kJoinSnapErrBeats=0.25`. `wasLinkDriving`/`wasLinkSynced` clear when Link stops driving, so reconnect reads as join.
- Take born at grid 0 (`masterJustCreated`):grid pinned 0, beat 0 forced at instant. `peers=0` lied:two host `link-peer-sweep.exe` see each other; kill duplicates first.
- Two quantums:16 transport (`kLinkQuantum=16.0` PAIRED:transport anchor, `beatNow()`, 24-PPQN clock), 128 phase CAPTURE (`controlTick()` at `kLinkPhaseQuantumBeats=128.0`; consumers fold `(quantumMicroBeats/1e6)`, never `16.0`). `cmd/recorded_beats` FOLD BASIS; `applyRecPlayCycle` publishes bpm/beats BEFORE `master_len`; `[link] enabled = true` parses as word; use `build/link-peer-sweep.exe`.

# Audio thread and ALSA

`worker()` opens 2 PCMs:instrument (default `hw:0,0`) tight-latency blocking capture+playback; OTG gadget (`f_uac2`) best-effort NONBLOCK MIRROR (`-EAGAIN` expected), MASTER never cue. Instrument S32_LE only (divisor `2147483648.0f`). `period_size` = `block_size`; `start_threshold` = 1 period; 4 periods min; `req_number` = 4. `instrument_device` NOT config literal: `instrument_device_match` (default `AIR 192`) substring-matches `/proc/asound/cards` at EVERY open; mis-resolution opens control surface as instrument silently. `block_size=64` on device (`latency_bias 322.2`).

Resolve string-keyed lookups ONCE:control WRITE + telemetry READ cache `(ParamStore slot, Faust zone float*)` at startup; `targetToZone()` needs case per control target (missing: `""`, silent). Recording taps `loop.dsp` `prevFiltIn` fed from `prevFiltOut`; `Sampler::captureBlock` reads `prevFiltOut`, never `fin`.

SHIFT (`fx/monitorfold`) fold is CROSSFADE: `fin[i] = fin[i]*(1-combinedFold) + prevLoopSum[i]*combinedFold`, `combinedFold = min(1, foldGain+glitchFoldGain)`; both ramp at `kFoldStepPerSample = (1/16)/N`. Three consumers differ:Faust zones take ramped gains, `freeXposeBuf` RAW `monitorFoldVal > 0.5`, `loopDirectGateNow` one-pole at `kLoopDirectPole=0.9355`.

Latency bias MEASURED. `snd_pcm_delay`:capture after `readi`, playback before `writei`; `capDelay + playDelay + N` averaged over 4 s window > `latency_bias_samples = N + roundTripEst + trim`. Window average, never fast EMA. `latency_trim_samples` in `[audio]`; `/run/aloop/latency_trim` polled on control tick.

Resample (SHIFT) bias DERIVED, never constant. Bias = `round(D_dry*(1-f) + (2*blockSize + L_chain)*f)`, `D_dry` = shipped `latency_bias_samples`; `f` = mean `combinedFold` over take (PREVIOUS block fold), windowed ARM>FINISH; unwindowed `shiftHeld ? 1 : 0`. `L_chain = 128*engagedFraction + 128*shiftFraction`; `engagedZone` written 1, never cleared, so shift term tests `|SEMIS|>0.01`. `[diag-latency]` logs at FINISH when `f > 0.01`. Tolerance `kToleranceSamples` ±16; intra-take sawtooth (~±170) no scalar removes.

# Faust DSP

## Language gotchas

- `&` binds tighter than `>`/`<`:unparenthesised comparisons always true.
- `par()`-replicated UI controls RE-ELABORATE per call site; thread as plain signal input.
- No runtime branching: `select2`/`ba.if` choose among ALREADY-COMPUTED signals, so Guitar/LofiFx stay permanent Core-3 LV2 bundle, cost FLAT in held voices.
- Recursion is `namedStep ~ _`:Faust takes no lambda left of `~`. 2 mutually-referencing recursive signals must BOTH be delayed (`x'`, `y'`) or evaluator hits "stack overflow in eval".

## Compiler flags

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/`-mapp`/fast-math/`-mem`/`-vs 16`. Not shipped: `-mapp` (aarch64 SIGSEGV), `-fm def`, `ba.tabulate`, per-effect LV2 splitting, `-omp`/`-sch` (fights `pthread_setaffinity_np`), `-mcd`/`-dlt`, `-clang`.

## Free-transpose engine (`soladSnacOctaver.h`)

Poly pitch-LOCK: `NVOICES=6`, each voice owns `EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep (`BLOCK=64`); step MUST stay block-aligned (`m_sinceBlock==0`). `engaged` held by release counter `engageReleaseHoldS=0.06`:never gate on `gate>0.5`/`voiceEnv>0` or note-off plays 50 ms unshifted dry.

`-12` live pitch engine (`pitch_ffi.h`, `pitch.dsp` `dubfx_pitch_tick` `ffunction`):SNAC + solad PSOLA + formant grain. `DL=32768` (131072 corrupts Pi 32-bit build), `MIN_PERIOD=48`, `DUBFX_BS=64` (poly 16), 128 smp engaged / 0 bypassed, `m_xfadeLen` DIVIDED by pitch ratio (clamped >=1.0) or readers drift; splice cooldown divides by rate:read `m_scale`, never `m_targetScale`.

- Upward-shift clicks are FOLD-BACK (aliasing), not splice bug, SOURCE-dependent:upshift reads at stride `s`, `readSinc` 16-tap cutoff FIXED, so source must be band-limited to `fs/(2s)`; `s<1` never folds. 0 glitches +12/+18/+24 on `piano_mid_C4`; `vocal_female_vibrato` (+12/+19/+24) and `marimba_mid_C5B5` (+24) glitch. Both fixes built, measured, REJECTED:stride-adaptive kernel +24 32>27 but +12 9>13; write-side anti-alias ~3 samples at `s=4` (FORBIDDEN).
- Overtake fix:clamp `m_rdA`/`m_rdB` to `m_wr - (SINC_HALF+2)` after advance, else `readSinc` wraps through `& MASK` (63 > 1 glitches over -24..+24, no latency); `dsp_cli --solad` benches it.
- `SnacPeriodTracker` cannot measure above 1000 Hz (`MIN_PERIOD=48` at 48 kHz):1046.5 Hz reads lag 91 = 523 Hz = -1186 c. Above 1000 Hz use `--pitch`, never `--trk`: `dsp_cli --pitch` (wide-band NCC, octave-safe first local max >= 0.85*global) measures +24 render at 1059.55 Hz vs 1046.52 expected = +21 c raw. Conf still 0.999 while off exactly 1200 c at 1046/1318/1568 Hz:OPEN.
- Tremolo/AM subharmonic lock is NOT an anti-jitter clamp:bad lock lands on FIRST completed detection (SNAC takes highest local peak of r(k); modulation period wins; non-periodic frames r(k)~0.9999 everywhere). `snacPeriodTracker.h` YIN-style cumulative-mean normalized difference (`kDiffAccept` 0.15/`kDiffStrict` 0.05/`kDiffFallback` 0.50), parabolic refinement `(c-a)/(2(2b-a-c))`. AM grid (`--am-probe grid=1`, 108 cases):worst 3371.9>425.7 c, mean-of-means 227.44>6.18.
- `m_confidence` never zeroed on rejected/silent frames. `confidenceGate = 0.85` (`multitranspose.dsp`) gates RE-TRACKING only; `kContGate = 0.50` (`snacPeriodTracker.h`) gates whether `confidence()` reports it, via block-aligned lag-tolerant NSDF (`updateContinuity`, window `min(2p+128, SNAC_WIN)`, best r over +/-6%):>= 0.50 on 96.3% real-audio blocks with good lock, 13.6% without. Cap MUST stay `SNAC_WIN` (1024): `MAX_PERIOD` 800. `confOk` must NOT gate acquisition (`trackingAllowed` = `trustedTracker > 0.5` ALONE) or note-ons start semitone off then jump. Faust confidence reads need runtime-varying input:literal `voiceIdx` in `dubfx_pitch_confidence_poly()` constant-folded, pass `engaged` too.
- `GrainFormant` shifts pitch full octave past ~0.5 formant mix; `pitchtracker_ac.dsp`: peak demote, raw promote, damper holds refined freq (damper in `detectedFreq`; `subharmonicPromote` `baseFreq` drives tap indices, so keep correlation results OUT of every index; refining coarse pick then multiplying by ratio NOT equivalent:+-16 window spans 47 c at 82 Hz vs 150 c grid gap). Pitch-lock runaway: `everTrusted` latch + reseed `heldDetNote` to `targetNote` at EVERY `attackEdge` until trust. `extFreqDet` analyzes `fin` only:trust only when `free<0.5`.
- AC tracker timbre shift (2nd harmonic overtaking f0) is OCTAVE FLICKER, not a lasting swap:coarse pick flip-flops f0/2f0 ~300 ms while `demoteNow` ramps, `confident` stays 1, so `holdLastGood` never masks it. Fix = `takeNew` also requires `stableRun >= confirmSamples` (512), counting samples where `coarseFreq` moved <6%; worst window 278 c > 4.4 c. Smoothing/Schmitt on `demoteNow` is measured-wrong (evidence ~0.005 once 2nd harmonic dominates, locks +1209 c). The counter MUST read `coarseFreq`, never `refinedNow`:that drags the refine tree into the `~` recursion and codegen never finishes. numpy `model_ac_tracker.py` is unfaithful for this (0.8 c model vs 278 c render):judge only on `pt_render.py` real renders.

# LV2 hosting

`Lv2Host::instantiate()` needs NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never bare `nullptr`:Faust `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in sigsetjmp watchdog `runOne()` uses. `setControl` matches Faust MANGLED port symbol (`fx2/FLANGEAMT` > `fx2_FLANGEAMT_3`).

- Resonode: `resonode_synth.dsp` pulled off always-on Faust graph into `resonode.lv2` (`Lv2Host resonodeFx`, `/effects/resonode`), called only when `fx/resonode/engaged`; per-voice `note`/`gate`/`vel` LV2 ports from `ApcGrid` MIDI handlers. `resonodeIn` ZEROED when engaged with no plugins loaded; output re-enters crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING original and preChain (`effects_runtime_pre.dsp:38`). `RESONODE_ENGAGED` written via `fui.set()`, bypassing `targetToZone`.
- delayverb: `delayverb.dsp` > `delayverb.lv2` in 2 halves; `.process()` only when `delayVerbActive`. 2 instances (`delayVerbFxCue` + `delayVerbFxMaster`):sharing one corrupted its feedback state. Microrepeat recordability uses `loop.dsp` record-only 2nd input `glitchIn` (fed `prevGlitchTap`), never one-block feedback loop.
- pitchtracker: `pitchtracker_ac.dsp` in own bundle (`Lv2Host pitchTrackerFx`, `/effects/pitchtracker`):37-candidate autocorrelation grid + `energyReady`/`holdLastGood` onset gating. Job `pitchtracker-native` renders it through REAL faust codegen (`tools/pitchtracker-render/`).

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`midi.cpp`):APC Key25 pads/buttons channel 0, keybed + sustain CC64 channel 1. SHIFT = `kApcBtnShift=0x62` ch0; sustain CC64 (`d2>=64`) latches `m_sustainLatched`. Live capture unrepresentative until SHIFT + latch-sustain both sent (`raw 90 62 7f` then `raw B0 40 7F`, >=0.3s apart).

Every momentary Faust gate needs explicit release or sticks at 1: `looperN/erase` (`pollHolds` ~50ms), `looperN/finishreq`, `cmd/clearall`. Every abandon path (`applyRecPlayCycle` `rawSamples<=0` abort, `pollHolds` hold-erase, `onClearAll`) must pulse `finishreq=1` + `finishtarget` = real telemetry `widx` BEFORE `rec=0`, or `pend` stays latched. ARM on PRESS, FINISH on 2nd PRESS; press during far-extend wait NO-OP. `kHoldEraseMs = 1000` (apc_grid.h:19): `pollHolds` erases looper, clears `m_looperHasContent`; `!anyHasContent && m_masterLenSamples != 0` self-heal zeroes `cmd/master_len`/`cmd/recorded_bpm`/`cmd/recorded_beats` + calls `link>resetTempoAuthority()`. `loop.dsp` writes `wlenNext` only at FINISH: `wraplen>1` NOT proof of content; track `m_looperWrapLenStaleAfterWipe` or 5 Hz self-heal resurrects wiped loopers as paused.

FX pages, 3 x regular/shift x 8 knobs:Dub `fx/{reverb,delay,time,hp,lpres,lp,pitch}` + CC53 Formant, shift `fx/dubgate/*`+`fx/dublfo/*` (4-beat clock); Guitar `fx2/{FLANGE,TREMOLO,BANKSPEED,PHASER,DIST,VINYL,FLUTTER}AMT` + CC53 `fx2/GATEAMT`, shift dual-ADSR to `Sampler`; LofiFx `fx2/BITCRUSHAMT` + 4 patch weights, shift direct dials.

## Content phase-anchor

ARM records from press, anchored at NEAREST fine-grid node. `kFineGridBeats=0.125`; at `armEdge` `rsmNext = rsmNearestNode` (circular correction <= half cell).

Per-loop beat scale `s`: `1/ratioClamped` at `finishEdge`, `1.0` at `armEdge`; read-head rate `s*masterPhaseSlope`, so take drifts off grid IFF `s != 1`.

FINISH length near-cut/far-extend (`pickAnchorGridBeats`:16/8/4/2/1/0.5/0.25/0.125), CAPPED at 1 phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot within `cutTolerance = max(1 beat, min(anchor/2, takeLen/8))` cuts now, else extends to next tier. Bounds 64 .. `kMaxLoopSamples` 48000*60. `snappedWrapLen = ceil(finishTakeLen/anchorGridLenNow) * anchorGridLenNow`, `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))`. `cmd/master_len` fallback must run whenever Link not length driver:nested inside `if (g_link)` it never ran with NULL Link.

First (master-establishing) take OWNS tempo. `master_len` stays raw write index; `deriveTempoQuant(seconds, anchor)` picks power-of-2 beat count {1..128} whose bpm is log-closest to `anchor` in `anchor/2..anchor*2`; the master-establishing branch passes `120.0` LITERALLY, never the inherited Link session tempo. `cmd/recorded_bpm`/`cmd/recorded_beats` follow; `LinkBridge::imposeTempo()` pushes bpm, landing `effSpeed` 1.0000. Anchoring on the session tempo let a stale/unowned mesh tempo (left over after `resetTempoAuthority()` on clear-all) drag the pick a whole octave off 120:witness 0.817 s take at mesh 73.80 bpm derived 1 beat / 73.41 bpm where anchor 120 gives 2 beats / 146.8 bpm. Anchor 120 confines EVERY first-take result to 84.85..169.7 bpm. Link-driven length path must not pin `looperLen`/`MLB`/`recorded_beats` over existing take:pinned to hardcoded 4 beats, 8-beat take folds against 4-beat grid. Measure grid against `master_len_samples / recorded_beats`, never rounded `link.bpm`.

Of 3 recorded-beats pins only `MLB` live (`dsp/effects_runtime_pre.dsp:20`, `microrepeat.dsp`):at `block_size=64` `sliceLen` 12544 vs 24960, micro-repeat an octave too fast. Other two INERT:no `.dsp` declares `looperN/len` (`loop.dsp` takes beat count as signal input, `audio_thread.cpp:1033`); `RECORDEDBEATS` only in unshipped `dsp/effects_runtime.dsp`, pre half passes only `DIV`+`MLB` to `microStage`, so `beatsSafe` stays 16.

## Varispeed punch: BAKED into dry take, REPLAYED out of SHIFT resample

`cmd/halfspeed`/`cmd/doublespeed` APC NOTES 70/71 ch0 (never cc70/cc71) > `g_manualSpeedMul` (0.5/1/2) > `effSpeed`. `loop.dsp` 9th input `manualSpeed`, 10th `foldNow` (raw SHIFT `freeXpose`): `manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = clamp(effSpeed/manualSafe, 0.1, 8.0)`. Beat lengths use `ratioClamped`, never `speedClamped`:else C++ `finishtarget` stops matching `snappedWrapLen`, take doubles.

Dry take (`foldNext == 0`):latches `v = manualSafe` at `finishEdge` (1.0 at `armEdge`); `vBaked = v != 1.0`, `speedForTake = v / manualSafe`.

SHIFT-resample take (`foldNext == 1`, sticky from `armEdge`):fold tap post-varispeed, so punch is IN captured audio; read at LIVE punch alone (`vNext` forced 1.0 at `finishEdge`, `vBaked` false, `speedForTake = 1.0`). Never divide captured punch back out:neutral 440 Hz, tap pattern discarded; `kRateDecim=64` (removed) flickered `resyncCoeff` 0/0.0005.

## Groove: swing + volume gates on beat pads

`kApcBeatPadNotes={15,23,31,39}` 1-of-4 latching selectors; `fx/shuffle/mode` (0..4) picks `kGrooveSwings[5]` `{gridBeats,ratio}`:8th 0.50/0.54/0.58, 16th 0.58/0.66. Every ODD cell delayed `(ratio-0.5)*2*gridBeats*grooveBeatLen`, HARD-CAPPED `kGrooveSwingMaxSeconds = 0.040`. Swing depths indexed by MODE:pad N offset `kGrooveSwings[N]`, not `[N-1]`. Note 7 (`kApcPadGateMod`) HELD + beat pad switches pads to `fx/gate/mode` (0..4):off, chop 1, chop 1/2, pump (duck 0.12, exp release 0.18 beat), swell. Gate multiplies `loopSumPreBuf`:ONE point reaching master out. `grooveBeatLen` TEMPO-derived (`sr*60/(recordedBpm*effSpeed)`, else Link bpm, else 120):never `masterLen/recordedBeats`.

`dsp/loop.dsp` varispeed NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked` exact):never smooth jump or swing clip.

Beat pads BEAT-SCHEDULED, never polled. `Telemetry::gridBeatIndex` 5 Hz-frozen `LinkSnapshot`, NO extrapolation (unlike `linkTargetSamples`), so steps land at control ticks:0..217 ms late at 217 bpm. `ApcLeds::refreshBeatPads` bypasses `kRefreshMs`, driven by `LinkBridge::beatMarkNow()` (whole beat + `timeAtBeat(w+1, kLinkQuantum)`); MIDI thread sleeps `poll()` to it, capped 100 ms, RE-READS beat after wake.

Tap reads:Catmull-Rom, wrap at `wrapLen` not `MAXLEN`.
