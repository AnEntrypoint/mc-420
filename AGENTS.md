# aloop - current-state constraints

Real Pi 4 root/aloop at `192.168.137.132`; `.100` is the cmdline-pinned netboot address and fails ARP. Pi 3B+ netboots from host. BEHAVIOR clone of `../looper` only: never vendor its source / `LOOPER_DIR` / `loopMachine.cpp` / effects-bridge shim. Shipped `ffaa83d`; input-routing build `0947f3a`+`9cdcae0` (sizes/md5/CI: archive#shipped-builds). RULES only: numbers -> `docs/measurements-archive.md` (below: `archive#anchor`), decisions -> `docs/DECISIONS.md`, rows -> `docs/plans.md`.

# Loop timing invariant (user decision; governs every recording path)

- The first loop recorded, standalone or on a ticker network, is the master for tempo, phrase and grid origin. Its tempo and phrase come from the recorded length and beat count; its origin is the sample at which the record button was pressed, never a grid node and never the block that processed the press.
- Every later sound plays exactly on the master grid, referenced to that press sample: no audible shift forward or back, seamless wrap, identical under every effect chain and whether standalone or on a ticker network. Only resampled material (SHIFT resample, `recordTap`) is backdated, by a per-strategy offset that tracks measured additional latency, so resampled samples stay on the reference grid.
- Recording a non-first loop follows the MC-505 model: length folds to halves and quarters down to one beat, so a loop of any length is reachable in beat-long steps. The stop point is the nearest legal boundary: an early press before the ideal boundary keeps recording to that boundary (intentional); a late press within one beat after a half or quarter boundary is an unintentional late press and the earlier boundary is taken. Playback continues without any shift at the stop point.
- A slave clock that starts empty, or on a hi-hat, adopts the tempo and phrase of the first recording of any peer as soon as that recording is published, and locks its phase to the press origin. Each device publishes the master tempo and origin; no device substitutes its own press time.
- The esp-idf-link bridge that drives synths behaves identically: it adopts the master tempo and origin and plays the intended phrasing as soon as it is published.
- Verification: `tools/loop-quantization-sim` must model every rule above and pass. The simulator is a model, so each rule is live only after a hardware witness.

# Working rules

- No comments in code ever (C++/.dsp/JS/shell/YAML, `.gitignore`); 1 sighting: sweep file. Exempt: `#!`, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, commented-out keys in `config/aloop.conf`, `vendor/` + regenerated Faust.
- Never add audio-path latency: ~7 ms must never grow, even temporarily; stop + ask first. Exempt: engaged wet effect's own algorithmic latency.
- Effect parity (#3): every effect must do for resample (`recordTap`) what it does for live input (`inputFxOut`) + cue (`filtOut`); `dubGateLfoStage` on `recordTap`+`filtOut`, NOT `inputFxOut`. The CI parity gate catches the un-fix. (archive#effect-parity)
- No WSL/Docker; missing compute = GitHub CI/CD (`gh`). WebSearch before irreversible hw steps; Windows Firewall silently black-holes Pi: rule it out before blaming netboot/SSH.
- This host cannot build native deps (no cmake, no X11/GL/freetype/alsa headers, uid 1000 so no apt): a clean-install check is a CI job, never a local run. A Linux clean install needs the GL dev packages plus freetype via `CPATH`. (archive#host-build-limits)
- Test on real hw, never ask the user to reproduce: MIDI injection (`tcp/9401`, `midi-inject.js`) or SSH (JS `ssh2`; never `ssh.exe`/`sshpass`). `gm ssh` cannot dispatch here, so use `SSH_ASKPASS=<script echoing the password> SSH_ASKPASS_REQUIRE=force setsid ssh|scp -o StrictHostKeyChecking=no root@<ip> '<cmd>' </dev/null`. Link needs a real peer (`link-peer.cpp`).
- Live witness loop, no human needed: `tools/loopback-witness/loopback-witness.js --wav <corpus file> --semis N --seconds N` (channels: archive#live-witness-channels). Sustain latch is a TOGGLE: read `sustain_cmd` first, send SHIFT+sustain only when it is 0. A capture counts only when its segment RMS is >=10 dB over a same-run silent control; `--selftest` must read 7/7. (archive#witness-validity)
- Judge pitch-lock runs by the HOP-LEVEL MEDIAN; the whole-segment estimate picks one loud window and drifts. `tools/witness-summary` parses the logs and keeps `NOT_DETECTED` as its own verdict; CI checks it.
- Clean ingress is the Focusrite loopback (ADR-029); bare AIR 192 reads silent; ANY click/tear witness through `snd-aloop` is INVALID (`snd-pcm-oss` and `period_size=64` beds rejected). (archive#clean-ingress-focusrite-loopback)
- `dsp_cli` (`tools/dsp-cli/dsp_cli.cpp`, no device/ingress): `./dsp_cli --solad in=<corpus wav> out=/tmp/o.wav semis=24 normrms=0.21 && ./dsp_cli --glitch-check /tmp/o.wav threshold=0.25 minGapMs=5`. NEVER render over `test-audio-corpus/`. `--solad freq=` is REPORT-ONLY; `--pitch` is octave-ambiguous on PSOLA output: pass `minhz`/`maxhz`. (archive#dsp-cli-usage)
- aarch64 vs host is characterization-identical, NOT bit-identical; CI compiles the pinned `dsp_generated.cpp`. Compiling clean proves nothing: regenerate real C++ and diff byte-for-byte. Heap-allocate large DSP instances. A crash fix can UNMASK a 2nd bug: re-measure the SAME metrics. (archive#aarch64-vs-host)
- W hygiene: target == detected note reads "no shift" -> distinct targets; `rc-service aloop restart` between MIDI scenarios. Telemetry lag JITTERS tens of ms -> rate only by least-squares slope over >=20 s, skip ~6 s after FINISH. SLIP = `readpos` vs `master_phase_beats*beatLen` from the SAME reply; replies TEAR -> `despikedSpread()`.
- Faust codegen cliff: a NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile; new controls go in `effects_runtime.dsp`. Read lag taps from a 4096-deep `rwtable` with a modulo-bounded counter, never variable-lag `@`. Compiles run ONE at a time. (archive#faust-codegen-cliff, archive#compile-memory-and-ci)
- NEVER per-block `fprintf` on the audio path: rate tracks live audio, so silence hides it and the log fills the disk. (archive#per-block-fprintf)
- Telemetry QUERY-ONLY: UDP `status` -> `192.168.137.132:4445` -> JSON; no `/run/aloop/telemetry.json`; field list in `src/telemetry.cpp`, never cache it. `core_busy` UNDERCOUNTS (only `compute()`): cross-check `/proc/<tid>/stat` vs `/proc/uptime`. Zone pins are invisible: `g_telem.recordedBeats` reads ParamStore, pins write Faust ZONE POINTERS. The Pi clock is UNSET: cross-device log correlation needs an offset.
- Shared tree, one writer: take `.gm/locks/<repo>.writer` with `set -o noclobber` before editing, release when the commit lands; a dead or 10-15 min idle holder is quarantined, never waited on; finding it held, verify read-only. Commit by explicit path, push by full sha; a non-`main` branch at a git step is a residual. Never `git reset --hard` without echoing the target path in the same command (cwd resets between calls). If the gm git verbs throw "Maximum call stack size exceeded" through MCP, use the CLI: `node /config/.gm-tools/gm-mcp-server.mjs dispatch git_commit|git_push --cwd <project> --body '{...}'` (YAML out, match `sha_full: <hex>`; a commit body without `paths` is refused).
- Branches consolidate onto `main`, then delete (local + remote) once `git log main..<branch>` is empty; never delete `origin/gh-pages`. `run-all-verifications.js` exit 2 = skipped, not failed; CI caches the 7-16 min `pitchtracker_ac.dsp` Faust compile.

# Device, image and boot

- Pi 4 boots from its own SD AND is the netboot server, so `.netboot-serve`/`.netboot-update-sha` never change its binary: hot-deploy = sftp CI artifact to `/opt/aloop/aloop` + `rc-service aloop restart`. `nproc`=2 EXPECTED (cmdline isolates 1,3 for RT audio). Hot-deploys live on tmpfs, so a power cycle drops every deploy; persisting a build is OPEN (PRD `decision-reboot-persistence`). (archive#device-binaries)
- Image traps: `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/` never appear; `aloop` OpenRC needs `rc_ulimit="-l unlimited -r 95"` in its service file (not `local.d`) + `depend()` `after local autoap`; vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; split `faust2lv2` (only the final `-shared .so` targets the device); `objdump -p foo.so | grep NEEDED` > `libc.musl-aarch64.so.1`.
- `disable_core3_lv2 = 1` in `/etc/aloop.conf` makes the worker skip `homeFx.process()`/`userFx.process()`: fully silent, survives restart; match it before debugging silence as a code bug. Loop engine is TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around `delayverb.lv2`: both must update `audio_thread.cpp` includes in the SAME commit or CI ships an engine-less binary.
- No `/dev/snd/seq`: MIDI uses `snd_rawmidi` on `hw:CARD,DEV,SUB`, enumerated PERIODICALLY or a late controller never opens; `midi.cpp`'s 100 ms poll is too coarse for 24 PPQN -> `midi_clock.cpp` runs its own thread off `LinkBridge::beatNow()`.

# Deploy, netboot, CI

- `REBOOT:<token>` UDP listener INSIDE aloop (`udp/4446`, `[remote] token=`): a crashed aloop means nothing listens -> SSH `reboot` is the fallback.
- Netboot self-update: `serve-netboot-win.js` polls `build-binary.yml`/`build-lv2.yml` green `main` every 30 s. TFTP ok + ZERO HTTP = hung till power-cycle. `ensureCorrectSubnetMask()` /16 broadcast: Pi re-DISCOVERs forever, zero TFTP reads. Served payload can be STALE: check the served apkovl mtime/md5 against the latest CI build. A power cycle is the only reliable recovery from a stalled TFTP.

# Mesh networking

- aloop (Pi 4) + `../esp-idf-link` form ONE ad-hoc single-AP mesh for Link multicast discovery (`224.76.78.75:20808`); change BOTH sides or the mesh splits. Invariants (aloop / esp): SSID `ticker`, open auth (`key_mgmt=NONE`), AP/DHCP `192.168.4.1/24` (dnsmasq `.2-.20`), ch 6, quantum 16.0.
- brcmfmac: `iw dev wlan0 scan` while hostapd beacons knocks wlan0 off AP mode; hostapd survives with NO BSS -> no peer associates. `iw dev wlan0 info` `type AP` is the ONLY truth; `autoap.sh` gates `scan_mesh_bssid` behind `AP_SCAN_IDLE=90` s.
- Link multicast needs the ROUTE, not just the join: without `224.0.0.0/4 dev wlan0`, `ip route get 224.76.78.75` = unreachable while `/proc/net/igmp` shows membership; install in `start_ap()`/`join_sta()` + re-add every tick.
- TWO-DEVICE LINK SYNC UP: `verify-two-device-sync.js <pi-ip> 600000`; FAIL on peer <95% post-acquisition, bpm spread >0.05, |phase_err_beats| >0.03, eff_speed spread >0.005, gaps >10%. Post-acquisition = t > +60 s from cold boot (opening the ESP's USB serial reboots it); ~1% ICMP loss on the mesh is NOT a fault. (archive#two-device-sync-acceptance)
- `peers` 1->0 WHILE associated is esp-side IP loss, never Wi-Fi. Route flap drops the Link peer: restart it within 45 s or it self-heals only in ~1 h. (archive#soaks-and-route-flap)
- aloop binds 20808 + 4445/4446 ONLY (never 20810/20812). `/var/log/messages` is the association authority.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; the audio thread reads a lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated at session tempo.
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` is the only writer of `weOwnTempo`; never gate `linkSpeedRatio` on it; `imposeTempo()` republishes in the same call or the finish edge doubles the take. (archive#link-tempo-authority)
- CLOCK-ONLY FOREVER (user decision: a localized stop must not stop the others): `enableStartStopSync(false)`, never `setIsPlaying`; tempo + phase shared, transport NEVER. `setIsPlaying*` exists ONLY in `tools/loop-quantization-sim/` -> peer `isPlaying()` ALWAYS false.
- Phase trim applies to `masterPhaseSamples` ONLY, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`; `masterPhaseBuf` ramps per-sample (never `std::fill()`); `effSpeed` carries TEMPO alone; `masterPhaseSamples` advances at `linkSpeedRatio` ALONE. (archive#link-phase-trim)
- Our material never moves for Link; the session moves to us. Only idle grid snap (`!anyAudible`); join IMPOSES our phase (`requestPhaseImpose(...)` > `forceBeatAtTime` off-thread) at circular error > `kJoinSnapErrBeats=0.25`. `wasLinkDriving`/`wasLinkSynced` clear when Link stops driving -> a reconnect reads as a join. `!masterJustCreated` in `linkJoined` (`audio_thread.cpp:909`) is a NO-OP.
- Two quantums: 16 transport (PAIRED) and 128 phase CAPTURE. Phase is ABSOLUTE-beat: folding a 128-beat capture at `rb` is WRONG unless `rb|128`; capture at loop quantum, falling back to 128 only when absent or != recorded beats. (archive#two-quantums)
- Resnap witness: `.gm/resnap-rb3.js 900000` with `recorded_beats=3`; judge the NEXT 1.5 s after the impose. Anchors taken before a timeline re-base are off by `(-dBeat) mod rb`. (archive#anchors-before-timeline-re-base, archive#resnap-witness-rb3)

# Audio thread and ALSA

- `worker()` opens 2 PCMs: instrument (default `hw:0,0`) tight-latency blocking capture+playback; OTG gadget (`f_uac2`) best-effort NONBLOCK MIRROR; MASTER never cue. Instrument `RW_INTERLEAVED`/`S32_LE`/2ch/48k, `period_size=block_size`, `buffer_size=period*4`. `instrument_device_match` (default `AIR 192`) substring-matches `/proc/asound/cards` at EVERY open; mis-resolution = control surface as instrument, silent. `Sampler::captureBlock` reads `prevFiltOut`, never `fin`. OTG is PLAYBACK-ONLY (`audio_thread.cpp:590`); only `UsbRecorder` (`:1153`) really captures.
- `worker()`'s stack locals (`Sampler`, `Lv2Host homeFx`, `UsbRecorder`, `ClipExporter`) are used after unwind -> SIGSEGV `outside-plugin`; keep them process-lifetime `std::unique_ptr` (`g_*Owner`). Control-written/RT-read buffers (`Sampler::setGrainPatch` 129-float LUT) must be double-buffered release/acquire, never rebuilt in place.
- ENGAGED latch: `engagedZone` written 1.0, never cleared, so one mod-wheel touch engages the pitch stage for process life. The else-branch clears it (`audio_thread.cpp:735`); cost one 128-sample discontinuity at disengage. (archive#engaged-latch)
- SHIFT (`fx/monitorfold`) fold is CROSSFADE: `fin[i] = fin[i]*(1-combinedFold) + prevLoopSum[i]*combinedFold`, `combinedFold = min(1, foldGain+glitchFoldGain)`, ramping at `kFoldStepPerSample = (1/16)/N`. Three consumers differ: Faust zones ramped, `freeXposeBuf` RAW `monitorFoldVal > 0.5`, `loopDirectGateNow` one-pole `kLoopDirectPole=0.9355`.
- Latency bias is MEASURED (`snd_pcm_delay` after `readi`, before `writei`, averaged over 4 s, never a fast EMA) and the resample (SHIFT) bias is DERIVED from `combinedFold`: never guessed. (archive#latency-bias)
- `[diag-gap]` is rate-limited by `diagGapAllow()` (1 s). (archive#diag-gap-limiter)

# Resonode and the granulator

- Hot-deploy the WHOLE `.lv2` bundle (`.so` AND `.ttl`): a stale `.ttl` mismatches LV2 port indices; the plugin faults on first process and silently disables itself.
- Measure, never guess: `tools/resonode-lab/` compiles `resonode_synth.dsp` with the pinned flags; granulator changes ship with a CI render harness.
- Resonode: `highFreqDampExponent` stays `1.0*(1-damping)` (the log form is REJECTED); `impactSig` sits OUTSIDE `excEnv`. (archive#per-partial-decay-and-impact)
- `collisionDrive` normalises by `1/driveAmt`, NEVER `1/tanh(driveAmt)`. (archive#collisiondrive-normalisation, archive#waveguide-object-stage)
- The granulator is `Sampler`, NOT `effects/home/faust/grainFormant.h` (only the SOLA shifter's formant layer). Freeze = the scan dial's bottom eighth; `scanRate=0` is NOT a freeze. (archive#granulator-live-ring-witness)
- No L/R bus: ch0 master, ch1 cue, mono floats. `lv2_host` disables plugins wanting >1 audio port per direction.

# Finding the device

- The device answers at `.132`; `.100` fails ARP. `/var/lib/misc/dnsmasq.leases` is the authority, not the pinned address. Restart with `sudo systemctl restart dnsmasq`, never mid-TFTP: killing it during the 23 MB `boot/vmlinuz-rpi` transfer strands the bootloader.

# Faust DSP

## Compiler flags

- `-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/`-mapp`/fast-math/`-mem`/`-vs 16`, and never `-omp`/`-sch` (fights `pthread_setaffinity_np`). DSP gotchas: `&` binds tighter than `>`/`<`; `par()`-replicated UI controls RE-ELABORATE per call site; no runtime branching (`select2`/`ba.if` pick among ALREADY-COMPUTED signals); recursion `namedStep ~ _` (no lambda left of `~`).

## Free-transpose engine (`soladSnacOctaver.h`)

- Poly pitch-LOCK: `NVOICES=6`, one `snacPeriodTracker.h` sweep (`BLOCK=64`); step MUST stay block-aligned (`m_sinceBlock==0`). `engaged` held by release counter `engageReleaseHoldS=0.06`: never gate on `gate>0.5`/`voiceEnv>0`. `DL=32768` (131072 corrupts the Pi 32-bit build), `MIN_PERIOD=16`, `SHORT_LAG_STRICT_PERIOD=48`; `m_xfadeLen` DIVIDED by pitch ratio; splice cooldown divides by rate: read `m_scale`, never `m_targetScale`. Overtake fix: clamp `m_rdA`/`m_rdB` to `m_wr - (SINC_HALF+2)` after advance.
- Upward-shift clicks are NOT fold-back aliasing; the count tracks `peakStep`. REJECTED: stride-adaptive kernel; write-side anti-alias (FORBIDDEN). (archive#upward-shift-fold-back-refuted)
- Above 1000 Hz: the stricter CMNDF accept below lag 48 is REQUIRED with `MIN_PERIOD` 16; never lower `MIN_PERIOD` without it. Prefer `--pitch` above 1000 Hz. (archive#8df2e2c-above-1000-hz)
- SNAC cap: `MAX_PERIOD` 900, `LAGS_PER_STEP` 53, `LONG_LAG_STRICT_PERIOD` 800 (`effects/home/faust/snacPeriodTracker.h:10-13`, gate at `:278`); capped to sweep timing, so a range change alone silently re-times detection. Lags >=800 need `refMin > kDiffAccept` and a CMNDF min below `kDiffStrict`, never a raw correlation peak. (archive#snac-cap-900-below-60-hz)
- Tremolo/AM subharmonic lock is NOT an anti-jitter clamp: a bad lock lands on the FIRST completed detection, so fix the CMNDF thresholds and parabolic refinement, never a clamp. (archive#tremoloam-subharmonic-lock)
- Pitch-lock live witness: `tools/loopback-witness/loopback-witness.js --lock <hz|wav> <midiNote> [secs]`; `shiftTarget = targetNote - heldDetNote` makes a detection octave error an output octave error one-for-one. ALWAYS `rc-service aloop restart` between lock cases. (archive#pitch-lock-witness-and-void-figures, archive#pitch-lock-lead-in)
- The lock shift is applied ONCE: output error EQUALS detector bias, so the "doubled shift" explanation of mid-high error is REFUTED and the fix belongs in the tracker. (archive#lock-shift-applied-once)
- `extFreqGuardAnchor` (`audio_thread.cpp:1239`): a large jump needs corroboration (60 blocks, 120 near an exact octave); never latched at the 60 Hz floor. A fresh onset has NO anchor, so a candidate >half an octave from the REMEMBERED pre-silence anchor also needs the 120-block count, or an onset subharmonic (raw/2) is adopted in 3 blocks and holds off the truth for 120 more. That count is per-candidate, destroyed on every no-pitch block, so it re-arms per onset; a corroborated pitch is exempt via an 8-slot known-pitch ring, so cost is once per distinct pitch - cycling more than 8 octave-separated pitches evicts and re-pays one acquisition on return (stated ring limit, not a defect). REJECTED: holding through no-pitch. (archive#extfreqguardanchor-corroboration)
- An octave JUMP in audible output comes only from the pitch-LOCK path; free-transpose pitch does NOT depend on the tracked period. (archive#free-transpose-pitch-independent-of-tracker)
- Four pitch estimates exist (mono SNAC, poly SNAC, LV2 AC, ZCR) and the mux at `multitranspose.dsp:141-143` is where they disagree. (archive#extfreqdet-written-four-estimates)
- Measurement gates the claim: measure on the full 34-file corpus, a small corpus lies. Corpus note LABELS are NOT ground truth: score against the measured peak in `.gm/witness/corpus-pitch-reference.txt`. A `.dsp` edit is NOT shippable from this host (host faust and its 120 s SIGALRM differ from CI). (archive#measurement-gates-the-claim, archive#netbooted-address-and-dsp-shippability)
- Corpus is 34 files, all 48 kHz mono 16-bit, licences per file in `test-audio-corpus/instruments/manifest.json`. Anything you add: verify the licence first, an unverifiable licence is dropped not downloaded.
- `m_confidence` never zeroed on rejected/silent frames. `confidenceGate = 0.85` (`multitranspose.dsp`) gates RE-TRACKING only; `kContGate = 0.50` (`snacPeriodTracker.h`) gates whether `confidence()` reports it. `confOk` must NOT gate acquisition (`trackingAllowed` = `trustedTracker > 0.5` ALONE). (archive#confidence-gates)
- `pitchtracker_ac.dsp`: peak demote, raw promote; damper in `detectedFreq`, `baseFreq` drives tap indices. Pitch-lock runaway: `everTrusted` latch + reseed `heldDetNote` to `targetNote` at EVERY `attackEdge`; root cause is DUPLICATE LAGS in the grid (ties pass a `>=` peak test), NOT normalization. `extFreqDet` analyzes `fin` only: trust only when `free<0.5`.
- AC tracker: timbre shift is OCTAVE FLICKER, not a lasting swap; `takeNew` requires `stableRun >= confirmSamples`; the counter MUST read `coarseFreq`, never `refinedNow` (drags the refine tree into `~` recursion); refine spread is LAG-PROPORTIONAL (a fixed +-16-sample window is biased above ~1000 Hz). (archive#ac-tracker-timbre-shift, archive#refine-spread-lag-proportional)

## Pitch witness and open pitch defects

- Device zero-pitch: `holdLastGood` zeroes the published pitch on the energy gate's falling edge while the note still sounds. (archive#energy-gate-falling-edge)
- NOT admitted: the HOLD VARIANT `heldStep(prev) = ba.if(accept, freqHz, prev)`, the sub-60 Hz tracker, the 2093 Hz root, the dedup tracker, the v3 confidence and energy-only gates. (archive#energy-floor-sweep, archive#168b38c-revert)
- A1 (55 Hz): AC silent at baseline; the energy gate opens before confidence does. (archive#a1-window, archive#lock-periodicity)
- OPEN: the ~0.3 s unpitched lead-in; missed notes and onset octave errors (PRD `defect-transient-onset-and-gross-errors`); MIDI 96 device shift unread. (archive#midi-96-witness)

# LV2 hosting

- `Lv2Host::instantiate()` needs NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never bare `nullptr`: Faust `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in the sigsetjmp watchdog `runOne()` uses. `setControl` matches the Faust MANGLED port symbol (`fx2/FLANGEAMT` > `fx2_FLANGEAMT_3`).
- Resonode: output REPLACES original + preChain at crossfade in `effects_runtime_pre.dsp:37`; `resonodeIn` ZEROED when engaged with no plugins loaded; `RESONODE_ENGAGED` via `fui.set()`, bypassing `targetToZone`. delayverb: 2 halves, `.process()` only when `delayVerbActive`, 2 instances (`delayVerbFxCue` + `delayVerbFxMaster`); sharing one corrupts feedback. Microrepeat recordability uses `loop.dsp`'s record-only `glitchIn`, never a one-block feedback loop. pitchtracker: own bundle (`Lv2Host pitchTrackerFx`, `/effects/pitchtracker`).

# Control surface (`src/control/apc_grid.cpp`)

- MIDI routing (`midi.cpp`): APC Key25 pads/buttons ch 0, keybed + sustain CC64 ch 1. SHIFT = `kApcBtnShift=0x62` ch0; sustain CC64 (`d2>=64`) latches `m_sustainLatched`; live capture unrepresentative until SHIFT + latch-sustain both sent (>=0.3 s apart).
- Every momentary Faust gate needs explicit release or it sticks at 1. Every abandon path must pulse `finishreq=1` + `finishtarget` = real telemetry `widx` BEFORE `rec=0`, or `pend` stays latched. ARM on PRESS, FINISH on 2nd PRESS; a press during far-extend wait is a NO-OP. Hold-erase self-heal (`kHoldEraseMs`, `apc_grid.h:19`) zeroes tempo pins once no content remains; `wraplen>1` is not proof of content (`m_looperWrapLenStaleAfterWipe`). (archive#hold-erase-self-heal)
- Input routing: pads 14/22 (col 6 rows 1-2) toggle capture ch1/ch2 between recordable and mixer-only passthrough; split = complementary ramped gains in `worker()`, NEVER Faust (codegen cliff). Both recordable => `fin` bit-identical to the old mono sum, `mixOnlyBuf` exactly 0.
- SUSTAINGATE is at the END of the master chain, so master and record are the SAME process; `snapGate` is REQUIRED on `si.smoo`. Mixer/passthrough channels are UNGATED and never reach `recordTap`. (archive#sustaingate-and-snapgate)
- Groove: `kApcBeatPadNotes={15,23,31,39}`; `fx/shuffle/mode` (0..4) picks `kGrooveSwings[5]`, pad N offset `kGrooveSwings[N]`, not `[N-1]`; ODD cells delayed `(ratio-0.5)*2*gridBeats*grooveBeatLen`, capped `kGrooveSwingMaxSeconds = 0.040`. `grooveBeatLen` is TEMPO-derived (`sr*60/(recordedBpm*effSpeed)`, else Link bpm, else 120): never `masterLen/recordedBeats`. `dsp/loop.dsp` varispeed NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked` exact).

## Content phase-anchor

- ARM anchors a take at the master phase it was armed at, NOT a grid node: `rsmNext = ba.if(armEdge, masterPhase, rsmPrev)`; read-head drift off grid IFF per-loop scale `s != 1`. (archive#arm-anchor)
- FINISH length is near-cut/far-extend, capped at 1 phrase; `cmd/master_len` fallback must run whenever Link is not the length driver (NULL Link case). (archive#finish-length)
- First (master-establishing) take OWNS tempo: integer beat counts via `deriveTempoQuant`; the master branch passes `120.0` LITERALLY, NEVER inherited Link session tempo; Link-driven length must not pin `recorded_beats` over an existing take. (archive#first-take-owns-tempo)
- Only `MLB` of the 3 recorded-beats pins is live; `looperN/len` and `RECORDEDBEATS` are INERT. (archive#live-recorded-beats-pin)

## Varispeed punch: BAKED into the dry take, REPLAYED out of the SHIFT resample

- `cmd/halfspeed`/`cmd/doublespeed` are APC notes 70/71 (never cc); beat lengths use `ratioClamped`, NEVER `speedClamped`, or the take doubles; release returns to the UN-PUNCHED playhead. (archive#varispeed-ratio)
- Dry take bakes the punch (`vBaked = v != 1.0`); the SHIFT-resample take has the punch IN the captured audio and is NEVER divided back out. (archive#dry-vs-shift-resample-take-punch)
- Passthrough hiss (#4) is UPSTREAM of `fin` with ZERO added delay; the ONLY inharmonic residue is ENGAGED=1 + FORMANT>0. (archive#passthrough-hiss-4)
