# aloop — current-state constraints

Real Pi 4 `192.168.137.100`, root/aloop; a real Pi 3B+ netboots from the host. Current-state only.

---

# Working rules

**No comments in code, ever** (C++, `.dsp`, JS, shell, YAML, config). A name or function boundary IS the
explanation; one sighting spawns a sweep of that file; never trust an in-repo comment as ground truth.
Exempt: `#!` shebangs, `# syntax=docker/dockerfile:1`, `# shellcheck disable=`, the
`grep '^#' "$0"` `--help` idiom in `image/serve-netboot.sh`, commented-out config keys that are the only
record an option exists (`config/aloop.conf`: `disable_core3_lv2`, `latency_trim_samples`).

**Never add audio-path latency** -- the ~7 ms block latency must never grow, even temporarily; stop and ask
first. A wet effect's own engaged-only algorithmic latency (`ef.transpose`, SNAC) is exempt.

**Test on real hardware, never ask the user to reproduce input** -- byte-level MIDI injection (`tcp/9401`,
`test/hardware/midi-inject.js`) or SSH state inspection. A Link session needs a real peer:
`test/hardware/link-peer.cpp`, host-built `-static` with `-DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601
-DASIO_STANDALONE -lws2_32 -lwinmm -liphlpapi -mthreads`, both `-I` roots under
`build/_deps/abletonlink-src/` (`include`, `modules/asio-standalone/asio/include`), output inside `build/`
(`deploy-binary.js` wipes `.deploy/`). `verify-peer-follows-loop.js` drives it.
**Telemetry (udp/4445) answers in ~190ms from the 5 Hz control loop and that lag JITTERS by tens of ms** --
any rate taken from two endpoint samples against the host clock measures the lag, not the device: a 10 s
watch read a perfect take 0.14% slow (-2.5 cents) once and 0.36% the next. Fit a slope over every poll of a
>=20 s watch instead (a 30 s probe of that same take reads +0.008 cents).

**Compiling clean proves nothing** -- x86_64 A/B passed while real aarch64 codegen SIGSEGV'd (`-mapp`);
`tools/dsp-cli` is not a device proof. **Before accepting any `.dsp` optimization, regenerate real C++ and
diff byte-for-byte** -- identical output is a no-op.

**Diagnostic logs carry wall-clock timestamps** -- `CLOCK_MONOTONIC` as `t=<sec>.<ms>`; WebSearch hardware
mechanics before irreversible real steps (OTP burn, firmware write); SSH via a JS `ssh2` client, never
Windows `ssh.exe`/`sshpass` (a fresh netboot mints a host key every boot).

**Faust compile-time cliff**: a NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/
`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded real compile time (`modeCount=24` dies by SIGALRM
~2 min into `-i -a lv2.cpp`). Declare new controls in `effects_runtime.dsp`, thread them in as plain signal
arguments.

**`tools/dsp-cli`**: heap-allocate large DSP instances -- a stack-local `AloopEffectDsp` faults
STATUS_STACK_OVERFLOW (`dsp/loop.dsp` is ~320 MB of state). **`tools/loop-quantization-sim`**: scales
per-sample constants by `kSimSpeedup = 48000/SIM_SAMPLE_RATE`.

---

# Boards, images, boot trees

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`: `pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`);
only `boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config` (cmdline/USB-gadget) dispatch per
board -- `boot_tree_apkovl` is shared. `board_supports_usb_gadget`/`board_wifi_irq_name`/
`board_firmware_names` are authoritative, not any list here. USB-audio gadget: pi4 dwc2 UAC2 only (pi3 no
OTG, pi5 RP1 host-only, opi-prime unproven). `boot_tree_fetch_opi` uses
`dl.armbian.com/orangepiprime/Trixie_current_minimal`.

ROM order SD -> USB -> Network: a card wiped of `bootcode.bin` falls through to network, so a live netboot
server silently takes it over -- always confirm which path booted.

## apkovl assembly constraints

- `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`, `usb_gadget/`
  never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"` in the service file, not `local.d`; `depend()`
  needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never `apk add` at boot. alsa-lib needs
  `vendor/share-alsa/` too or `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` **and**
  `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line (`tr '\n' ' '` + `tr -s ' '`); `core.autocrlf=true`
  corrupts scripts -- fix via `rm` + `git checkout --`. NTFS has no exec bit: new vendored files need both
  `tar --mode='+x'` lists; verify via `tar -tvzf` (LAST match).
- `lib-boot-tree.sh` excludes `aloop.lv2`/`resonode.lv2`/`pitchtracker.lv2`/`delayverb.lv2` from the shared
  home-stack copy; each is packaged separately.

---

# Device runtime environment

**Alpine/musl/aarch64 -- glibc/x86_64 artifacts silently fail to load.** Split `faust2lv2`:
`faust -i -a lv2.cpp` emits `.cpp`; `$HOST_CXX` compile+run emits `.ttl`; only the final `-shared .so` link
targets the device, cross-compiled in a real Alpine aarch64 container. Verify
`objdump -p foo.so | grep NEEDED` -> `libc.musl-aarch64.so.1`, never `libc.so.6`.

**`upload-artifact@v4` `path:`**: a literal path flattens the dir's CONTENTS at the zip root, dropping the
`.lv2/` wrapper -- always use a wildcard.

**`disable_core3_lv2` in `/etc/aloop.conf`** (commented out in `config/aloop.conf`): `= 1` makes the worker
skip `homeFx.process()`/`userFx.process()` -- fully silent, survives `rc-service aloop restart`. Grep it
before debugging silence as a code bug.

**Build traps**: the loop engine is built in TWO halves (`aloop_pre.dsp`/`aloop_post.dsp`) around
`delayverb.lv2`; both halves must update `audio_thread.cpp`'s includes in the SAME commit or CI ships an
engine-less binary. Link is fetched non-shallow (a shallow clone breaks its submodule/CMake setup).

---

# Deploy, netboot, CI

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process** (`config/aloop.conf` `[remote] token=`,
`udp/4446`, `remote_control.cpp`; client `image/aloop-reboot.js`). If `aloop` crashed, nothing listens --
`respawn_max=0`, it will not come back alone; SSH `reboot` is the fallback.
Verify before trusting device state: `/proc/uptime` and `md5sum /opt/aloop/aloop` vs deployed, BEFORE
reading logs.

**Netboot self-update, two paths.** Automatic: `image/serve-netboot-win.js` polls `build-binary.yml`/
`build-lv2.yml` green `main` every 30 s (blind to `image/**`); needs an elevated shell. Manual:
`image/build-netboot.sh`, where all four `*_LV2_DIR` vars plus `ALOOP_BIN`/`OUT`/`NETBOOT_SERVER` are
**mandatory**. A new bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js` --
neither reads the other's list. Both workflows gate on source paths, so a packaging/docs-only commit gets
no run: pass `--sha`/`DSP_SHA`. Before rebooting onto a rebuilt root, `md5sum opt/aloop/aloop` out of the
new `.netboot-serve/aloop.apkovl.tar.gz`.

Netboot facts: publish is a staged-directory atomic `mv` (staging a SIBLING of the live serve dir).
`SERVER_IP` is baked into the root's `cmdline.txt` ONCE -- restarting the server does not rewrite it;
rebuild with `NETBOOT_SERVER` and power-cycle. **If TFTP succeeds and ZERO HTTP requests land, the boot is
hung until power-cycled** (diskless init does NOT retry the modloop/apkovl fetch). Fast DSP iteration:
`node image/dsp-hotdeploy.js --target home|guitar|both` (stops the service first).

**CI**: native `ubuntu-24.04-arm` runners (no QEMU). `build-image.yml` downloads BOTH `home-fx-lv2` AND
`guitar-lofi-fx-lv2` from the SAME green run. Rolling `latest` hard-gates on a real bundled binary
(`payload_check`); artifacts need `retention-days: 3`. `get_parameters_description()` returns params
ALPHABETICALLY, not in declaration order -- a harness binds the wrong control silently.

---

# Mesh networking

## aloop <-> esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc single-AP mesh for Link's multicast
peer discovery (`224.76.78.75:20808`, hardcoded in the Link library).

| Invariant | aloop | esp-idf-link |
|---|---|---|
| SSID | `ssid=ticker` (hostapd/wpa_supplicant) | `wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |
| Transport | CLOCK-ONLY: `enableStartStopSync(false)`, never `setIsPlaying` | CLOCK-ONLY: no transport shared |

Host election is MAC-ordered -- never "host if scan found nothing". `src/net/autoap.sh` hosts `ticker`
never `aloop`, needs >=1 active `network={}` block before `start_ap()` does anything, and `start_ap()`
clears previous hostapd not just wpa_supplicant (stale -> `Could not set channel`, a red herring -- ch6 is
paired). The AP is open: `src/net/config/hostapd.conf` carries only `ssid=ticker` + `channel=6`.

## Ableton Link checklist

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only; the audio
  thread gets a lock-free double-buffered `LinkSnapshot` stamped `CLOCK_MONOTONIC`, extrapolated forward at
  the session tempo (5 Hz => up to ~0.4 beat stale).
- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` is the unconditioned version (the first loop owns the
  tempo, see below) and the only writer of `weOwnTempo` -- never gate `linkSpeedRatio` on it. Playback
  matches tempo by scaling read RATE (`linkSpeedRatio=linkBpm/recordedBpm` -> `effSpeed`), never a position
  jump. `imposeTempo()` republishes via `publishSnapshot()` in the same call: the finish edge is quantized
  against the 5 Hz snapshot, and a stale one doubles the take.
- **Link is CLOCK-ONLY: tempo+phase shared, transport never.** Pausing locally leaves every peer playing
  and none can start/stop us. `isPlaying` is a LOCAL flag (`setLocalTransportPlaying`, driven by
  `ApcGrid::updateLocalTransport`) feeding only `midi_clock.cpp`'s 0xFA/0xFC -- never set from peer state.
- Readiness: `depend(){ after local autoap; }` plus `waitForNetworkInterface()`.
- Residual phase error is a bounded trim on `effSpeed` AND the `masterPhaseSamples` advance
  (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, suspended while
  `abs(g_manualSpeedMul-1.0)>0.3`); `masterPhaseBuf` ramps at
  `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`. It runs ONLY while `linkVarispeedEngaged`, else it
  saturates into a permanent 51-cent detune -- `eff_speed` in `/run/aloop/status.json` must read exactly
  `1.0000` with no loop recorded.
- **Our material never moves for Link: the session moves to us.** Only the idle grid snap remains
  (`!anyAudible`): nothing sounds, so adopting the session phase is free. A join, or a peer reappearing
  after the count flickers 1->0->1, IMPOSES our phase
  (`requestPhaseImpose(gridPhaseBeats, nowMicros, recordedBeats)` -> `forceBeatAtTime` off-thread) when the
  circular error exceeds `kJoinSnapErrBeats=0.25`. Snapping there started a finished take mid-material.
- **A take is born at grid 0** (`masterJustCreated`): the grid is pinned to 0 and beat 0 forced on the
  session at that instant, so take start, grid downbeat and session downbeat are one moment and `eff_speed`
  stays 1.0000. Forcing beat 0 over a snapped grid left a residual equal to the old phase and saturated the
  trim ~30 s.
- After a tempo jump the trim needs seconds to converge: ~90 samples of grid slip at first -- measure
  steady state only after ~6 s.

**Two quantums -- 16 transport, 128 phase CAPTURE.** `kLinkQuantum=16.0` is the PAIRED value (transport
anchor, `beatNow()`, 24-PPQN clock). `controlTick()` captures phase at `kLinkPhaseQuantumBeats=128.0` and
publishes `quantumMicroBeats`; consumers fold with `(quantumMicroBeats/1e6)`, never `16.0`.
`cmd/recorded_beats` is the FOLD BASIS for the Link phase: unknown => no Link target. `applyRecPlayCycle`
publishes bpm/beats BEFORE `master_len` (the audio thread preempts between writes).
`pinLinkThreadsToControlCore` pins Link's threads to `kControlCore=2`; `[link] enabled = true` parses as a
word, not `%d`.

## MIDI clock fan-out

`midi_clock.cpp` owns its thread: 24 PPQN `0xF8` + `0xFA`/`0xFC` to every MIDI output but the control
surface; no `/dev/snd/seq`, it walks `/proc/asound/card*/midi*`, rescans every 2 s (outputs found while the
transport runs get their `0xFA`). Ticks are SCHEDULED off the beat timeline:
`LinkBridge::microsAtBeat()` gives the Link-clock stamp of the next whole pulse, the thread sleeps to it
and spins the final `kSpinNs=500000` (0.5 ms). A missed pulse is DROPPED, never bursted -- a burst reads as
a tempo spike to any device PLL. The surface is excluded by USB id (`09e8:0027`): `midi.cpp`'s scan runs a
first pass accepting only that id, then the enumeration-order fallback; the clock skips EVERY card matching
it and waits `kSurfaceGraceSeconds=15.0` for `controlSurfaceCard()`.

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices -- never conflate: **instrument** (default `hw:0,0`)
tight-latency capture+playback, blocking; **OTG gadget** (`f_uac2`) best-effort MIRROR, NONBLOCK
(`-EAGAIN` expected), carrying MASTER on all channels, never cue. Instrument **S32_LE only** -- buffer
`int32_t`, divisor `2147483648.0f`; skip the OTG S16 conversion when the gadget is not connected.
`period_size` = `block_size` exactly (not via `snd_pcm_set_params()`); sw_params `start_threshold` = one
period; **4 periods min**. `src/usb/f_uac2-gadget.sh`: `req_number` must be **4**, not the kernel default
2. Gadget is STEREO -- L/R averaged to mono for Faust. `AloopPreDsp`/`AloopPostDsp`/`Sampler` are
`std::make_unique`'d at thread startup, never stack-local.

**`instrument_device` is NOT the config literal**: `instrument_device_match` (default `AIR 192`)
substring-matches `/proc/asound/cards` at EVERY open, since USB enumeration moves `hw:0` between boots.
WITNESSED resolving to the APC Key25's card -- the control surface opened as the instrument, silently.

**Resolve string-keyed lookups ONCE, never per block** -- control WRITE and telemetry READ cache
`(ParamStore slot, Faust zone float*)` pairs at startup. `FaustUI`'s bargraph adders must do
`zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan. `targetToZone()` needs a case for every
control target -- a missing case returns `""`, silent. `masterPhaseBuf` must ramp per-sample, never
`std::fill()` with a block-constant value. Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`;
`Sampler`'s `captureBlock` reads that same `prevFiltOut`, never `fin`.

**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*combinedFold` engaged, `foldGain` ramping at
`kFoldStepPerSample` = `(1/16)/N` -- one block of recording lag. Two consumers differ: the Faust
`MONITORFOLD` zone gets ramped `foldGain`, `freeXposeBuf` the RAW `monitorFoldVal > 0.5` threshold.

**Latency bias is MEASURED, not a constant.** The audio thread samples `snd_pcm_delay` on the capture
handle right after `readi` and on the playback handle right before `writei`, EMAs `capDelay + playDelay +
N`, publishes it as `latency_bias_samples` (raw: `alsa_roundtrip_samples`). `latencyBias =
latencyBiasSamples + (shiftHeldThisTake ? kShiftFoldBlockLatencySamples : 0)` (shift term 64), written at
FINISH from `m_looperShiftHeldDuringTake` (latched at ARM off `monitorFold > 0.5`). A take must be anchored
by the WHOLE round trip -- capture queue + playback queue + USB transfer -- or every take comes back late.
`latency_trim_samples` in `[audio]` covers the part ALSA cannot report (USB packetisation). `pollHolds`
rewrites `latencybias` on every looper with content whenever the measurement moves, so already-recorded
takes are corrected too; unmeasured falls back to `kBlockSize`. `verify-lineup.js` reads the live bias from
telemetry, never a literal 64.

---

# Faust DSP

## Language gotchas

- **`&` binds tighter than `>`/`<`** -- unparenthesised comparisons are silently always true.
- `par()`-replicated UI controls silently duplicate -- `button()`/`hslider()` inside a `par()`-instantiated
  function RE-ELABORATES per call site even hoisted; thread as a plain signal input.
- No runtime branching -- `select2`/`ba.if` choose among ALREADY-COMPUTED signals. Hence Guitar/LofiFx are
  a permanent Core-3 LV2 bundle and cost is FLAT in held voices.
- Direct call syntax substitutes whole expressions, not buses -- `f(loop(...), a, b)` binds the ENTIRE
  `loop(...)` output to the FIRST parameter.

## Compiler flags -- currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at target-compile
steps only; `-O3`, no `-Ofast`/`-march=native`/fast-math. **Not shipped**: `-mapp` (real-aarch64 SIGSEGV),
`-fm def` (unresolvable `fast_*`), `ba.tabulate` (not bit-exact), per-effect LV2 splitting, `-omp`/`-sch`
(fights `pthread_setaffinity_np` pinning), `-mcd`/`-dlt`, `-clang`, `-mem`, `-vs 16` (SIGALRMs ~2 min into
`dsp/aloop_pre.dsp`).

`effects/home/faust/chain.dsp` looks dead but is not -- `build-lv2.yml` copies it into the homestack, so
deleting it breaks the LV2 build.

**Buffer sizes**: `delay.dsp`/`delayverb.dsp` `MAXD=52000`; `microrepeat.dsp` `MR_MAX=36000`;
`bitcrush.dsp` `BITS_MAX=24` not 16 (S32_LE never round-trips int16); `flanger.dsp` `MAXD=4096`/
`flutter.dsp` `MAXD=1024` -- at their ceiling, do NOT shrink either. `SLEW=0.0001` slew must carry NO
additive drift term.

## `multitranspose.dsp` -- polyphonic pitch-LOCK, 6 voices

`NVOICES=6` absolute-pitch-lock, additive with the mono SNAC engine below; each voice owns its own
`EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep whose step MUST stay block-aligned
(`m_sinceBlock==0`). `minTrackHz=60.0` floors `freqDet`. `engaged` is held by a linear release counter
`engageReleaseHoldS=0.06` -- never gate on `gate>0.5` or `voiceEnv>0`. Summed bus: fixed 0.6 gain + static
`ma.tanh`, never dynamic `1/sqrt(activeVoices)`. Formant (CC53, deadzone 60-68) via `LpcFormantShifter`
(`vowelFormant.h`, `kOrder=44`, `kHpPole=0.5925`, `kAnalysisHop=2048`, `kOctavesMax=3.0`); `beginBlock(n)`
runs the reflection glide + `reflectionToDirect` once per `kCoeffUpdateHopSamples=64` elapsed samples
regardless of caller block size -- a wrong `n` quadruples cost. The LPC
path is live on BOTH mono and poly; only the legacy grain shifter's `setFormantDepth()` is mono-only
(`pitch_ffi.h`).

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s `dubfx_pitch_tick` `ffunction`): SNAC tracker +
solad delay-line PSOLA shifter + formant grain stage. `DL=32768` (131072 corrupts the Pi's 32-bit-pointer
build), `MIN_PERIOD=48`, `DUBFX_BS=64` (poly 16), a permanent ~1.333 ms latency while engaged.
`m_xfadeLen` is DIVIDED by the pitch ratio (clamped >=1.0) -- undivided, readers drift apart. Splice knobs
at measured optima: `m_respliceFrac` 1.0, `SINC_TAPS` 16, `m_transientHold` 2
periods, slope weight 80.0, crossfade 1.0 period. **Open bug**: SNAC drift on tremolo/AM content
(`detectPitchStep()`'s anti-jitter clamp walks to a wrong subharmonic).

## `pitchtracker.lv2`/DawDreamer

`pitchtracker_ac.dsp` -- own bundle, `Lv2Host pitchTrackerFx` (`/effects/pitchtracker`), deploys to
`/effects/pitchtracker/pitchtracker.lv2/`; normalized autocorrelation, local-maximum peak selection.
DawDreamer's `FaustProcessor` refuses `ffunction` externs, so `verify_highoctave_transient.py` is
unconditionally red, not a gate to triage.

---

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*` (`kNoFeatures[] = {nullptr}`), never
a bare `nullptr` -- Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in
the sigsetjmp watchdog `runOne()` uses; a faulting plugin is disabled and the host continues. `readTtl()`
must strip trailing slashes from the bundle path (lilv's resolved path has one, `bundlePath` never does --
else the watchdog is off). `setControl` matches Faust's MANGLED port symbol (`fx2/FLANGEAMT` ->
`fx2_FLANGEAMT_3`).

## Resonode: separate, conditionally-called LV2 bundle

`resonode_synth.dsp` pulled off the always-on Faust graph into `resonode.lv2` (`Lv2Host resonodeFx`,
`/effects/resonode`); called only when `fx/resonode/engaged`. Per-voice `note`/`gate`/`vel` are LV2 ports
from `ApcGrid`'s MIDI handlers. `resonodeIn` is ZEROED when engaged with no plugins loaded; output
re-enters the crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING never layering
the original. `RESONODE_ENGAGED` is written directly via `fui.set()` in the worker loop, bypassing
`targetToZone` -- two consumers, audit both. NaN/Inf guard after `resonodeFx.process()` zeroes the block,
rate-limited `[diag-resonode]` log.

`modeCount=16` (16-of-24 -- 24 hits a real `faust` compile-time SIGALRM ceiling), 4 voices,
physically-modeled, excited ONLY by live mic (held key + silence = silence); the SHARED exciter is
broadband highpass(60Hz)+lowpass(tone), each mode's own filter does frequency selection -- never a
per-voice bandpass. `couple` (knob7) is nearest-neighbor `letrec` skew-symmetric energy exchange,
`coupleSmallGainMax=0.45`, clamp `coupleGuardCeil=8.0` (tanh rejected -- never exactly identity). Fixed
constants: `positionDriftEnv` ~350ms, `stretchJitterAmt=0.02`, `bassBoostAmt` 0.35 (<220Hz). Sweetspot
patches `kResonodePatches` (knobs1-4 = pos/decay/damp/stretch then collision); knobs 5-7 are
`fx/resonode/{tone,level,couple}`.

## delayverb: separate, conditionally-called LV2 bundle

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves; `.process()` only when
`delayVerbActive`. **Two separate instances** (`delayVerbFxCue` + `delayVerbFxMaster`) -- sharing one
corrupted its feedback state; `delayVerbActive` requires BOTH `hasPlugins()`.
`cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never `cc70`/`cc71` (APC Key25 sends NOTES 70/71
ch0). `0x5B` -> `cmd/clearall` is owned ONLY by `midi.cpp`; a second `controls.conf` binding races
`ApcGrid`'s shadow reset. **Tracktion Engine is REJECTED** -- do not re-open.

---

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`midi.cpp`): APC Key25 pads/buttons are **channel 0**, the keybed and sustain CC64
**channel 1** -- keybed notes on ch0 do nothing. SHIFT is `kApcBtnShift=0x62` (note 98) ch0; sustain is
CC64 (`d2>=64`), latching `m_sustainLatched`. **A live capture is not representative until SHIFT and
latch-sustain are both sent** (`raw 90 62 7f` then `raw B0 40 7F`, >=0.3s apart) -- without the latch
monitored output is ~10x quieter.

Every momentary Faust gate must be explicitly released or it sticks at 1 forever: `looperN/erase`
(`pollHolds` releases after ~50ms), `looperN/finishreq`, `cmd/clearall`. Every abandon path
(`applyRecPlayCycle`'s `rawSamples<=0` abort, `pollHolds`'s hold-erase loop, `onClearAll`) must ALSO pulse
`finishreq=1` with `finishtarget` = real telemetry `widx`, or `pend` stays latched; both written BEFORE
`rec=0` (`rec` is persistent `ParamStore` state -- set `rec=0` on FINISH or it re-records forever). ARM on
PRESS, FINISH on a **second PRESS**; a further press during a far-extend wait is a NO-OP -- abort is
hold-to-erase only. `kLooperCount=20`; `looperN/hascontent` is the real content slot (Faust's `wrapLen`
clamps to min 1). Guitar-fx held REDIRECTS looper pads to `onSidechainLooperToggle`.

## Content phase-anchor

Playback anchors to a shared `masterPhase` grid, never a per-take offset.

**ARM records from the press and anchors at the NEAREST fine-grid node.** `kFineGridBeats=0.125` beat; at
`armEdge` `rsmNext = rsmNearestNode` (circular correction <= half a cell, no forward-only bias) and
recording starts on the press itself, so the take keeps its attack and the only displacement left is the
player's own press error. Gates: `verify_phase_anchor.py` presses each HALF of a cell and asserts both
halves jitter-free and one grid step apart; `verify-lineup.js` arms several loopers in ONE MIDI burst and
asserts one shared anchor.

**Per-loop beat scale `s`**: latched `1/speedClamped` at `finishEdge`, reset to `1.0` at `armEdge`
(`beatLenNow = oneBeat/speedClamped` once `masterLen>=0.5`, `cycleInc = sNext*masterLen`) -- a take plays
at the speed it was PERFORMED at. Must be a BEAT-LENGTH ratio, never `wlen/masterLen`, since
near-cut/far-extend can EXTEND a take (5->8 beats).

**Quantize in master-grid BEATS, not drifted-tempo samples**: divide the raw write index by `tempoScale`
(`recordedBpm/curBpm`), drop the division from the finish target, assert read heads against the ABSOLUTE
grid beat captured at arm, not `rsm`.

**FINISH length is near-cut/far-extend** (`pickAnchorGridBeats`: 16/8/4/2/1/0.5/0.25/0.125, eps 0.01),
CAPPED at one master phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`, because
the 16-beat tier far-extended a ~17-beat take to 32. Overshoot past the last passed grid node within
`cutTolerance = max(1 beat, min(anchor/2, takeLen/8))` cuts to it immediately (no padding, no further
recording), else extends to the next tier. Ceiling `kMaxLoopSamples` (48000*60). `dsp/loop.dsp` clamps its
own anchor with `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))` so a
phrase-multiple target passes through untouched and a varispeed-shifted `beatLenNow` cannot re-snap 16
beats to 32.

**The first (master-establishing) take OWNS the tempo.** `master_len` stays the raw write index and
`deriveTempoQuant(seconds, anchor)` picks a power-of-2 beat count {1..128} whose bpm is log-closest to
`anchor` (the synced Link tempo with peers, else 120) inside `anchor/2..anchor*2` -- a 1.5 s take beside a
157.2 bpm peer solves to 4 beats at 160.2, not 2 beats at 80. `cmd/recorded_bpm`/`cmd/recorded_beats`
follow, and `LinkBridge::imposeTempo()` pushes that bpm onto the session, landing `effSpeed` on exactly
`1.0000` (natural pitch, exact repeat) with peers present. Adopting the peer tempo instead TRUNCATED the take: 2.0 s at 157.2 bpm came back 1.53 s / 4
beats. Gate: `tools/loop-quantization-sim/first-loop-tempo-owner.js` (repeat period == performed length,
`eff_speed` 1.0000, session bpm == `recorded_bpm`). Hardware proof: `test/hardware/verify-first-loop-owner.js`
(one take with a peer up, then `link.bpm` == the derived tempo, `eff_speed` 1.0000, repeat count over 10 s
== `masterLen`, read head holds grid lock within 48 samples, no peer re-asserts its old tempo).

## Varispeed punch is BAKED into the take

`cmd/halfspeed`/`cmd/doublespeed` drive `g_manualSpeedMul` (0.5/1/2); `effSpeed = g_manualSpeedMul *
(linkSpeedRatio + linkPhaseTrim)`. `dsp/loop.dsp` takes a 9th input `manualSpeed` = `g_manualSpeedMul`
(block-constant `manualSpeedBuf`) to separate the punch from the Link ratio:
`manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = effSpeed / manualSafe`. Every beat length uses
`ratioClamped`, never `speedClamped` (`beatLenNow`, `sNext`) -- the punch must not scale the grid, or the
C++ `finishtarget` (no manual term) stops matching the DSP's `snappedWrapLen` and a take doubles. Each take
latches its own `v` = `manualSafe` at `finishEdge` (1.0 at `armEdge`); `vBaked = v != 1.0`,
`speedForTake = v / manualSafe`, read head advances `speedClamped * sNext * speedForTake` =
`v * ratioNow / ratioRec`. A take finished at 0.5x plays 0.5x while held AND stays 0.5x after release -- a
baked take ignores later punches. Gates: `tools/loop-quantization-sim/varispeed-record.js`,
`test/hardware/varispeed-record.js`.

## Granulator -- note 69 SHIFT-disambiguates (`src/dsp/sampler/sampler.h`)

Both fire on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap toggles Resonode engage (always
wins, forces granulator off; disengage releases held voices). Resonode-engaged keybed drives 4 voices via
`Lv2Host::setControl` to `fx/resonodevoice{v}/{note,gate,vel}`. The granulator itself is C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/`posJitterMs`/`scanRate`/
`reverseProb`/`envShape`), `MAX_GRAINS=48` across `VOICES=16`, budgeted PER VOICE. `scanRate=0` freezes;
negative `rate` reverses. Direct dials (knobs 5-7) override the patch-blended field once touched
(`m_lofiFxKnobTouched`); `kGranPatchCount` is 4.

## Three-page x regular/shift x 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching 8-knob banks via `ApcGrid::onFxKnobCC`.
`kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 = Formant on Dub):

| Page | Regular | Shift |
|---|---|---|
| Dub | `fx/{reverb,delay,time,hp,lpres,lp,pitch}`, CC53=Formant | `fx/dubgate/*`+`fx/dublfo/*`, 4-beat clock |
| Guitar | `fx2/{FLANGE,TREMOLO,BANKSPEED,PHASER,DIST,VINYL,FLUTTER}AMT`, CC53=`fx2/GATEAMT` | 8-dial dual-ADSR to `Sampler` |
| LofiFx | `fx2/BITCRUSHAMT` + 4 patch weights | direct dials (knobs 5-7) |

Groove shuffle: `kBeatPadNotes={15,23,31,39}` double as shuffle buttons, `fx/shuffle/mask` (4-bit),
block-boundary only. `dsp/loop.dsp` varispeed has NO deadzone (`varispeedActive=(effSpeed!=1.0)|vBaked`
exact); `resyncCoeff` gates to `0.0` on `manualPunchActive|vBaked`; varispeed's instant jump and shuffle's
hard clip are INTENTIONAL -- do not smooth either. Loop ring reads use Catmull-Rom cubic; taps wrap at
`wrapLen`, not `MAXLEN`.

---

# Storage: USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`: RT side keeps a fixed heap `int16_t` ring (5 s) fed by
`pushBlock(prevFiltOut.data(), N)`; the 5 Hz control loop does file I/O in `poll()`, chunks fixed-size,
cyclically `O_TRUNC`-reopened. `[storage]` in `config/aloop.conf`: `usb_record`, `usb_mount_point`,
`usb_chunk_minutes` (10), `usb_chunk_count` (6). Clip export (note 93) keys off `m_looperHasContent`, not
`wrapLen`. UNVERIFIED on hardware.
