# aloop — technical constraints reference

Durable constraints for this codebase and its build/deploy pipeline. Real
Pi 4 device `192.168.137.100`, root/aloop. Real Pi 3B+ debug device
reaches the host via netboot (`.netboot-serve-pi3/`, `[[memory:
project-pi3-netboot]]`). Read before touching the device, the DSP, or
the image/netboot scripts.

Lean, current-state-only reference: hardware facts, build/deploy
procedures, shipped architecture, working rules, open/disclosed bugs.
Long-form investigation history (rejected designs, session narration,
superseded measurements) lives in auto-memory
(`~/.claude/projects/<project>/memory/`); `[[memory: ...]]` pointers
carry the "why". Re-compacted whenever this file exceeds ~30KB
(`~/.claude/CLAUDE.md` invariant 3) — a value with no pointer owed no
narrative.

## Contents

- Boards, images, boot trees
- Device runtime environment (Alpine/musl/aarch64)
- Deploy, netboot, SSH
- Mesh networking (`ticker` AP, Ableton Link)
- Audio thread and ALSA
- Faust DSP: language gotchas, compiler flags, current architecture
- LV2 hosting
- Control surface (`apc_grid.cpp`)
- Storage (USB ring recording)
- Working rules

---

# Working rules

**No comments in code, ever.** No inline, block, or doc comments
anywhere (C++, Faust `.dsp`, JS, shell, YAML, config) — a
name/function-boundary/extracted-variable/small-type IS the
explanation. Design rationale belongs in THIS file or memory, never
inline (SSOT). A comment found anywhere is converted to self-explanatory
code the same turn (root-cause it, delete it); one sighting spawns a
full sweep of that file. `[[memory: no-comments-rule]]`.

**Never add audio-path latency.** The existing ~7ms block latency must
never grow, even temporarily or to work around an unrelated bug — stop
and ask first (one-way door). A wet effect's own engaged-only
algorithmic latency (`ef.transpose`'s window, the SNAC engine's latency)
is exempt — additive on top of an always-instant dry path.

**Never trust an in-repo comment as ground truth.** Comments here have
been confidently wrong about spec, performance, and numeric guarantees.
Read what the code does; for spec questions, ask the user for current
intent.

**Real hardware over asking the user to reproduce input.** Prefer
byte-level MIDI injection (`tcp/9401`, `src/control/midi.cpp`) or SSH
log/state inspection. Reserve `AskUserQuestion` for physical steps only
once a byte-level substitute is proven impossible for that bug class.

**Stay grounded in what this system is**: a real-time C++/Faust audio
looper on real ALSA hardware, a real Pi, real USB devices, real MIDI
gestures. Abstract "formal verification" framings do not apply — work
the concrete bug with static reading, real device logs, byte-level MIDI
injection, CI-verified builds, DawDreamer renders.

**Compiling clean proves nothing about runtime safety.** A synthetic
x86_64 A/B has passed while real aarch64 codegen SIGSEGV'd (`-mapp`); a
JIT `compile()` has reported success and crashed at `render()` (`-fm
def`); CI green only ever means "x86_64 compiled". Any
numeric-approximation or codegen flag needs a real-target, real-signal
test before shipping. `[[memory: faust-verification-discipline]]`,
`[[memory: faust-compile-time-cliff]]`.

**Diagnostic logs must carry wall-clock timestamps** —
`clock_gettime(CLOCK_MONOTONIC,...)` as `t=<sec>.<ms>` alongside the
magnitude, or periodic-vs-bursty is indistinguishable.

---

# Boards, images, boot trees

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`:
`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`). `boot_tree_apkovl`
(binary, LV2, services, vendored libs) is shared/unconditional; only
`boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config`
(cmdline/USB-gadget config) dispatch per board.
`board_supports_usb_gadget`/`board_wifi_irq_name`/`board_firmware_names`
in `lib-boot-tree.sh` are the authoritative capability source, not this
table:

| Board | SoC | Boot chain | USB-audio gadget | WiFi chip |
|---|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711, quad Cortex-A72 aarch64 | Pi firmware, FAT partition | dwc2 peripheral — real UAC2 gadget | Broadcom brcmfmac |
| pi3 | BCM2837, quad Cortex-A53 aarch64 | Pi firmware, FAT partition | none — no OTG-capable controller | Broadcom brcmfmac |
| pi5 | BCM2712, quad Cortex-A76 aarch64 | Pi firmware, FAT partition | none — RP1 southbridge USB is host-only | Broadcom brcmfmac |
| opi-prime | Allwinner H5, quad Cortex-A53 aarch64 | Armbian U-Boot (raw SD sectors) + ext4 root + extlinux.conf | unproven | Realtek RTL8723BS |

Pi 3B+ ships netboot ENABLED from the factory; ROM order SD → USB →
Network — "prep for netboot" means wiping the card. `[[memory:
project-pi3-netboot]]`, `[[memory: feedback-verify-before-irreversible-hw]]`.

## Orange Pi Prime specifics

Alpine aarch64 applies directly. USB-audio-gadget **UNPROVEN**: MUSB
dual-role controller is micro-USB OTG only, the 3 USB-A ports are
host-only — fallback is the built-in 3.5mm codec as ALSA HOST. Boot
chain incompatible with the Pi's FAT model — BootROM reads a raw
SPL/U-Boot image pre-partition-table. `boot_tree_fetch_opi`: Armbian
stable-redirect URL, real partition table via `sfdisk`, loop-mount ext4
root. `build-image.sh`'s opi-prime branch needs real root (Linux host
only). No netboot path (BootROM needs local U-Boot before PXE); skipped
in `build-image.yml`. `console=ttyS0,115200` verified;
`earlycon=uart8250,mmio32,0x01c28000` diagnostic. WiFi RTL8723BS —
`rt-tune.sh` IRQ-steering matches `rtl8723bs`. U-Boot load addresses and
full boot-chain rationale: `[[memory: opi-prime-boot-history]]`.

## apkovl assembly constraints

- `boot_tree_apkovl` must stamp `.default_boot_services` — Alpine's
  `rc_add modloop sysinit` gate needs it or `/lib/modules`/
  `/proc/asound`/`usb_gadget/` never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"`, not
  `local.d ulimit` (subshell doesn't reach `aloop`; `rc_ulimit` reads
  pre-exec). `depend()` needs `after local autoap` (opens Link's UDP
  socket at startup; waits for interface address).
- Vendor alsa-lib + lilv as real `.so`s (`vendor/lib-aarch64/`); never
  `apk add` at boot. alsa-lib needs `vendor/share-alsa/` (~340K) or
  `snd_pcm_open` segfaults.
- `hostapd`/`dnsmasq` vendored aarch64 (`vendor/sbin-aarch64/`, repo
  lacks them, `APKINDEX.tar.gz` can't regen on Windows). `hostapd`
  needs `libnl-3.so.200`/`libnl-genl-3.so.200`; `dnsmasq.conf` needs
  explicit `user=root`/`group=root`.
- `cmdline.txt`/`extlinux.conf` APPEND writes stay a single line
  (fw/U-Boot read only line 1); collapsed via `tr '\n' ' '` + `tr -s
  ' '`; validators count newlines.
- New vendored files need both `tar --mode='+x'` lists — NTFS has no
  exec bit, `chmod +x` no-ops on Windows. `[[memory:
  windows-host-constraints]]`.
- `find` calls building those lists must run inside the overlay dir —
  against cwd, `find` silently returns empty.
- `core.autocrlf=true` corrupts scripts here — `.gitattributes` forces
  `eol=lf`; fix via `rm` + `git checkout --`.

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.**
A `.so` built with host g++ dlopens with no discovery error, then fails
at load. Pattern: split `faust2lv2`'s stages — `faust -i -a lv2.cpp`
emits `.cpp`; `$HOST_CXX` compile+run emits `.ttl` (host-only); only
the final `-shared .so` link targets the device, cross-compiled in a
real Alpine aarch64 container. Verify: `objdump -p foo.so | grep
NEEDED` must show `libc.musl-aarch64.so.1`, never `libc.so.6`. Pass
`CPPFLAGS` into nested `docker run ... sh -c "..."` via `-e VAR="$VAR"`,
never string interpolation (escaped quotes lose their escapes across
the nested-shell boundary).

**`actions/upload-artifact@v4` `path:` wildcard-vs-literal.** Wildcard
preserves the matched directory's basename; literal flattens its
CONTENTS at the zip root, silently dropping the `.lv2/` wrapper. Always
use the wildcard form for LV2 bundle artifacts.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes
the worker skip `homeFx.process()`/`userFx.process()` entirely —
fully silent, survives any `rc-service aloop restart`. Always
`grep -n disable_core3_lv2 /etc/aloop.conf` before debugging "effects
don't do anything" as a code bug.

---

# Deploy, netboot, SSH

**SSH: use a JS `ssh2` client, never Windows ssh.exe or sshpass**
(`[[memory: windows-host-constraints]]`) — a fresh netboot generates a
new host key every boot, breaking raw `ssh`/known_hosts but not `ssh2`.

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process**
(`config/aloop.conf`'s `[remote] token=`, `udp/4446`,
`remote_control.cpp`). If `aloop` crashed, nothing listens and
`aloop-reboot.js` silently no-ops (OpenRC `respawn_max=0` won't restart
it) — use `node ssh-exec.js 192.168.137.100 "reboot"`. Verify a
reboot happened before trusting device state: `/proc/uptime` and
`md5sum /opt/aloop/aloop` vs deployed, BEFORE reading logs.

## Netboot self-update: two rebuild paths

- **Automatic**: `image/serve-netboot-win.js` (elevated,
  `GITHUB_TOKEN`/`PI_TOKEN`) polls `build-binary.yml`/`build-lv2.yml`'s
  green `main` every 30s, rebuilds on SHA change
  (`.netboot-update-sha`); blind to `image/**` packaging changes.
- **Manual**: `ALOOP_BIN=<path> LV2_DIR=<path> RESONODE_LV2_DIR=<path>
  PITCHTRACKER_LV2_DIR=<path> DELAYVERB_LV2_DIR=<path>
  OUT=.netboot-serve NETBOOT_SERVER=192.168.137.1 bash
  image/build-netboot.sh` — all three `*_LV2_DIR` vars **mandatory**.
  Verify via `tar -tzf .netboot-serve/aloop.apkovl.tar.gz | grep -oE
  'effects/[a-z]+/[a-z_]+[.]lv2' | sort -u` → delayverb,
  guitar_lofi_fx, pitchtracker, resonode. Verify checksum BEFORE
  rebooting: extract `opt/aloop/aloop`, `md5sum` vs source (server
  state only — cross-check `/proc/uptime`).
- New LV2 bundle needs wiring into BOTH `build-image.yml` AND
  `serve-netboot-win.js`. `[[memory: deploy-two-paths-lv2]]`.

`build-netboot.sh` publish is a staged-directory atomic `mv`, never
`rm -rf`+populate-in-place (a Pi may be fetching mid-rebuild); staging
dir is a SIBLING (same filesystem, atomic `rename(2)`). Root
`chmod -R a+rX`'d after copy (Alpine's `initramfs-rpi` ships mode 600).
Netboot silently outranks the SD card — confirm which path booted
(`.netboot-serve.log`); `serve-netboot-win.js` can die holding
`updateInFlight`, freezing state. Netboot DHCP: three failure
signatures — dead option-66/zero TFTP reads, DISCOVERs never becoming
REQUESTs, stale baked-in server IP post-TFTP; `ensureCorrectSubnetMask()`
self-heals every startup. `[[memory: netboot-dhcp-diagnosis-history]]`.
Fast DSP iteration: `node image/dsp-hotdeploy.js --target
home|guitar|both` — real CI cross-compile, SFTPs onto a live device,
stops service BEFORE overwriting `/opt/aloop/aloop` (`fastPut` on a
running binary fails musl ETXTBSY); doesn't replace the netboot path
for boot-tree/kernel/OpenRC changes.

## CI runner, docker-step, artifact discipline

Native `ubuntu-24.04-arm` runners (no QEMU). Docker steps split with
per-command `timeout`+`set -x`. `build-image.yml` downloads BOTH
`home-fx-lv2` AND `guitar-lofi-fx-lv2` from the same green run.
Rolling `latest` release hard-gates on a real bundled binary
(`payload_check`) — stricter than `validate-image.sh` (WARNS only).
SD-zip extracted from the validated FAT image, skipped for opi-prime.
`[[memory: ci-build-pipeline-history]]`.

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc
single-AP mesh for Link's multicast peer discovery.

| Invariant | aloop | esp-idf-link |
|---|---|---|
| Mesh SSID | `hostapd.conf`/`wpa_supplicant.conf` `ssid=ticker` | `wifi_scan_best_bssid`/`wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP address / DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `hostapd.conf` `channel=6` | SoftAP ch6 |
| Link multicast | `224.76.78.75:20808` (hardcoded in Link) | same |
| Link quantum | `link_bridge.cpp` `quantum=16.0` | `main.h` `LINK_QUANTUM 16.0` |
| Start/stop sync | `enableStartStopSync(true)` | same |
| Host election | lowest MAC/BSSID wins | same |

`PHRASE_BEATS 64.0` in esp-idf-link is NOT the Link quantum (own
transport-correction boundary). Host election is MAC-ordered (never
"host if scan found nothing" — splits the mesh into two L2 domains);
hold duration monotonic in own MAC (lowest ≈0s, highest ≈6s).
`src/net/autoap.sh`: hosts `ticker` never `aloop`; needs ≥1 active
`network={}`; `start_ap()` clears previous hostapd not just
wpa_supplicant (stale → `Could not set channel`, red herring — ch6 is
paired, never "fix" by changing it). `rc-service autoap
status`=`started` is the real signal. `[[memory: mesh-link-midi-history]]`.

## Ableton Link checklist and varispeed/transport-anchor

`commitAppSessionState()` off-audio-thread, `commitAudioSessionState()`
audio-thread only — hands the audio thread a lock-free double-buffered
`LinkSnapshot` (ADR-005, ≤1 tick stale). `enableStartStopSync(true)`
pairs `isPlaying()` reads with `setIsPlaying()` calls; notification
callbacks run on a Link thread — bounded logging/atomics only.
`setTempo` rewrites EVERY peer; `proposeTempo` refuses when peers
present (`weOwnTempo` guards this only). Readiness: `depend(){ after
local autoap; }` + bounded `waitForNetworkInterface()`. Telemetry:
`status.json`'s `link.peers`/`link.playing`. Audit against
`build/_deps/abletonlink-src/TEST-PLAN.md` — TEMPO-4 (20-999bpm)
matched, `effSpeed` clamps 0.1..8.0, AUDIOENGINE-1 unverified.

Playback matches tempo by scaling read RATE
(`linkSpeedRatio=linkBpm/recordedBpm`→`effSpeed`), never a position
jump — `rposNext` advances by `speedClamped`/sample. Residual phase
error is a bounded speed trim (`kLinkPhaseTrimPerSample=0.00005`, clamp
`kLinkPhaseTrimMax=0.03`=51 cents) on `effSpeed` only, never
`masterPhaseSamples` (tracks `N*linkSpeedRatio*g_manualSpeedMul`).
Suspended while `abs(g_manualSpeedMul-1.0)>0.3`; runs only while
`linkVarispeedEngaged`. `setTransportPlaying(true)` anchors beat 0 via
`setIsPlayingAndRequestBeatAtTime(true,now,0.0,kLinkQuantum)`, never
bare `setIsPlaying`. Live check: `eff_speed` reads exactly `1.0000`
with nothing recorded; 0.97/1.03 = trim saturating. `[[memory:
link-varispeed-trim-history]]`.

## MIDI clock fan-out and other mesh facts

`midi_clock.cpp`: 24 PPQN `0xF8`+`0xFA`/`0xFC` to every MIDI output
except the control surface. No `/dev/snd/seq` — walks
`/proc/asound/card*/midi*`, rescans every 2s, ticks off
`LinkBridge::beatNow()` (no local timer can carry 20.8ms/tick at
120bpm); catch-up bounded to 4 pulses. Control surface excluded by the
card actually opened, not config parsing. `[[memory:
mesh-link-midi-history]]`. `pinLinkThreadsToControlCore` pins Link's
threads to `kControlCore=2` — prevents peer-discovery contending with
isolated audio cores (~30-37ms/1Hz stall otherwise). `[link] enabled =
true` parses as a word, not `%d`. Unproven: whether Link's multicast
crosses the Pi's AP on `brcmfmac` (`docs/LINK-MESH-TESTING.md` Tests
1-3).

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate:
**instrument** (default `hw:0,0`) tight-latency capture+playback,
blocking, retried 30x/1s; **OTG gadget** (`f_uac2`, `hw:UAC2Gadget,0`)
best-effort MIRROR, NONBLOCK (`-EAGAIN` expected; other negative return
triggers one-shot recover; permanently-gone device degrades silently).
Instrument device **S32_LE only** — class-compliant USB devices have no
S16_LE fallback, requesting S16_LE "succeeds" while negotiating S32_LE
anyway (16-bit normalization on 32-bit = loud static); buffer
`int32_t`, divisor `2147483648.0f`, format read back and compared. OTG
mirror is separate S16_LE.

Playback needs `start_threshold` lowered to one period (default is
full `buffer_size` — stays `PREPARED` forever otherwise). **4 periods
minimum** — 2 (256 frames, ALSA min) produces hundreds of xruns/sec;
OTG mirror uses looser timing (period=4×N). `f_uac2-gadget.sh`:
`req_number` must be **4**, not kernel default 2. Gadget is STEREO
(`c_chmask`/`p_chmask=0x3`) — capture L/R averaged to mono for Faust,
mono duplicated to both playback channels, DSP stays mono internally;
runs from `/etc/local.d` after `libcomposite`.

`main.cpp` declares `AudioThread` BEFORE `audio.start()` — safe only
because `snapshotTelemetry()` returns all-zero pre-`start()`.
Flush-to-zero set explicitly (`setFlushToZero()`, AArch64 FPCR FZ via
inline asm, SSE on x86) — denormals in decaying IIR are 10-100x slower.
`AloopLoopDsp` (~320 MiB)/`Sampler` (~5.3MB) must be
`std::make_unique`'d at thread startup, never stack-local (SIGSEGVs),
never in the RT hot path.

**Resolve string-keyed lookups ONCE, never per block** — control WRITE
and telemetry READ paths cache resolved `(ParamStore slot, Faust zone
float*)` pairs at startup; per-block resolution makes `readi()` take
2.2-2.7ms against a 1.333ms budget, unbounded xruns. Signature:
`/proc/<tid>/schedstat` ~95% on-CPU, `state` should read `S` between
blocks not `R`. `FaustUI`'s `addHorizontalBargraph`/
`addVerticalBargraph` must do `zones[full(l)]=z` or `hbargraph()` falls
through to an O(n) scan. `targetToZone()` needs a case for every
control target — a missing case returns `""`, silent. `masterPhaseBuf`
must ramp per-sample, never `std::fill()` with a block-constant value
(freezes `readIdx0`/`readIdx1`, jumps 64 samples at block boundaries,
audible bitcrushing).

Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut` —
prevents post-fx content re-entering `fx`. Sampler `captureBlock` reads
the same `prevFiltOut`, never `fin` (would let a sample record itself).
**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*
combinedFold` when engaged, ramping `foldGain` at `kFoldStep`
(1/16/block); `prevLoopSum` one block behind, `foldTarget =
(shiftHeldNow && !anyXposeVoiceGatedNow) ? 1.0 : 0.0`. Adds one block
of recording lag: `latencyBiasN` subtracted from `masterPhase` at
`recordStartPhaseOffset`; `kShiftFoldBlockLatencySamples` (64) written
at FINISH if `m_looperShiftHeldDuringTake[looper]` was ever set, else 0.

---

# Faust DSP

## Language gotchas

`par()`-replicated UI controls silently duplicate — `button()`/
`hslider()` inside a `par()`-instantiated function RE-ELABORATES per
call site even hoisted (verify via generated C++,
`grep -c '"name"'` must be 1); fix by threading as a plain signal
input. No runtime branching — `select2`/`ba.if` choose among
ALREADY-COMPUTED signals (why Guitar/LofiFx are a permanent always-on
Core-3 LV2 bundle and Resonode/delayverb are separate
conditionally-called bundles). Direct function-call syntax substitutes
whole expressions, not buses — `f(loop(...), a, b)` binds the ENTIRE
`loop(...)` output to the FIRST parameter; build the bus with `,` then
pipe with `:`. `ef.transpose` has a HARDCODED `maxDelay=65536`
independent of its window argument — check the real stdlib before
trusting a call site's size argument. Faust already CSEs
`par()`-replicated pure-signal subexpressions (across
`component()`-composed files too) — only `button()`/`hslider()` boxes
are exempt. Comments compile away to nothing.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation
(`-ct 0` safe, every `rwtable` index here is software-bounded);
`-mcpu=cortex-a72` at target-compile steps only; `-O3`, no
`-Ofast`/`-march=native`/fast-math. **Not shipped**: `-mapp`
(real-aarch64 SIGSEGV), `-fm def` (unresolvable `fast_*` calls,
segfaults at `render()`), `ba.tabulate` (breaks bit-exact parity),
per-effect LV2 splitting (multiplies RT dispatch), `-omp`/`-sch`
(fights manual affinity pinning), `-mcd`/`-dlt` (govern `de.delay`
only, not `rwtable`), `-clang`/`-mem` (real builds use gcc/g++, Linux
unified-heap), `-vs 16` (SIGALRMs ~2min into `dsp/aloop_pre.dsp`
codegen) — `[[memory: faust-compile-time-cliff]]`. `guitar_lofi_fx.dsp`
has no exploitable CPU waste at the source level. `[[memory:
guitar-lofifx-cpu-audit-history]]`.

## Buffer sizing constants

Bit-exact via DawDreamer JIT: `delay.dsp` `MAXD=52000` (~999.6ms cap);
`microrepeat.dsp` `MR_MAX=36000` (real ceiling 32768); `bitcrush.dsp`
`BITS_MAX=24` not 16 (S32_LE device never round-trips int16, 16 would
floor precision). `delay.dsp`'s slew (`SLEW=0.0001`) must carry NO
additive drift term. `effects_runtime.dsp`'s `filterStage`/
`delayStage`/`reverbStage`/`pitchStage` deliberately has NO parameter
smoothing upstream of `pow()`/`exp()` — verified byte-exact against
the looper's own piecewise-constant behavior.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices

`effects/home/faust/multitranspose.dsp`: NVOICES=6 absolute-pitch-lock
(not an interval harmonizer), additive with the mono SNAC engine below.
Each voice owns its own `EngineSoladSnac` — the only splice/PSOLA
implementation in the codebase. `freqDet` prefers `pitchtracker.lv2`;
`trackingAllowed = trustedTracker > 0.5` only (not OR'd with warmup);
`heldDetNote` reseeds every attack until `everTrusted` latches. Formant
(CC53, deadzone 60-68) via `LpcFormantShifter`. `[[memory:
lpc-formant-shifter-history]]`. **Disclosed, unfixed**: upward shifts
≥+18 semitones click (clean -24..+17 up, -24..-12 down);
`pitchtracker.lv2` unreliable ≥500Hz (3/16 test files);
`verify_highoctave_transient.py` is a broken gate on `main` (DawDreamer
JIT can't compile this file's `ffunction`) — `tools/dsp-cli` (below) is
the real substitute. Full voice mechanics, shared-SNAC-tracker
behavior, splice-path detail: `[[memory:
multitranspose-investigation-history]]`, `[[memory:
faust-compile-time-cliff]]`.

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s
`dubfx_pitch_tick` `ffunction`, ADR-004): SNAC tracker + solad
delay-line PSOLA shifter (integer-period resplice) + formant grain
stage — 0.99-1.00 THD to 5000Hz. `DL=32768` (131072 corrupts the Pi's
32-bit-pointer build), `MIN_PERIOD=48`, `DUBFX_BS=64`/
`DUBFX_POLY_BS=16`, crossfade EQUAL-GAIN LINEAR with LENGTH divided by
pitch ratio on upshifts. Buffers exactly `DUBFX_BS` samples/
`processBlock`, a permanent ~1.333ms latency while engaged (working-rule
carve-out). `reengage()` resets `m_grainFormant`. **Open, disclosed
bug**: SNAC tracker drift on tremolo/AM content. `[[memory:
free-transpose-engine-history]]`, `[[memory: cold-start-self-trap]]`.

## `pitchtracker.lv2`/DawDreamer/`tools/dsp-cli`

`effects/pitchtracker-src/pitchtracker_ac.dsp` — separate compilation
unit (compile-time-cliff), own LV2 bundle, `Lv2Host pitchTrackerFx`
(`/effects/pitchtracker`). Normalized autocorrelation, local-maximum
peak selection, `holdLastGood`/`energyReady` onset gate; must be
deployed to `/effects/pitchtracker/pitchtracker.lv2/` for
`multitranspose.dsp` to use it. DawDreamer's `FaustProcessor` (real
Linux `libfaust` JIT) refuses to link `ffunction` externs; parameter
list is alphabetical not declaration-order; `faust2bench` is the CPU
A/B counterpart, manual only, never wired into CI. `[[memory:
ci-build-pipeline-history]]`, `[[memory: faust-compile-time-cliff]]`.
`tools/dsp-cli/build.bat <repo_root> <dsp_file> [-I flags]` compiles ANY
`.dsp` with the real local `faust.exe`+MSVC in ~1-2s — real offline
`-lang cpp` compiles files DawDreamer categorically cannot (any
`ffunction` extern). See `tools/dsp-cli/README.md`.

---

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*`
(`static const LV2_Feature* const kNoFeatures[] = { nullptr };`), never
bare `nullptr` — Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap
`instantiate()`/`activate()` in the sigsetjmp crash watchdog `runOne()`
uses (ADR-002). `readTtl()` must strip trailing slashes from the bundle
path (lilv's resolved path has one, `bundlePath` never does — else
prefix compare fails silently, falls back to no-port-wiring `.so`-only,
watchdog off). `setControl` matches Faust's MANGLED port symbol
(`mangleFaustLabel(rawLabel)+"_"+"<portIndex>"`, e.g. `fx2/FLANGEAMT` →
`fx2_FLANGEAMT_3`) — verify via `grep lv2:symbol *.ttl` on the deployed
bundle, exact-symbol match matches nothing silently. `Lv2Plugin::
descriptor` caches at `instantiate()`, never re-resolved on the RT
path. `aloop.lv2` excluded from apkovl by name in `lib-boot-tree.sh` —
`home-fx-lv2` compiles `dsp/aloop.dsp` only as a CI
packaging-reproducibility check (ADR-003).

## Resonode: separate, conditionally-called LV2 bundle

`resonode_synth.dsp` pulled off the always-on Faust graph (avoids a
real ~2ms idle `readi` gap) into `resonode.lv2` (`Lv2Host resonodeFx`,
`/effects/resonode`); called only when `fx/resonode/engaged`. Per-voice
`note`/`gate`/`vel` are LV2 ports from `ApcGrid`'s MIDI handlers.
`resonodeIn` is ZEROED (not passed through) when engaged with no
plugins loaded. Guitar/lofi-fx run as input stage before
`faustHome.compute()`; Resonode's exciter is fed that same post-fx
signal; output re-enters the crossfade BEFORE
`microStage:filterStage:delayStage:reverbStage`. Locked pitch REPLACES,
never layers, the original. `RESONODE_ENGAGED` is written directly via
`fui.set()` in the worker loop, bypassing `targetToZone`/
`resolvedControls` — two consumers, audit both on change.
`ApcGrid::bindAll` must `ps.bind()` every internal flag a C++ path
`setByName`s (silent no-op otherwise — real incidents:
`fx/resonode/engaged`, `fx/resonode/collision`,
`cmd/halfspeed`/`cmd/doublespeed`).

6 modes/voice, 4 voices, physically-modeled, excited ONLY by live mic
(reactor mode — silent input, held key = silence). Shared broadband
exciter (highpass 60Hz+lowpass tone); each mode's own filter does all
frequency selection. `couple` (knob7): nearest-neighbor `letrec`
coupling, skew-symmetric energy exchange on peak-normalized states,
clamped ±8. 16-of-24 modes shipped (24 hits a Faust compile-time
SIGALRM ceiling); 5 ratio tables x5 hsliders shared across voices.
Shipped: zero gaps idle, worst case 80% peak/3 gaps, zero xruns.
`[[memory: resonode-exciter-coupling-cpu-history]]`.

Named sweetspot patches (knobs1-4, DawDreamer grid search):

| Patch | position | decay | damping | stretch | collision | character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp transient |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s ring, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s ring, harmonic |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass |

Knobs 5-7: tone brightness, level, `couple`. Per-voice structural
modulation (fixed constants, no knob slot): position/stretch drift
envelopes, `bassBoost`, `aliasGuard`, `collision` waveshaper, pitch-mod
onset bump, morph-snap-at-boot — `[[memory:
resonode-exciter-coupling-cpu-history]]`. Disclosed: mono in/out only.
Defense-in-depth: NaN/Inf guard at the C++ call site after
`resonodeFx.process()` — zeroes the block, rate-limited
`[diag-resonode]` log; keep even after any future DSP-level fix.

## `config/controls.conf` regression guardrails

`cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never
`cc70`/`cc71` — real APC Key25 sends NOTES 70/71 ch0, not CCs.
`note91` must never bind to `cmd/clearall` — races `ApcGrid`'s
shadow-state reset; `midi.cpp`'s note-91 intercept is unconditional on
shift.

## delayverb: separate, conditionally-called LV2 bundle

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves
(`aloop_pre.dsp`/`aloop_post.dsp`) — both stages were unconditional,
ran TWICE (cue+master) regardless of amount; `audio_thread.cpp` now
calls `.process()` only on the instance with meaningfully nonzero
DELAYAMT/REVAMT. Build needs `libboost-dev`.

## Tracktion Engine — evaluated and REJECTED, do not re-open without new evidence

Full reasoning (ALSA-device-model mismatch, thread-pool conflict,
plugin-delay-compensation risk, GUI/licensing on a headless device) and
the higher-leverage alternative: `[[memory: tracktion-engine-rejection]]`.
Open TODO: confirm `/effects/user` (swappable user-LV2 extension
point) is genuinely unused before folding `guitar_lofi_fx.lv2` into
Core-3 Faust natively.

---

# Control surface (`src/control/apc_grid.cpp`)

Every momentary Faust gate must be explicitly released or it sticks at 1
forever: `looperN/erase` (`wipe=max(clearAll,eraseN)` gates ring
recirculation — a stuck erase silently wipes playback forever while
recording still works; `pollHolds` releases after ~50ms),
`looperN/finishreq` (same shape), `cmd/clearall` (genuinely HELD —
note-on sets, note-off releases). `rec` is persistent `ParamStore`
state — `applyRecPlayCycle` sets `rec=0` on FINISH or it re-records
forever. Per-looper cycle: empty → ARM(`rec=1`) → FINISH(`rec=0`,
`play=1`) → pause(`play=0`) → resume(`play=1`); ARM/FINISH fire on
PRESS, pause/resume on release. CLEAR_ALL zeroes `play`/`rec` in Faust,
not just C++ shadow; `onStopImmediate` also zeroes `rec` on a
mid-recording abort. `m_masterLenSamples`/`cmd/master_len`/
`cmd/recorded_bpm` reset to 0 when the last looper with content is
erased, from any path — the driving `anyHasContent` check cross-checks
real DSP telemetry (`Telemetry::looperWrapLen`, not just `ApcGrid`'s own
`m_looperHasContent[]` shadow) and self-heals the shadow before
committing to a reset. `[[memory: control-surface-quantization-history]]`.

Master phrase length is `writeIdx` telemetry, never wall-clock —
`deriveTempoQuant` proposes Link tempo only, never resizes
`m_masterLenSamples`. Quantization is powers-of-2, always the CEILING
(`kMaxLoopSamples` top, M/16 bottom via `lowerExp` floor -4.0); every
`wrapLen` is a power-of-2 ratio of every other (drift-free repeat
alignment). `verify-quantization.js`'s `ceilingPow2Candidate` matches
this.

**Content phase-anchor**: playback anchors to a shared `masterPhase`
grid, never a per-take offset. Non-first-looper `armEdge` fires only on
`masterPhaseWrapped` (`masterPhase<masterPhasePrev`) — every looper
anchors the SAME reference beat (loop 1 arms instantly, no grid yet). A
press within `kArmBackdateGraceSamples` (2400=50ms@48kHz) of the last
phrase-top arms immediately, backdated to it via stateless
`backdateEligible=masterPhase<kArmBackdateGraceSamples` (`masterPhase`
IS already samples-since-phrase-top by construction, no separate
counter — a prior recursive-counter version was replaced for a
compile-time-cliff SIGALRM); `rsmNext` still captures real
`masterPhase` at armEdge, encoding the in-phrase offset; outside the
window, waits for the next phrase-top. `cycleOffset` accumulates
`+masterLen` per wrap, reset at `armEdge`; `wrapLen=
gridMultiple*anchorGridLenNow`, ceiling always. Disclosed:
`winSamples`/`xfSamples` can freeze at floor on a true zero-context
cold start (unfixed). `[[memory: control-surface-quantization-history]]`.

First (master-establishing) recording's tempo/beats comes from a real
synced Link tempo when present — `recorded_beats=
round(recordedSeconds*bpm/60)`, `recorded_bpm`=real bpm directly when
`link->audioRead().synced && bpm>1.0` at FINISH; `deriveTempoQuant` is
fallback-only. Real APC Key25 re-sends note-on for an already-held pad
— `onPadPress`/`m_looperHeld` treats a repeat as no-op (same for
`onLofiFxPress`, edge-triggered via SHIFT rather than hold-duration
timed for this reason). Guitar-fx held REDIRECTS looper pad presses to
`onSidechainLooperToggle` (one-shot, not ARM/FINISH) while
`m_guitarFxHeld`.

## LofiFx/granulator button — SHIFT disambiguates the two gestures (note 69)

Both fire on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap
toggles Resonode engage (Resonode always wins — forces granulator latch
off; disengage releases every held voice). Every press switches active
knob bank to LofiFx, reverting on release only if Resonode not engaged.
Resonode-engaged keybed drives 4 voices via `Lv2Host::setControl` to
`fx/resonodevoice{v}/{note,gate,vel}` (skipped when disengaged, unlike
`multitranspose.dsp`'s 6 always-on voices). LED blinking red=Resonode,
solid green=granulator latched; LofiFx itself latches permanently, no
revert-on-release. `m_lofiShiftMode`: plain=granulator page,
SHIFT=Resonode page.

## Granulator (`src/dsp/sampler/sampler.h`) — 4 named patches + 3 direct dials

C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/
`posJitterMs`/`scanRate`/`reverseProb`/`envShape`), `MAX_GRAINS=48`
shared across 16 voices, cubic-interpolated reader; `scanRate=0` freezes
scan, negative `rate`/`reverseProb` reverses, `envShape` morphs
Blackman→Hann→percussive. Direct dials (knobs 5-7) override the
patch-blended field once touched: Scan/Freeze (0-3.0), Density (log
2-200Hz), Pitch Scatter (0-1200c linear). Grain pool budgeted PER
VOICE, never exhaustible; gain compensation tracks the budgeted spawn
period (flat ±0.5dB across voice count); `MAX_GRAINS` not raised (4x
pool = 4x worst-case CPU). Pitch quantizes to musical intervals
(Octaves/Fifths/Minor Triad/Minor Pentatonic, beside continuous spray)
at zero CPU — knob7 `v01<=0.5`=continuous, above=4 interval sets.
`[[memory: granulator-investigation-history]]`.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching
8-knob banks via `ApcGrid::onFxKnobCC` on `m_activeBank`/`m_shift`.
`kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 double-duties as
Formant on Dub only):

| Page | Regular (knobs 1-7) | Shift |
|---|---|---|
| Dub | `fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant | dance-gate+LFO: `fx/dubgate/*`, `fx/dublfo/*`, tempo-synced via `fx/dubgate/clockphase` off the shared 4-beat clock |
| Guitar | `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}` (shared `BANKSPEED` LFO), CC53=`fx2/GATEAMT` | 8-dial dual-ADSR (filter-cutoff+amplitude) to C++ `Sampler` directly, no Faust/LV2 targets |
| LofiFx | knob0 `fx2/BITCRUSHAMT`, knobs1-4 patch weights (granulator or Resonode per `m_lofiShiftMode`) | knobs5-7 direct dials |

`compressor.dsp` stays unreferenced (`ab_fm_def.py`'s fast-math test
uses it). `samplerate.dsp`/`mixbus.dsp`/`gateStage`'s multi-pattern
select/`SRRAMT`/`rawGlitchTap` removed as dead. `chain.dsp` is NOT dead
— `home-fx-lv2` builds it as a packaging check.

Groove shuffle: the 4 metronome-flash pads (notes 15/23/31/39) double as
shuffle buttons, `fx/shuffle/mask` (4-bit) — true retrigger/reorder,
block-boundary only, own free-running `shuffleClockSamples` atop the
real `masterPhaseSamples+i` ramp. `kShiftReorderTables[mask]` (15
distinct 4-entry sequences) eliminates double-tap.

`dsp/loop.dsp` varispeed has NO deadzone (`varispeedActive=
effSpeed!=1.0` exact) — avoids steady phasing between loopers of
different lengths on small Link-tempo mismatches; `resyncCoeff` gates
to `0.0` when `|effSpeed-1.0|>0.3`. Beat-shuffle's hard clip and
varispeed's instant speed jump are both INTENTIONAL (explicit user
direction) — not defects to smooth. `microrepeat.dsp`'s
`sliceBlocks=max(1,int(beatBlocks/divSafe))*2`, `divSafe=max(1,DIV)`
(multiplies the computed slice length, never halves the divisor first —
floor-collides `div=1`/`div=2` at `int(1/2)=0`); `mode2`-`mode4`'s
damping exponent strength-reduced from `pow()` to integer multiplies.
CC53 formant: deadzone 60-68, `((data2-64)/63.0)*1.5` (clamped -3..3) —
SHIFT never changes a knob's own behavior, reserved for the native
fold/resample gesture.

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a
different USB role (peripheral/gadget vs. host mode on the USB-A ports
a flash drive plugs into).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring
(5s). `audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(),
N)` every block, next to `g_sampler->captureBlock(...)` — same post-fx
tap point. Single-atomic-counter SPSC ring (`std::atomic<uint64_t>`
write/read counters), never blocks/allocates — a lagging consumer has
`pushBlock` advance the read counter itself (drops oldest samples,
increments an overrun counter).

**Control side**: file I/O happens in `UsbRecorder::poll()`, called
from `main.cpp`'s 5 Hz control loop — deliberately not a dedicated
pthread. Chunks are fixed-size, cyclically `O_TRUNC`-reopened, bounding
disk usage by construction. Mount detection is a `stat()` device-id
comparison (`isMounted()`), not `/proc/mounts` parsing.

**Config**: `[storage]` in `config/aloop.conf` — `usb_record`,
`usb_mount_point` (default `/media/aloop-usb`), `usb_chunk_minutes`
(10), `usb_chunk_count` (6). `effectiveChunkCount()` shrinks the ring
for smaller drives via `statvfs`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`usb-automount-setup.sh` (local.d bootstrap, APPENDS to
`/etc/mdev.conf`, own explicit coldplug pass since `local.d` runs AFTER
`mdev -s`'s sysinit scan). Mount attempts: no `-t` first, then explicit
`vfat`/`ext4`/`exfat`/`ntfs` — exFAT/NTFS userspace tools almost
certainly NOT in the minimal Alpine RPi tarball, only kernel-native
FAT32/ext4 expected without further vendoring. UNVERIFIED on real
hardware (mdev.conf syntax, real drive enumeration). Both scripts
registered in BOTH `_exec_paths` and `_nb_exec_paths`.

---

# Faust Libraries reference

Documents the Faust standard DSP libraries only, not compiler flags (see
Faust DSP above; flags at
[faustdoc.grame.fr/manual/optimizing](https://faustdoc.grame.fr/manual/optimizing/)).
Prefer Markdown sources: [libs index](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/libs/index.md),
[standard functions](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/standardFunctions.md),
[overview](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/organization.md),
[libs folder API](https://api.github.com/repos/grame-cncm/faustlibraries/contents/doc/docs/libs).
HTML equivalents: [libs](https://faustlibraries.grame.fr/libs/),
[standard functions](https://faustlibraries.grame.fr/standardFunctions/),
[motion functions](https://faustlibraries.grame.fr/motion_functions/).
