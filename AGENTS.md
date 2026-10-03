# aloop — technical constraints reference

Real Pi 4 `192.168.137.100`, root/aloop; real Pi 3B+ netboots from the host.
Current-state-only; the "why" lives in auto-memory behind `[[memory: ...]]`.

---

# Working rules

**No comments in code, ever** (C++, `.dsp`, JS, shell, YAML, config). A name or function
boundary IS the explanation; rationale belongs here or in memory. A comment found anywhere
becomes self-explanatory code the same turn (one sighting spawns a sweep of that file);
never trust an in-repo comment as ground truth. `[[memory: comment-sweep-exemptions]]`

**Never add audio-path latency** — the ~7ms block latency must never grow, even
temporarily; stop and ask first. A wet effect's own engaged-only algorithmic latency
(`ef.transpose`, SNAC) is exempt.

**Test on real hardware, never ask the user to reproduce input** — byte-level MIDI
injection (`tcp/9401`, `test/hardware/midi-inject.js`) or SSH state inspection.

**Compiling clean proves nothing about runtime safety** — x86_64 A/B passed while real
aarch64 codegen SIGSEGV'd (`-mapp`). `[[memory: faust-verification-discipline]]`

**Diagnostic logs carry wall-clock timestamps** — `CLOCK_MONOTONIC` as `t=<sec>.<ms>`.

**WebSearch hardware mechanics before irreversible real steps** (OTP burn, firmware write).
**SSH: a JS `ssh2` client, never Windows `ssh.exe`/`sshpass`** — a fresh netboot makes a
new host key every boot. `[[memory: windows-host-constraints]]`

**Before accepting any `.dsp` optimization, regenerate real C++ and diff byte-for-byte** —
identical output means a no-op.

**Faust compile-time cliff**: a NEW UI primitive in `resonode_synth.dsp`/
`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded real compile time
(`modeCount=24` dies by SIGALRM ~2min into `-i -a lv2.cpp`); a DawDreamer JIT success
proves nothing. Declare new controls in `effects_runtime.dsp` and thread them in as plain
signal arguments.

---

# Boards, images, boot trees

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`: `pi3`/`pi4`/`pi5`/`opi-prime`,
default `pi4`). `boot_tree_apkovl` (binary, LV2, services, vendored libs) is shared; only
`boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config` (cmdline/USB-gadget)
dispatch per board. `board_supports_usb_gadget`/`board_wifi_irq_name`/
`board_firmware_names` are authoritative, not this table:

| Board | SoC | Boot chain | USB-audio gadget |
|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711 A72 | Pi firmware, FAT | dwc2 UAC2 |
| pi3 | BCM2837 A53 | Pi firmware, FAT | none — no OTG |
| pi5 | BCM2712 A76 | Pi firmware, FAT | none — RP1 host-only |
| opi-prime | Allwinner H5 A53 | Armbian U-Boot (raw sectors) + ext4 | unproven |

Pi 3B+/CM3+ ship netboot-enabled from factory — no OTP burn (only plain 3B/CM3/3A+ need the
irreversible one). ROM order SD → USB → Network, so "prep for netboot" = wipe the card so
no `bootcode.bin` remains; such a card falls through to network, so a live netboot server
silently takes it over — always confirm which path booted.

opi-prime: USB-audio-gadget **UNPROVEN** (MUSB micro-USB OTG only; the 3 USB-A ports are
host-only) — fallback is the 3.5mm codec as ALSA HOST. The blob is everything before
partition 1's real start (`sfdisk`). `boot_tree_fetch_opi` must
use Armbian's stable redirect `dl.armbian.com/orangepiprime/Trixie_current_minimal`.
`[[memory: opi-prime-boot-history]]`

## apkovl assembly constraints

- `boot_tree_apkovl` MUST stamp `.default_boot_services` or `/lib/modules`, `/proc/asound`
  and `usb_gadget/` never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"` in the service file, not
  `local.d`; `depend()` needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never `apk add` at
  boot. alsa-lib also needs `vendor/share-alsa/` or `snd_pcm_open` segfaults.
  `hostapd`/`dnsmasq` need `libnl-3.so.200` **and** `libnl-genl-3.so.200`; `dnsmasq.conf`
  needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line (`tr '\n' ' '` + `tr -s ' '`);
  `core.autocrlf=true` corrupts scripts — fix via `rm` + `git checkout --`.
- New vendored files need both `tar --mode='+x'` lists; `find` building them must `cd` into
  the overlay dir first. Verify modes via `tar -tvzf` (LAST match).
  `[[memory: windows-host-constraints]]`

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.** Split
`faust2lv2`'s stages: `faust -i -a lv2.cpp` emits `.cpp`; `$HOST_CXX` compile+run emits
`.ttl`; only the final `-shared .so` link targets the device, cross-compiled in a real
Alpine aarch64 container. Verify `objdump -p foo.so | grep NEEDED` →
`libc.musl-aarch64.so.1`, never `libc.so.6`. `[[memory: windows-host-constraints]]`

**`upload-artifact@v4` `path:`**: a literal path flattens the dir's CONTENTS at the zip
root, dropping the `.lv2/` wrapper — always use a wildcard.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes the worker skip
`homeFx.process()`/`userFx.process()` entirely — fully silent, survives `rc-service aloop
restart`. Grep it before debugging silence as a code bug.

**Build traps**: the loop engine is built in TWO halves around `delayverb.lv2`; both halves
must update `audio_thread.cpp`'s includes in the SAME commit or CI ships an engine-less
binary. `instrument_device_match` exists because the APC Key25's own USB audio interface
won the enumeration race and took card 0, starving the instrument path.
`[[memory: build-graph-shape]]`

---

# Deploy, netboot, CI

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process** (`config/aloop.conf`
`[remote] token=`, `udp/4446`, `remote_control.cpp`; client `image/aloop-reboot.js`);
If `aloop` crashed, nothing listens
— OpenRC's `respawn_max=0` means it will not come back alone; SSH `reboot` is the fallback.
Verify before trusting device state: `/proc/uptime` and `md5sum /opt/aloop/aloop` vs
deployed, BEFORE reading logs. `[[memory: deploy-two-paths-lv2]]`

**Netboot self-update, two paths.** Automatic: `image/serve-netboot-win.js` polls
`build-binary.yml`/`build-lv2.yml` green `main` every 30s (blind to `image/**`); needs an
elevated shell. Manual: `ALOOP_BIN=<path> LV2_DIR=<path> RESONODE_LV2_DIR=<path>
PITCHTRACKER_LV2_DIR=<path> DELAYVERB_LV2_DIR=<path> OUT=.netboot-serve
NETBOOT_SERVER=192.168.137.1 bash image/build-netboot.sh` — all four `*_LV2_DIR` vars
**mandatory**; the apkovl must list delayverb, guitar_lofi_fx, pitchtracker, resonode. A new
bundle needs wiring into BOTH `build-image.yml` AND `serve-netboot-win.js` — neither reads
the other's list.

Netboot facts: publish is a staged-directory atomic `mv` (staging dir a SIBLING of the live
serve dir). `SERVER_IP` is baked into the netboot root's `cmdline.txt` ONCE — restarting the
server does not rewrite it; rebuild with `NETBOOT_SERVER` and power-cycle. **If TFTP succeeds and ZERO HTTP requests land,
the boot is hung until power-cycled** (diskless init does NOT retry the modloop/apkovl
fetch). `[[memory: netboot-dhcp-diagnosis-history]]`

Fast DSP iteration: `node image/dsp-hotdeploy.js --target home|guitar|both` (stops the
service first).

**CI**: native `ubuntu-24.04-arm` runners (no QEMU); Docker steps split with per-command
`timeout`. `build-image.yml` downloads BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2` from the
SAME green run; `home-fx-lv2`'s bundle is `aloop.lv2`, which `lib-boot-tree.sh` filters back
out. Rolling `latest` hard-gates on a real bundled binary (`payload_check`), stricter than
`validate-image.sh`. Artifacts need `retention-days: 3`. `get_parameters_description()`
returns params in ALPHABETICAL order, not declaration order — a harness binds the wrong
control silently. `[[memory: ci-build-pipeline-history]]`

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc single-AP mesh for
Link's multicast peer discovery (`224.76.78.75:20808`, hardcoded in the Link library).

| Invariant | aloop | esp-idf-link |
|---|---|---|
| Mesh SSID | `hostapd.conf`/`wpa_supplicant.conf` `ssid=ticker` | `wifi_scan_best_bssid`/`wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `hostapd.conf` `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |
| Transport | CLOCK-ONLY — `enableStartStopSync(false)`; never calls `setIsPlaying` | CLOCK-ONLY — no transport is shared either way |

Host election is MAC-ordered — never "host if scan found nothing". `src/net/autoap.sh`:
hosts `ticker` never `aloop`; needs at least one active `network={}` block before
`start_ap()` does anything; `start_ap()` clears previous hostapd not just wpa_supplicant
(stale → `Could not set channel`, a red herring — ch6 is paired).
`[[memory: mesh-link-midi-history]]`

## Ableton Link checklist and varispeed/transport-anchor

- `commitAppSessionState()` off-audio-thread, `commitAudioSessionState()` audio-thread only;
  the audio thread gets a lock-free double-buffered `LinkSnapshot` (ADR-005) stamped
  `CLOCK_MONOTONIC` and extrapolated forward at the session tempo (5 Hz ticks ⇒ up to ~0.4
  beat stale).
- `setTempo` rewrites EVERY peer; `proposeTempo` refuses when peers present and is the ONLY
  user of `weOwnTempo` — never gate `linkSpeedRatio` on it.
- Playback matches tempo by scaling read RATE (`linkSpeedRatio=linkBpm/recordedBpm` →
  `effSpeed`), never a position jump.
- **Link is CLOCK-ONLY: tempo+phase shared, transport never.** `enableStartStopSync(false)`, so
  pausing locally leaves every peer playing and no peer can start/stop us. `isPlaying` is now a
  LOCAL flag (`setLocalTransportPlaying`, driven by `ApcGrid::updateLocalTransport`) that only
  feeds `midi_clock.cpp`'s 0xFA/0xFC — never set it from peer state.
- Readiness needs `depend(){ after local autoap; }` plus `waitForNetworkInterface()`.
- Residual phase error is a bounded speed trim on `effSpeed` **AND on the
  `masterPhaseSamples` advance** (`kLinkPhaseTrimPerSample=0.00005`, clamp
  `kLinkPhaseTrimMax=0.03`, suspended while `abs(g_manualSpeedMul-1.0)>0.3`).
  `masterPhaseBuf` ramps at `masterPhaseSlope = linkSpeedRatio+linkPhaseTrim`.
- The trim runs only while `linkVarispeedEngaged`, or it saturates into a permanent 51-cent
  detune: `eff_speed` in `/run/aloop/status.json` must read exactly `1.0000` with no loop
  recorded.
- At 0.03 the trim needs ~8s to close a half-beat, so the first usable target after Link
  starts driving SNAPS the anchor when the circular error exceeds `kJoinSnapErrBeats=0.25`
  beats; that threshold also stops a flapping peer count from snapping (`join-late.js`).

**Two quantums — 16 for transport, 128 for phase CAPTURE.** `kLinkQuantum=16.0` is the
PAIRED value (transport anchor, `beatNow()`, 24-PPQN clock). `controlTick()` captures phase
at `kLinkPhaseQuantumBeats=128.0` and publishes `quantumMicroBeats`; consumers must fold with
`(quantumMicroBeats/1e6)`, never `16.0` — `linkTargetSamples`/`gridBeatIndex`.

The idle/creation snap (`!anyAudible || masterJustCreated || creationSnapPending`) fires
IMMEDIATELY at creation and waits for a snapshot stamped AFTER the master was created. The
beat count is the FOLD BASIS for the Link phase: while `cmd/recorded_beats` is unknown there
is NO Link target. `applyRecPlayCycle` publishes bpm/beats BEFORE `master_len` because the audio thread
preempts between writes. Recording a master snaps `masterLenSamples` to whole beats at the
Link tempo and routes through `finishTargetPending` like every sub-loop finish.
`[[memory: control-surface-quantization-history]]`

## MIDI clock fan-out

`midi_clock.cpp`: 24 PPQN `0xF8`+`0xFA`/`0xFC` to every MIDI output except the control
surface. No `/dev/snd/seq` — walks `/proc/asound/card*/midi*`, rescans every 2s, ticks off
`LinkBridge::beatNow()`, catch-up bounded to `kMaxCatchUpPulses=4.0`. The surface is excluded
by **USB id** (`09e8:0027`, APC Key 25): `src/control/midi.cpp`'s scan runs a first pass
accepting only that id, then the enumeration-order fallback. The clock skips EVERY card
matching that id, not merely the one opened, and waits `kSurfaceGraceSeconds=15.0` for
`controlSurfaceCard()`. `[[memory: mesh-link-midi-history]]` `pinLinkThreadsToControlCore`
pins Link's threads to `kControlCore=2`; `[link] enabled = true` parses as a word, not `%d`.

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate: **instrument**
(default `hw:0,0`) tight-latency capture+playback, blocking; **OTG gadget** (`f_uac2`)
best-effort MIRROR, NONBLOCK (`-EAGAIN` expected) — and the mirror carries MASTER on all
channels, never cue. Instrument **S32_LE only** — buffer `int32_t`, divisor `2147483648.0f`;
skip the OTG S16 conversion when the gadget is not connected. Playback needs
`start_threshold` lowered to one period. **4 periods min**. `f_uac2-gadget.sh`: `req_number`
must be **4**, not default 2. Gadget is STEREO — L/R averaged to mono for Faust. `main.cpp`
declares `AudioThread` BEFORE `audio.start()` — safe only because `snapshotTelemetry()`
returns all-zero pre-`start()`. Flush-to-zero set explicitly. `AloopLoopDsp`/`Sampler` must
be `std::make_unique`'d at thread startup, never stack-local.

**Resolve string-keyed lookups ONCE, never per block** — control WRITE and telemetry READ
cache `(ParamStore slot, Faust zone float*)` pairs at startup; no per-sample modulo in hot
paths. `FaustUI`'s bargraph adders must do `zones[full(l)]=z` or `hbargraph()` falls through
to an O(n) scan. `targetToZone()` needs a case for every control target — a missing case
returns `""`, silent. `masterPhaseBuf` must ramp per-sample, never `std::fill()` with a
block-constant value. Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`;
Sampler `captureBlock` reads the same `prevFiltOut`, never `fin`.

**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*combinedFold` when engaged,
ramping `foldGain` at `kFoldStepPerSample` = `(1/16)/N` — adds one block of recording lag;
`latencyBias` = 64 device samples, **128 with SHIFT held** (`kShiftFoldBlockLatencySamples`)
written at FINISH if `m_looperShiftHeldDuringTake[looper]` was ever set, else 0. Two consumers
differ and must not be conflated: the Faust `MONITORFOLD` zone gets the ramped `foldGain`,
while `freeXposeBuf` (free-transpose engage) is the RAW `monitorFoldVal > 0.5` threshold.

---

# Faust DSP

## Language gotchas

- **`&` binds tighter than `>`/`<`** — unparenthesised comparisons are silently always true
  (the `extFreqDet` gate was dead since `c3698de` for exactly this).
- `par()`-replicated UI controls silently duplicate — `button()`/`hslider()` inside a
  `par()`-instantiated function RE-ELABORATES per call site even hoisted (verify via generated
  C++, `grep -c '"name"'` must be 1); fix by threading as a plain signal input.
- No runtime branching — `select2`/`ba.if` choose among ALREADY-COMPUTED signals (why
  Guitar/LofiFx are a permanent Core-3 LV2 bundle).
- Direct function-call syntax substitutes whole expressions, not buses — `f(loop(...), a, b)`
  binds the ENTIRE `loop(...)` output to the FIRST parameter.
- `ef.transpose` has a HARDCODED `maxDelay=65536`.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation; `-mcpu=cortex-a72` at
target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/fast-math. **Not shipped**:
`-mapp` (real-aarch64 SIGSEGV), `-fm def` (unresolvable `fast_*`), `ba.tabulate` (not
bit-exact), per-effect LV2 splitting (more `instantiate()`/`process()` boundaries),
`-omp`/`-sch` (fights `pthread_setaffinity_np` pinning), `-mcd`/`-dlt`, `-clang`, `-mem`,
`-vs 16` (SIGALRMs ~2min into `dsp/aloop_pre.dsp`). `[[memory: faust-verification-discipline]]`

`effects/home/faust/chain.dsp` looks dead but is not — `build-lv2.yml` copies it into the
homestack, so deleting it breaks the LV2 build.

**Buffer sizes**: `delay.dsp`/`delayverb.dsp` `MAXD=52000`; `microrepeat.dsp` `MR_MAX=36000`;
`bitcrush.dsp` `BITS_MAX=24` not 16 (S32_LE never round-trips int16); `flanger.dsp`
`MAXD=4096`/`flutter.dsp` `MAXD=1024` — at their ceiling, do NOT shrink either. `SLEW=0.0001`
slew must carry NO additive drift term. `effects_runtime.dsp`'s filter/delay/reverb/pitch
stages have NO parameter smoothing upstream of `pow()`/`exp()`.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices

NVOICES=6 absolute-pitch-lock, additive with the mono SNAC engine below; each voice owns its
own `EngineSoladSnac`, sharing one `snacPeriodTracker.h` sweep whose step MUST stay
block-aligned (`m_sinceBlock==0`). `minTrackHz=60.0` floors `freqDet`; `trackingAllowed =
trustedTracker > 0.5` only; `heldDetNote` reseeds every attack until `everTrusted` latches.
`engaged` is held by a linear release counter `engageReleaseHoldS=0.06` — never gate on
`gate>0.5` or `voiceEnv>0`. Summed bus: fixed 0.6 gain + static `ma.tanh`, never dynamic
`1/sqrt(activeVoices)`. `[[memory: multitranspose-investigation-history]]`

Formant (CC53, deadzone 60-68) via `LpcFormantShifter` (`vowelFormant.h`, `kOrder=44` @48kHz,
`kHpPole=0.5925`). `beginBlock()` must run its reflection glide + `reflectionToDirect` once
per **64 elapsed samples**, independent of caller block size, or cost quadruples and
coefficients jump audibly. **The grain formant path is INERT on the poly path** —
`pitch_poly_ffi.h` never calls `setFormantDepth()`; live on MONO via `pitch_ffi.h`.
`[[memory: lpc-formant-shifter-history]]`

**Reduced, not eliminated**: the ≥+18-semitone upshift click — its splice cooldown is
rate-derived (`spliceCooldownSamples()`).

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s `dubfx_pitch_tick` `ffunction`,
ADR-004): SNAC tracker + solad delay-line PSOLA shifter + formant grain stage. `DL=32768`
(131072 corrupts the Pi's 32-bit-pointer build), `MIN_PERIOD=48`, `DUBFX_BS=64`, a permanent
~1.333ms latency while engaged. `m_xfadeLen` is DIVIDED by the pitch ratio (clamped ≥1.0) —
undivided, readers drift apart during the fade. Splice knobs are at measured optima — do not
re-tune blind: `m_respliceFrac` 1.0, `SINC_TAPS` 16, `m_transientHold` 2 periods, slope weight
80.0, crossfade 1.0 period. **Open bug**: SNAC drift on tremolo/AM content
(`detectPitchStep()`'s anti-jitter clamp walks to a wrong subharmonic).
`[[memory: free-transpose-engine-history]]`

## `pitchtracker.lv2`/DawDreamer

`effects/pitchtracker-src/pitchtracker_ac.dsp` — separate compilation unit, own LV2 bundle,
`Lv2Host pitchTrackerFx` (`/effects/pitchtracker`); normalized autocorrelation with
local-maximum peak selection and a `holdLastGood`/`energyReady` onset gate; must deploy to
`/effects/pitchtracker/pitchtracker.lv2/`. DawDreamer's `FaustProcessor` refuses `ffunction`
externs, so `verify_highoctave_transient.py` can NEVER pass — unconditionally red, not a gate
to triage. `[[memory: ci-build-pipeline-history]]`

---

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*`, never bare `nullptr`
— Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap `instantiate()`/`activate()` in the
sigsetjmp crash watchdog `runOne()` uses (ADR-002). `readTtl()` must strip trailing slashes
from the bundle path (lilv's resolved path has one, `bundlePath` never does — else the
watchdog is off). `setControl` matches Faust's MANGLED port symbol
(e.g. `fx2/FLANGEAMT`→`fx2_FLANGEAMT_3`).
`aloop.lv2` excluded from apkovl by name (ADR-003).

## Resonode: separate, conditionally-called LV2 bundle

`resonode_synth.dsp` pulled off the always-on Faust graph into `resonode.lv2` (`Lv2Host
resonodeFx`, `/effects/resonode`); called only when `fx/resonode/engaged`, but cost is FLAT in
held voices (Faust has no runtime branching). Per-voice `note`/`gate`/`vel` are LV2 ports from
`ApcGrid`'s MIDI handlers. `resonodeIn` is ZEROED when engaged with no plugins loaded; output
re-enters the crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`, REPLACING
never layering the original. `RESONODE_ENGAGED` is written directly via `fui.set()` in the
worker loop, bypassing `targetToZone` — two consumers, audit both. `ApcGrid::bindAll` must
`ps.bind()` every internal flag a C++ path `setByName`s. NaN/Inf guard after
`resonodeFx.process()` zeroes the block, rate-limited `[diag-resonode]` log.

`modeCount=16` (16-of-24 — 24 hits a real `faust` compile-time SIGALRM ceiling), 4 voices,
physically-modeled, excited ONLY by live mic (silent input, held key = silence); the SHARED
exciter is broadband highpass(60Hz)+lowpass(tone), each mode's own filter does frequency
selection — never a per-voice bandpass. `couple` (knob7) is nearest-neighbor `letrec`
skew-symmetric energy exchange, `coupleSmallGainMax=0.45`, clamp `coupleGuardCeil=8.0` (tanh
rejected — never exactly identity); a real linear loop through 2+ coupled modes can exceed
unity gain at some corners even with every pole damped. Internal constants with no knob:
`positionDriftEnv` ~350ms, `stretchJitterAmt=0.02`, `bassBoost` 1.35x <220Hz, `aliasGuard`
top-5%-Nyquist fade. Refuted: `pow` for `exp`, the Lorentzian coupling bound, cos recurrence,
un-glided morph knobs.
`[[memory: resonode-exciter-coupling-cpu-history]]`

Sweetspot patches (`kResonodePatches`, knobs1-4); knobs 5-7:
`fx/resonode/{tone,level,couple}`:

| Patch | position | decay | damping | stretch | collision | character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s, harmonic |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass |

## delayverb: separate, conditionally-called LV2 bundle

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves; `.process()` is called
only when `delayVerbActive`. **Two separate instances** (`delayVerbFxCue` +
`delayVerbFxMaster`) — sharing one corrupted its feedback state; `delayVerbActive` requires
BOTH `hasPlugins()`. `cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never
`cc70`/`cc71` (APC Key25 sends NOTES 70/71 ch0). `0x5B`→`cmd/clearall` is owned ONLY by
`midi.cpp`; a second `controls.conf` binding raced `ApcGrid`'s shadow reset (`b81fd17`).

**Tracktion Engine is REJECTED** — do not re-open without new evidence.
`[[memory: tracktion-engine-rejection]]`

---

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`src/control/midi.cpp`): APC Key25 pads/buttons are **channel 0**, the keybed
and **sustain CC64 are channel 1** — injecting keybed notes on ch0 produces no response.
SHIFT is `kApcBtnShift=0x62` (note 98) ch0; sustain is CC64 (`d2>=64`), latching
`m_sustainLatched`. **A live playthrough capture is not representative until SHIFT and
latch-sustain are both sent first** (`raw 90 62 7f` then `raw B0 40 7F`, ≥0.3s apart):
without the latch, monitored/captured output is ~10x quieter.

Every momentary Faust gate must be explicitly released or it sticks at 1 forever:
`looperN/erase` (`pollHolds` releases after ~50ms), `looperN/finishreq`, `cmd/clearall`. Every
abandon path (`applyRecPlayCycle`'s `rawSamples<=0` abort, `pollHolds`'s hold-erase loop,
`onClearAll`) must ALSO pulse `finishreq=1` with `finishtarget` set to the real telemetry
`widx`, or Faust's `pend` stays latched. `finishtarget`/`finishreq` must be written BEFORE
`rec=0` (real cross-thread race). `rec` is persistent `ParamStore` state — `applyRecPlayCycle`
sets `rec=0` on FINISH or it re-records forever. Per-looper cycle: empty → ARM(`rec=1`) →
FINISH(`rec=0`, `play=1`) → pause(`play=0`) → resume(`play=1`); ARM on PRESS and FINISH on a
**second PRESS**; a further press during a far-extend wait is a NO-OP — abort is hold-to-erase
only. `kLooperCount=20`; `looperN/hascontent` is the real content slot — Faust's `wrapLen` is
clamped to a minimum of 1.

`m_masterLenSamples`/`cmd/master_len`/`cmd/recorded_bpm` reset to 0 when the last looper with
content is erased — `anyHasContent` cross-checks `Telemetry::looperWrapLen` and self-heals the
shadow, skipping loopers with `m_looperWrapLenStaleAfterWipe` (only FINISH writes DSP
`wraplen`). Guitar-fx held REDIRECTS looper pad presses to
`onSidechainLooperToggle` while `m_guitarFxHeld`.

## Content phase-anchor

Playback anchors to a shared `masterPhase` grid, never a per-take offset.

**ARM snaps to the NEAREST fine-grid node.** `kFineGridBeats=0.125` beat; `fineGridWrapped` is
hoisted once in `loopEngine` like `masterPhaseWrapped`, and non-first-looper `armEdge` fires on
it. `armWaitSamples` measures press→node; over half a step `rsmNext` pulls back one
(`rsmNearestNode`) to the node nearest the press, so worst case is ±1/16 beat with no
forward-only bias. Gates: `test/phrase-anchor/verify_phase_anchor.py` presses inside each HALF
of a cell and asserts both halves are jitter-free and one grid step apart;
`test/hardware/verify-lineup.js` arms several loopers in ONE MIDI burst and asserts the read
heads share one anchor. Two offset-free hardware checks: recording `writeidx`−`readpos` is `−latencybias`, one cell back when pulled and 0
otherwise; playing `master_phase`−`readpos` is `rsm`−`latencybias`, a constant 64 samples
(`kBlockSize`) off a cell. Neither needs the Link→`masterPhase` offset.

**Per-loop beat scale `s`**: latched `1/speedClamped` at `finishEdge`, reset to `1.0` at
`armEdge` (`beatLenNow = oneBeat/speedClamped` once `masterLen>=0.5`, `cycleInc =
sNext*masterLen`) — a take plays at the speed it was PERFORMED at, not the current tempo. It
must be a BEAT-LENGTH ratio, never `wlen/masterLen`: near-cut/far-extend can EXTEND a take
(5→8 beats) and the raw ratio would double the playback speed.

**Quantize in master-grid BEATS, not drifted-tempo samples**: divide the raw write index by
`tempoScale`, drop the division from the finish target, and assert read heads against the
ABSOLUTE grid beat captured at arm, not `rsm`.

**FINISH length is near-cut/far-extend** (`pickAnchorGridBeats`; supersedes
`lowerExp`/`lowerCand`/`upperCand`), on a grid capped at ONE MASTER PHRASE: `anchorGridBeats =
min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot past the last
node ≤ `max(1 beat, min(anchor/2, takeLen/8))` cuts to it (no padding, no further recording),
else extends to the next node. The cap is what keeps a long take from doubling: uncapped, the
16-beat tier extends a 17-beat take to 32, and the cut tolerance must exceed the 5 Hz
control-tick slop (~0.8 beat: up to one stale telemetry tick plus one late MIDI tick) or the
same performance yields 16 or 32 depending on tick phase. Ceiling `kMaxLoopSamples` (48000*60).
`[[memory: control-surface-quantization-history]]`

`dsp/loop.dsp`'s own `snappedWrapLen` must stay IDEMPOTENT for a phrase-multiple target — its
anchor length is `min(anchorGridBeats*beatLenNow, masterLen)`, never the bare tier, so a
varispeed-shifted `beatLenNow` cannot re-snap 16 beats to 32.

First (master-establishing) recording takes its tempo/beats from a real synced Link tempo when
present — `recorded_beats` snapped to the nearest power-of-2 in {1,2,4,8,16,32,64,128}
(`snapBeatsToPow2`). `[[memory: loop-sim-verification-discipline]]`

## LofiFx/granulator button — SHIFT disambiguates (note 69)

Both fire on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap toggles Resonode engage
(always wins, forces granulator off; disengage releases every held voice). Resonode-engaged
keybed drives 4 voices via `Lv2Host::setControl` to `fx/resonodevoice{v}/{note,gate,vel}`
(skipped when disengaged). `[[memory: granulator-investigation-history]]`

## Granulator (`src/dsp/sampler/sampler.h`)

C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/`posJitterMs`/`scanRate`/
`reverseProb`/`envShape`), `MAX_GRAINS=48` shared across 16 voices. `scanRate=0` freezes; a
negative `rate` reverses. Direct dials (knobs 5-7) override the patch-blended field once touched
(`m_lofiFxKnobTouched`); `kGranPatchCount` is 4. Grain pool budgeted PER VOICE
(`MAX_GRAINS/voices`), never exhaustible. `kGrainTimingJitterAmt=0.15`.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching 8-knob banks via
`ApcGrid::onFxKnobCC`. `kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 doubles as Formant
on Dub):

| Page | Regular (knobs 1-7) | Shift |
|---|---|---|
| Dub | `fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant | dance-gate+LFO: `fx/dubgate/*`/`fx/dublfo/*`, off the shared 4-beat clock |
| Guitar | `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}`, CC53=`fx2/GATEAMT` | 8-dial dual-ADSR straight to C++ `Sampler` |
| LofiFx | knob0 `fx2/BITCRUSHAMT`, knobs1-4 patch weights | knobs5-7 direct dials |

Groove shuffle: `kBeatPadNotes={15,23,31,39}` double as shuffle buttons, `fx/shuffle/mask`
(4-bit) — retrigger/reorder, block-boundary only, own `shuffleClockSamples` atop the real
`masterPhaseSamples+i` ramp. `dsp/loop.dsp`
varispeed has NO deadzone (`varispeedActive=effSpeed!=1.0` exact); `resyncCoeff` gates to `0.0`
when `manualPunchActive`; varispeed's instant jump and beat-shuffle's hard clip are INTENTIONAL
— do not smooth either. `microrepeat.dsp`'s `sliceBlocks=max(1,int(beatBlocks/divSafe))*2`,
`divSafe=max(1,DIV)`. CC53 formant: `((data2-64)/63.0)*1.5`, deadzone 60-68 — SHIFT never
changes a knob's own behavior. Loop ring reads use Catmull-Rom cubic, not linear; taps wrap at
`wrapLen`, not `MAXLEN`.

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}` (unrelated to `src/usb/f_uac2-gadget.sh`).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring (5s);
`audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(), N)` every block.

**Control side**: file I/O happens in `UsbRecorder::poll()`, called from `main.cpp`'s 5 Hz
control loop. Chunks fixed-size, cyclically `O_TRUNC`-reopened. Config `[storage]` in
`config/aloop.conf` — `usb_record`, `usb_mount_point`, `usb_chunk_minutes` (10),
`usb_chunk_count` (6). Clip export (note 93, `src/storage/clip_exporter.cpp`) keys off
`m_looperHasContent`, not `wrapLen`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) + `usb-automount-setup.sh` (APPENDS
to `/etc/mdev.conf`). Mount order: no `-t`, then `ntfs3` (read-write; BEFORE the legacy
read-only `ntfs`), then vfat/ext4/exfat. UNVERIFIED on real hardware.
