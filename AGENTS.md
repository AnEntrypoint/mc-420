# aloop — technical constraints reference

Durable constraints for this codebase and its build/deploy pipeline. Real Pi 4
device `192.168.137.100`, root/aloop. Real Pi 3B+ debug device reaches the
host via netboot (`.netboot-serve-pi3/`, `[[memory: project-pi3-netboot]]`).
Read before touching the device, the DSP, or the image/netboot scripts.

Lean, current-state-only reference: hardware facts, build/deploy procedures,
shipped architecture, working rules, open/disclosed bugs. Long-form
investigation history (rejected designs, session narration, superseded
measurements) lives in auto-memory (`~/.claude/projects/<project>/memory/`);
`[[memory: ...]]` pointers carry the "why". Re-compacted whenever this file
exceeds ~30KB (`~/.claude/CLAUDE.md` invariant 3) — a value with no pointer
owed no narrative.

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

**No comments in code, ever.** No inline, block, or doc comments anywhere
(C++, Faust `.dsp`, JS, shell, YAML, config) — a name/function
boundary/extracted variable/small type IS the explanation. Design
rationale belongs in THIS file or memory, never inline (SSOT). A comment
found anywhere is converted to self-explanatory code the same turn
(root-cause it, delete it); one sighting spawns a full sweep of that file.
`[[memory: no-comments-rule]]`.

**Never add audio-path latency.** The existing ~7ms block latency must
never grow, even temporarily or to work around an unrelated bug — stop and
ask first (one-way door). A wet effect's own engaged-only algorithmic
latency (`ef.transpose`'s window, the SNAC engine's latency) is exempt —
additive on top of an always-instant dry path.

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
gestures. Abstract "formal verification" framings do not apply — work the
concrete bug with static reading, real device logs, byte-level MIDI
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
`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`). `boot_tree_apkovl` (binary,
LV2, services, vendored libs) is fully shared/unconditional; only
`boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config`
(cmdline/USB-gadget config) dispatch per board.
`board_supports_usb_gadget`/`board_wifi_irq_name`/`board_firmware_names` in
`lib-boot-tree.sh` are the authoritative capability source, not this table:

| Board | SoC | Boot chain | USB-audio gadget | WiFi chip |
|---|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711, quad Cortex-A72 aarch64 | Pi firmware, FAT partition | dwc2 peripheral — real UAC2 gadget | Broadcom brcmfmac |
| pi3 | BCM2837, quad Cortex-A53 aarch64 | Pi firmware, FAT partition | none — no OTG-capable controller | Broadcom brcmfmac |
| pi5 | BCM2712, quad Cortex-A76 aarch64 | Pi firmware, FAT partition | none — RP1 southbridge USB is host-only | Broadcom brcmfmac |
| opi-prime | Allwinner H5, quad Cortex-A53 aarch64 | Armbian U-Boot (raw SD sectors) + ext4 root + extlinux.conf | unproven | Realtek RTL8723BS |

**Pi 3B+ ships netboot ENABLED from the factory** (no OTP write, unlike
3B/CM3/3A+); ROM order is SD (if `bootcode.bin` present) → USB → Network —
"prep for netboot" means wiping the card. `[[memory: project-pi3-netboot]]`,
`[[memory: feedback-verify-before-irreversible-hw]]` (WebSearch OTP claims
before any irreversible action, even after the user has picked an option).

## Orange Pi Prime specifics

SoC Allwinner H5 (Cortex-A53) — Alpine aarch64 applies directly.
USB-audio-gadget **UNPROVEN**: MUSB dual-role controller is micro-USB
OTG only, the 3 USB-A ports are host-only. `board_supports_usb_gadget`
false for `opi-prime`; fallback is the built-in 3.5mm codec as ALSA
HOST.

Boot chain incompatible with the Pi's FAT model — BootROM reads a raw
SPL/U-Boot image at a raw SD sector offset pre-partition-table.
`boot_tree_fetch_opi`/`boot_tree_config_opi`: Armbian
`dl.armbian.com/orangepiprime/Trixie_current_minimal` stable-redirect
URL (never a release-asset URL), real partition table via `sfdisk`
(never fixed-offset), pre-partition-1 region = U-Boot blob, loop-mount
ext4 root. Writes `/boot/extlinux/extlinux.conf` (fallback only —
Armbian's `bootcmd` sources `/boot/boot.scr` directly). `build-image.sh`'s
opi-prime branch needs real root (Linux host only). No netboot path
(BootROM needs local U-Boot before PXE); skipped in `build-image.yml`.
`[[memory: opi-prime-boot-history]]`.

`boot_tree_write_boot_scr_opi` addresses must match this U-Boot's
compiled-in defaults (`strings`-extracted): `kernel_addr_r=0x40080000`,
`fdt_addr_r=0x4FA00000`, `ramdisk_addr_r=0x4FF00000`,
`loadaddr=0x42000000`, `scriptaddr=0x4FC00000` — untested past `booti`
handoff. `earlycon=uart8250,mmio32,0x01c28000` diagnostic;
`console=ttyS0,115200` verified. WiFi RTL8723BS — `rt-tune.sh`
IRQ-steering matches `rtl8723bs`.

`build-opi-armbian-source.yml` pins Armbian's last pre-6.18 sunxi64
kernel (`armbian/build@be0bd46`, resolves 6.12) with patch-time
workarounds for unrelated `series.conf` entries and a
`-Werror`/`cfg80211_ops` fix (not the board's own `rtl8723bs`, clean).
`[[memory: opi-prime-boot-history]]`.

## apkovl assembly constraints

- `boot_tree_apkovl` must stamp `.default_boot_services` — Alpine's
  `rc_add modloop sysinit` gate needs it or `/lib/modules`/
  `/proc/asound`/`usb_gadget/` never appear (one-shot marker).
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"`, not
  `local.d ulimit` (subshell doesn't reach `aloop`; `rc_ulimit` reads
  pre-exec).
- `aloop`'s `depend()` needs `after local autoap` (opens Link's UDP
  socket at startup; waits for interface address).
- Vendor alsa-lib + lilv stack as real `.so`s (`vendor/lib-aarch64/`);
  never `apk add` at boot (repo lacks them). alsa-lib needs
  `vendor/share-alsa/` (~340K) or `snd_pcm_open` segfaults in config
  parsing.
- `hostapd`/`dnsmasq` vendored aarch64 (`vendor/sbin-aarch64/`, repo
  lacks them, `APKINDEX.tar.gz` can't regen on Windows). `hostapd`
  needs `libnl-3.so.200`/`libnl-genl-3.so.200`; `dnsmasq.conf` needs
  explicit `user=root`/`group=root`.
- `cmdline.txt`/`extlinux.conf` APPEND writes stay a single line
  (fw/U-Boot read only line 1); collapsed via `tr '\n' ' '` + `tr -s
  ' '`; validators count newlines.
- New vendored files need both `tar --mode='+x'` lists (`_exec_paths`,
  `_nb_exec_paths`) — NTFS has no exec bit, `chmod +x` no-ops on
  Windows (`[[memory: windows-host-constraints]]`). Read modes from
  `tar -tvzf`, never extracted files (verifiers grep the LAST match).
- `find` calls building those lists must run inside the overlay dir
  (`cd "$OVL" && find ...`) — against cwd, `find` silently returns
  empty.
- `core.autocrlf=true` corrupts scripts here — `.gitattributes` forces
  `eol=lf`; strange on-device behavior → `file` for CRLF, fix via `rm`
  + `git checkout --`. `[[memory: windows-host-constraints]]`.

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.** A
`.so` built with host g++ dlopens with no discovery error, then fails at
load: `Error relocating .../foo.so: unsupported relocation type 7`. CI
green only ever means "x86_64 compiled". Pattern (`.github/workflows/
build-lv2.yml`): split `faust2lv2`'s stages — `faust -i -a lv2.cpp` emits a
self-contained `.cpp`; a `$HOST_CXX` compile+run of it emits `.ttl`
metadata (host-only); only the final `-shared .so` link targets the
device, cross-compiled in a real Alpine aarch64 container
(`docker/setup-qemu-action` + `docker run --platform linux/arm64
alpine:3.20`). Verify: `objdump -p foo.so | grep NEEDED` must show
`libc.musl-aarch64.so.1`, never `libc.so.6`. Pass `CPPFLAGS` into nested
`docker run ... sh -c "..."` via `-e VAR="$VAR"`, never string
interpolation (escaped quotes lose their escapes across the nested-shell
boundary).

**`actions/upload-artifact@v4` `path:` wildcard-vs-literal.** `path:
effects/home/*.lv2` (wildcard) preserves the matched directory's
basename; `path: effects/home/guitar_lofi_fx.lv2` (literal) flattens its
CONTENTS at the zip root, silently dropping the `.lv2/` wrapper. Always
use the wildcard form for LV2 bundle artifacts.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes
`audio_thread.cpp`'s worker skip `homeFx.process()`/`userFx.process()`
entirely — fully silent, no error, survives any `rc-service aloop
restart`. Always `grep -n disable_core3_lv2 /etc/aloop.conf` (anchored,
no leading `#`) before debugging "guitar/lofi effects don't do anything"
as a code bug.

---

# Deploy, netboot, SSH

**SSH: use a JS `ssh2` client, never Windows ssh.exe or sshpass**
(`[[memory: windows-host-constraints]]`). A fresh netboot generates a
new host key every boot, breaking raw `ssh`/known_hosts but not `ssh2`.

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process**
(`config/aloop.conf`'s `[remote] token=`, `udp/4446`,
`remote_control.cpp`). If `aloop` crashed, nothing listens and
`aloop-reboot.js` silently no-ops (OpenRC `respawn_max=0` won't restart
it) — use `node ssh-exec.js 192.168.137.100 "reboot"`. Verify a reboot
actually happened before trusting device state: `/proc/uptime` and
`md5sum /opt/aloop/aloop` vs deployed, BEFORE reading logs.

## Netboot self-update: two rebuild paths

- **Automatic**: `image/serve-netboot-win.js` (elevated,
  `GITHUB_TOKEN`/`PI_TOKEN`) polls `build-binary.yml`/`build-lv2.yml`'s
  green `main` every 30s, rebuilds on SHA change
  (`.netboot-update-sha`). Blind to `image/**` packaging changes —
  manual rebuild needed.
- **Manual**: `ALOOP_BIN=<path> LV2_DIR=<path> RESONODE_LV2_DIR=<path>
  PITCHTRACKER_LV2_DIR=<path> DELAYVERB_LV2_DIR=<path> OUT=.netboot-serve
  NETBOOT_SERVER=192.168.137.1 bash image/build-netboot.sh` — all three
  `*_LV2_DIR` vars **mandatory** (excluded from the general `LV2_DIR`
  find, silently ships none otherwise). Verify: `tar -tzf
  .netboot-serve/aloop.apkovl.tar.gz | grep -oE
  'effects/[a-z]+/[a-z_]+[.]lv2' | sort -u` → delayverb,
  guitar_lofi_fx, pitchtracker, resonode.
- Verify checksum BEFORE rebooting: extract `opt/aloop/aloop`, `md5sum`
  vs source (server state only — cross-check `/proc/uptime`).
- New LV2 bundle needs wiring into BOTH `build-image.yml` AND
  `serve-netboot-win.js`. `[[memory: deploy-two-paths-lv2]]`.

`build-netboot.sh` publish is a staged-directory atomic `mv`, never
`rm -rf`+populate-in-place — a Pi may be fetching mid-rebuild; staging
dir is a SIBLING (same filesystem, atomic `rename(2)`). Root
`chmod -R a+rX`'d after copy (Alpine's `initramfs-rpi` ships mode 600).

**Netboot silently outranks the SD card** — Pi 4 prefers network boot;
confirm which path booted (`.netboot-serve.log`), compare binary md5.
`serve-netboot-win.js` can die holding `updateInFlight`, freezing
state.

**Netboot DHCP**: three failure signatures — dead option-66/zero TFTP
reads; DISCOVERs never becoming REQUESTs (wrong netmask/egress); stale
baked-in server IP stalling in initramfs post-TFTP.
`ensureCorrectSubnetMask()` self-heals every startup. `[[memory:
netboot-dhcp-diagnosis-history]]`.

**Fast DSP iteration**: `node image/dsp-hotdeploy.js --target
home|guitar|both` — real CI cross-compile, SFTPs onto a live device,
restarts over `ssh2`. Stops service BEFORE overwriting
`/opt/aloop/aloop` (`fastPut` on a running binary fails musl ETXTBSY).
Doesn't replace the netboot path for boot-tree/kernel/OpenRC changes.

## CI runner, docker-step, artifact discipline

Native `ubuntu-24.04-arm` runners (no QEMU). Docker steps split with
per-command `timeout`+`set -x`. Artifacts `retention-days: 3` (opi: 7).
`build-image.yml` downloads BOTH `home-fx-lv2` AND
`guitar-lofi-fx-lv2` from the same green run (`workflow_run` only
carries its own artifacts; `home-fx-lv2` alone ships zero usable
home-FX). Rolling `latest` release hard-gates on a real bundled binary
(`payload_check`) — stricter than `validate-image.sh` (WARNS only).
SD-zip extracted from the validated FAT image, skipped for opi-prime.
`[[memory: ci-build-pipeline-history]]`.

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc
single-AP mesh for Link's multicast peer discovery. No credential
provisioning — exactly one device hosts the open SSID `ticker`.

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
hold duration monotonic in own MAC (lowest ≈0s, highest ≈6s), rescan
every second, yield to a lower-BSSID AP unless clients attached.

`src/net/autoap.sh`: hosts `ticker` never `aloop`; needs ≥1 active
`network={}`; rescan avoids naive `grep -oE 'ssid="[^"]*"'` (misses
comments); POSIX-clean busybox ash (`dash -n`); `start_ap()` clears
previous hostapd not just wpa_supplicant (stale → `Could not set
channel`, a red herring — ch6 is paired, never "fix" by changing it).
`rc-service autoap status`=`started` is the real signal.

## Ableton Link checklist

`commitAppSessionState()` off-audio-thread, `commitAudioSessionState()`
audio-thread only — aloop uses only App variants, hands the audio
thread a lock-free double-buffered `LinkSnapshot` (ADR-005, ≤1 tick
stale). `enableStartStopSync(true)` pairs `isPlaying()` reads with
`setIsPlaying()` calls. Notification callbacks run on a Link thread —
bounded logging/atomics only. `setTempo` rewrites EVERY peer;
`proposeTempo` refuses when peers present. `kLinkQuantum`/
`LINK_QUANTUM` (both 16.0) move together. Telemetry: `status.json`'s
`link.peers`/`link.playing`. Readiness: `depend() { after local
autoap; }` + bounded `waitForNetworkInterface()`. Audit against
`build/_deps/abletonlink-src/TEST-PLAN.md` — TEMPO-4 (20-999bpm)
matched, `effSpeed` clamps 0.1..8.0, AUDIOENGINE-1 unverified.

## Link varispeed and transport-anchor

Playback matches tempo by scaling read RATE
(`linkSpeedRatio=linkBpm/recordedBpm`→`effSpeed`), never a position
jump — `rposNext` advances by `speedClamped`/sample. Residual phase
error is a bounded speed trim (`kLinkPhaseTrimPerSample=0.00005`, clamp
`kLinkPhaseTrimMax=0.03`=51 cents) on `effSpeed` only, never
`masterPhaseSamples` (tracks `N*linkSpeedRatio*g_manualSpeedMul`).
Suspended while `abs(g_manualSpeedMul-1.0)>0.3`; runs only while
`linkVarispeedEngaged`. `weOwnTempo` guards `proposeTempo` only.
`setTransportPlaying(true)` anchors beat 0 via
`setIsPlayingAndRequestBeatAtTime(true,now,0.0,kLinkQuantum)`, never
bare `setIsPlaying` (stop keeps the bare call).

Live check: `/run/aloop/status.json`'s `eff_speed` reads exactly
`1.0000` with nothing recorded; 0.97/1.03 = trim saturating. `[[memory:
link-varispeed-trim-history]]`.

## MIDI clock fan-out (`midi_clock.cpp`)

24 PPQN `0xF8`+`0xFA`/`0xFC` to every MIDI output except the control
surface. No `/dev/snd/seq` — walks `/proc/asound/card*/midi*`,
`hw:CARD,0,0` via `snd_rawmidi`, rescans every 2s. Own thread, ticks
off `LinkBridge::beatNow()` (no local timer can carry 20.8ms/tick at
120bpm); catch-up bounded to 4 pulses. Control surface excluded by the
card actually opened (`controlSurfaceCard()`), not config parsing.
Waits 15s for surface ID, releases any port later found to be it
(replug). `[[memory: mesh-link-midi-history]]`.

## Other Link/mesh facts

`pinLinkThreadsToControlCore` pins Link's threads by `comm` name to
`kControlCore=2` — prevents peer-discovery contending with isolated
audio cores (~30-37ms/1Hz stall otherwise), no added latency. `[link]
enabled = true` parses as a word, not `%d`. Unproven: whether Link's
multicast crosses the Pi's AP on `brcmfmac` (`ap_isolate=0` set; don't
port ESP32's unicast relay speculatively; `docs/LINK-MESH-TESTING.md`
Tests 1-3).

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate:
**instrument** (default `hw:0,0`, e.g. AIR 192|4) — tight-latency
capture+playback, blocking, retried 30x/1s; **OTG gadget** (`f_uac2`,
`hw:UAC2Gadget,0`) — best-effort MIRROR, NONBLOCK (`-EAGAIN` expected;
other negative return triggers one-shot recover; permanently-gone
device degrades silently).

Instrument device **S32_LE only** — class-compliant USB devices have no
S16_LE fallback; requesting S16_LE "succeeds" while negotiating S32_LE
anyway (16-bit normalization on 32-bit = loud static). Buffer
`int32_t`, divisor `2147483648.0f`; format read back and compared. OTG
mirror is separate S16_LE — separate wire buffers.

Playback needs `start_threshold` lowered to one period (default is
full `buffer_size`; this loop writes one period per `writei()` then
blocks on the next capture read — stays `PREPARED` forever otherwise).
**4 periods minimum** — 2 (256 frames, ALSA min) produces hundreds of
xruns/sec; OTG mirror uses looser timing (period=4×N).

`f_uac2-gadget.sh`: `req_number` must be **4**, not kernel default 2
(caps `buffer_size` at 256 frames). Gadget is STEREO (`c_chmask`/
`p_chmask=0x3`) — capture L/R averaged to mono for Faust, mono
duplicated to both playback channels; DSP stays mono internally. Runs
from `/etc/local.d` after `libcomposite`.

`main.cpp` declares `AudioThread` BEFORE `audio.start()` — safe only
because `snapshotTelemetry()` returns all-zero `Telemetry`
pre-`start()`; preserve on any constructor change. Flush-to-zero set
explicitly (`setFlushToZero()`, AArch64 FPCR FZ via inline asm, SSE on
x86) — denormals in decaying IIR are 10-100x slower. `AloopLoopDsp`
(~320 MiB) and `Sampler` (~5.3MB) must be `std::make_unique`'d at
thread startup, never stack-local (SIGSEGVs), never in the RT hot path.

**Resolve string-keyed lookups ONCE, never per block** — control WRITE
and telemetry READ paths cache resolved `(ParamStore slot, Faust zone
float*)` pairs at startup, rebuilt only when `ParamStore::count` grows.
Per-block resolution makes `readi()` take 2.2-2.7ms against a 1.333ms
budget, unbounded xruns. Signature: `/proc/<tid>/schedstat` ~95%
on-CPU, `state` should read `S` between blocks not `R`.

`FaustUI`'s `addHorizontalBargraph`/`addVerticalBargraph` must do
`zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan on
every `fui.get()`. `targetToZone()` needs a case for every control
target — a missing case returns `""`, silent.

`masterPhaseBuf` must ramp per-sample (`masterPhaseBuf[i]=
masterPhaseSamples+i`, wrapped at `masterLen`, bit-exact vs `fmod`);
`std::fill()` with a block-constant value freezes `readIdx0`/`readIdx1`,
jumps 64 samples at block boundaries (audible bitcrushing).

Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut` —
prevents post-fx content re-entering `fx`. Sampler `captureBlock` reads
the same `prevFiltOut`, never `fin` (post-`renderInto()` it contains
this block's own sampler-playback voices — would let a sample record
itself).

**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*
combinedFold` when engaged, ramping `foldGain` at `kFoldStep`
(1/16/block); `prevLoopSum` one block behind. `foldTarget =
(shiftHeldNow && !anyXposeVoiceGatedNow) ? 1.0 : 0.0`. Adds one block
of recording lag: `latencyBiasN` subtracted from `masterPhase` at
`recordStartPhaseOffset`; `kShiftFoldBlockLatencySamples` (64) written
at FINISH if `m_looperShiftHeldDuringTake[looper]` was ever set, else
0.

---

# Faust DSP

## Language gotchas

`par()`-replicated UI controls silently duplicate — `button()`/
`hslider()` inside a `par()`-instantiated function RE-ELABORATES per
call site even hoisted; verify via generated C++ (`grep -c '"name"'`
must be 1). Fix: thread as a plain signal input. Per-looper
once-per-take values (`finishtarget`, `latencybias`) are correctly
`par()`-replicated. Momentary/held UI state threads as signal inputs by
convention even outside `par()` (`multitranspose.dsp`'s
`note`/`gate`/`free`).

Faust has no runtime branching — `select2`/`ba.if` choose among
ALREADY-COMPUTED signals, no way to skip a zero-amount stage's cost. Why
Guitar/LofiFx are a permanent always-on Core-3 LV2 bundle (a real ~7pp
`core_busy` regression was measured trying an in-Faust crossfade) and
Resonode/delayverb are separate conditionally-called bundles.

Direct function-call syntax substitutes whole expressions, not buses —
`f(loop(...), a, b)` binds the ENTIRE `loop(...)` output to the FIRST
parameter (symptom: `too much arguments` buried in the callee); use `,`
to build the bus then `:` to pipe.

Read the real stdlib (`/usr/share/faust/*.lib`) before trusting a call
site's size argument — `ef.transpose` has a HARDCODED `maxDelay=65536`
independent of the window argument.

Faust already CSEs `par()`-replicated pure-signal subexpressions
(through recursive `~` and `component()`-composed files) — only
`button()`/`hslider()` boxes are exempt; check the generated C++ call
count before proposing a manual hoist.

Comments compile away to nothing (`faust -lang cpp` A/B is
byte-identical) — no runtime check needed to trust a comment removal.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation
(`build-local.sh`, `build-binary.yml`, both `build-lv2.yml` jobs). `-ct
0` is safe because every `rwtable` index here is software-bounded — a
new `rwtable` needs its own index-bound trace first. `-mcpu=cortex-a72`
at target-compile steps only, not the two native-host `.ttl` g++
compiles. `-O3`, no `-Ofast`/`-march=native`/fast-math.

**Not shipped**: `-mapp` (real-aarch64 SIGSEGV despite a matching
x86_64 A/B); `-fm def` (emits unresolvable `fast_tanf`/`fast_powf`
calls, segfaults at `render()` while `compile()` succeeds —
`test/faust-flags/README.md`); `ba.tabulate` for `filters.dsp`/
`pitch.dsp` (need bit-exact parity, tabulation is approximate);
per-effect LV2 splitting (multiplies RT dispatch); `-omp`/`-sch` (fights
manual `pthread_setaffinity_np`); `-mcd`/`-dlt` (govern `de.delay`
only, not `rwtable`); `-clang` (real compiles use gcc/g++); `-mem`
(unified-heap Linux). `-vs 16` kills the compiler via SIGALRM ~2min into
`dsp/aloop_pre.dsp` codegen — do not re-propose without a fresh
compile-time investigation.

`guitar_lofi_fx.dsp` has no exploitable CPU waste at the Faust-source
level (LFO CSE, `pow` strength-reduction, block-rate coefficients,
`MAXD` sizing, phaser division all already compiler-handled).
Sound-character tradeoffs remain open, gated on a by-ear pass. `[[memory:
guitar-lofifx-cpu-audit-history]]`.

## Buffer sizing constants

Sized to "real usage ceiling + margin", verified bit-exact via
DawDreamer JIT: `delay.dsp`'s `MAXD=52000` (ring 65536 floats — `TIME`
caps usable delay at ~999.6ms/~47999 samples); `microrepeat.dsp`'s
`MR_MAX=36000` (`sliceLen` ceiling across the `DIV`/`MLB` grid is
exactly 32768). `bitcrush.dsp`'s `BITS_MAX=24` (not 16) — the real path
never round-trips through int16 (S32_LE device), so 16 would be an
always-on precision floor at `BITCRUSHAMT=0`.

`delay.dsp`'s slew recursion (`curStep(target,c)=c+(target-c)*SLEW`,
`SLEW=0.0001`) must have NO additive drift term — a stray `+1.0` gave a
fixed point of `target+10000` samples, a hidden ~208ms floor.
`MIN_DELAY_MS=1000.0/SR`; TIME sweeps 0.02ms-~999.6ms linearly. Warm the
ring ~90000 samples before measuring.

Parameter smoothing in `effects_runtime.dsp`'s `filterStage`/
`delayStage`/`reverbStage`/`pitchStage` is deliberately absent (no
`si.smoo` upstream of `pow()`/`exp()`) — verified byte-exact against the
looper's own piecewise-constant behavior; adding it would break parity.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices

`effects/home/faust/multitranspose.dsp`: NVOICES=6 polyphonic
pitch-LOCK (Whammy/Manipulator behavior, lands on the exact held key),
additive with the mono SNAC "pedal ride" engine (`fx/pitchbend`, CC52).
Each voice owns its own `EngineSoladSnac` (`pitch_poly.dsp`/
`pitch_poly_ffi.h`, `DubfxPolyVoice[6]`) — same engine as the mono
effect, made polyphonic. `shiftAmount = targetNote - heldDetNote`
(continuously re-tracked) converts to `pow(2, shiftAmount/12)`, a plain
signal argument.

**Absolute pitch-lock**, not an interval harmonizer (explicit user
direction). `freqDet = ba.if(extFreqDet>0.5, extFreqDet,
detectedFreq(sigIn))` prefers `pitchtracker.lv2` over the internal
zero-crossing fallback. `freeXpose` must follow `foldGain` (hoisted
`static`), not raw SHIFT state. `[[memory:
multitranspose-investigation-history]]`.

- `trackingAllowed = trustedTracker > 0.5`, not `| inLockWarmup` — an OR
  term would trust the slow zero-crossing fallback for the first ~80ms
  of every note, causing attack-transient instability.
- `heldDetNote` reseeds to `targetNote` on every attack until the
  tracker has EVER been trusted, not just at `ba.time==0` (which goes
  stale once any time passes untouched, always true on real hardware);
  `everTrusted` (permanent latch) gates the reseed, closing a runaway
  first-note multi-octave shift.

`[[memory: multitranspose-investigation-history]]`.

**Voice mechanics**: shared `an.pitchTracker` runs once/sample. Each
voice glides shift via a one-pole (`tau2pole(0.008)`), gated by
`en.adsr` (3/30ms, sustain 1, 50ms release), shifted by
`EngineSoladSnac`, formant-shaped by `LpcFormantShifter`, block-buffered
at 16 samples (~0.33ms onset latency). Fixed gain 0.6 + static
`ma.tanh` soft-clip on the summed bus (never dynamic
`1/sqrt(activeVoices)` — pumps on release). Round-robin/oldest-steal;
steal calls `reengage()`. **Engaged state held by a linear release
counter** (`engageReleaseHoldS=0.06`), never `gate>0.5`/`voiceEnv>0`
directly. `DubfxPolyVoice::pos`/`inBuf`/`outBuf` cleared on reengage.

**Formant** (`fx/formant`, CC53): plain signal, ~±1.5 range
(`((data2-64)/63)*1.5`, deadzone 60-68), moved by `LpcFormantShifter`
(`vowelFormant.h`, LPC spectral-envelope) — `GrainFormant` is inert
here. `SibilanceDetector` crossfades toward dry (up to 85%) during
fricatives/consonants, not yet by-ear verified. `[[memory:
lpc-formant-shifter-history]]`.

**Splice-path upward-shift**: `upshiftTargetLag()` raises target lag on
upshifts so periodic resplice fires upward too (`scale>1.02`
forced-grain override removed). Residual degradation at high shifts
(~2.21 ratio at +12 semitones) is confirmed PSOLA legitimately
restructuring harmonic material, not an artifact. `[[memory:
multitranspose-investigation-history]]`.

**Disclosed, unfixed: upward shifts ≥+18 semitones produce audible
clicks** (`tools/dsp-cli/bisect-glitch-threshold.js`, threshold=0.15).
Clean -24..+17 up, -24..-12 down; ratio-dependent not
absolute-pitch-dependent. Root cause inside `soladSnacOctaver.h`'s
resplice-trigger/crossfade-length interaction at large `m_scale`.
`[[memory: multitranspose-investigation-history]]`.

**`pitchtracker.lv2` accurate below 500Hz, unreliable above** — the
guitar/bass/vocal range this is played in is accurate; 3/16 test files
≥500Hz are genuinely wrong (octave-down locks), deliberately unfixed
(compile-time-cliff side). Internal zero-crossing fallback (used only
when `pitchtracker.lv2` isn't loaded) can take >400ms and drift
non-monotonically — no timing-heuristic fix inside `multitranspose.dsp`
itself. `[[memory: multitranspose-investigation-history]]`, `[[memory:
faust-compile-time-cliff]]`.

**One shared SNAC period tracker serves all 6 voices**
(`snacPeriodTracker.h`, bit-identical to pre-refactor); `reengage()` on
a shared-tracker voice INHERITS the locked period. The step MUST stay
phase-aligned with the engine's per-block cadence — misalignment
silently degraded tremolo/AM material. `[[memory:
multitranspose-investigation-history]]`.

**Compile-time-cliff discipline**: new UI primitives inside
`multitranspose.dsp` itself risk unbounded real-`faust` compile time
regardless of DawDreamer JIT results — declare elsewhere
(`effects_runtime.dsp`), thread as signal arguments. `[[memory:
faust-compile-time-cliff]]`.

**Verification**: DawDreamer's JIT can't compile this file or
`pitch.dsp` (`ffunction` limitation) — `real_audio_cross_verify.py`
shells to `multitranspose_harness.cpp` (tests the shifter engine only,
not the tracking/lock state machine). `verify_highoctave_transient.py`
is a **broken gate, pre-existing on `main`, disclosed not fixed** —
still calls the impossible JIT path; `test-pitch-tracker` is red on
every push touching this file. `tools/dsp-cli` (below) closes the gap:
real local `faust -lang cpp` + MSVC compiling this file's ACTUAL
tracking/lock state machine against real corpus audio in ~1-2s —
prefer it over hand-porting C++ reference logic for future control-rate
bugs. `[[memory: multitranspose-investigation-history]]`.

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s
`dubfx_pitch_tick` `ffunction`, ADR-004): SNAC tracker on a 1024-sample
window + solad delay-line PSOLA shifter (resplices by an INTEGER
MULTIPLE of the detected period) + independent formant grain stage
(`grainFormant.h`) — same class `multitranspose.dsp`'s 6 voices run,
the only splice/PSOLA implementation in the codebase (0.99-1.00 THD to
5000Hz clean sweep).

Key values: `INITIAL_READ_OFFSET_DEFAULT=64` samples (1.3ms delay);
`m_respliceFrac=1.0`; splice search matches value+slope among
integer-period candidates only; `triggerSpliceByPeriod` jumps whole
periods plus a `per*0.9` cooldown; `reengage()` seeds
`kReengageSeedPeriod=600.0f` (~80Hz, avoids half-period bias);
sinc-kernel phases normalized to unity DC gain; crossfade EQUAL-GAIN
LINEAR (not cosine — correlated readers), its LENGTH divided by pitch
ratio on upward shifts (divisor clamped ≥1.0 so downshift/unity stay
bit-identical). `m_transientHold` holds resplicing ~2 grains
post-transient; `m_envSlow<0.004` clamps the reader with no splice.
`DL=32768` (128KB/ch ring — 131072 corrupts on the Pi's 32-bit-pointer
build). `MIN_PERIOD=48` (1000Hz ceiling — 32 degrades pitch accuracy).
`DUBFX_BS=64` (`DUBFX_POLY_BS=16` poly path). Every tunable is at its
measured optimum. `[[memory: free-transpose-engine-history]]`.

**Open, disclosed bug**: SNAC period-tracker drift on tremolo/AM
content — `detectPitchStep()`'s anti-jitter clamp forces a slow climb
toward a wrong subharmonic rather than rejecting it. Steady content
unaffected; tremolo/dynamic content still reproduces the drift,
unfixed. `[[memory: free-transpose-engine-history]]`, `[[memory:
cold-start-self-trap]]`.

`pitch.dsp`'s `ffunction` rides params on the SAME per-sample call as
the audio sample (separate call site would let Faust constant-fold them
away); buffers exactly `DUBFX_BS=64` samples/`processBlock`, a
permanent 1-block (~1.333ms) algorithmic latency while engaged
(working-rule carve-out).

**Shared, both engines**: `reengage()` calls `m_grainFormant.reset()`
and restores the formant glide, so a new note never inherits the
previous note's free-running grain-clock state.

## `pitchtracker.lv2`: standalone autocorrelation pitch tracker

`effects/pitchtracker-src/pitchtracker_ac.dsp` — separate compilation
unit (compile-time-cliff constraint), own LV2 bundle
(`pitchtracker-lv2` job), hosted via `Lv2Host pitchTrackerFx` (default
`/effects/pitchtracker`). Normalized-autocorrelation with local-maximum
peak selection (rejects harmonic/subharmonic false locks) and a
`holdLastGood`/`energyReady` onset gate (~35-40ms hold, signals "no
reading yet" via `extFreqDet>0.5`). Immune to the broadband-burst/
plosive octave-search failure the old zero-crossing tracker had. Must
be deployed to `/effects/pitchtracker/pitchtracker.lv2/` for
`multitranspose.dsp` to use it.

## DawDreamer and `tools/dsp-cli` verification harnesses

[DawDreamer](https://github.com/DBraun/DawDreamer)'s `FaustProcessor` —
real Linux `libfaust` LLVM JIT with `compile_flags` passthrough (`pip
install dawdreamer`; `test/faust-flags/` is a committed example). JIT
refuses to link `ffunction`-declared externs (`dubfx_pitch_tick`) —
harnesses stub `pitch.dsp` to a bare passthrough. Parameter list is
alphabetical, not declaration-order — match by name via
`get_parameters_description()`; `set_automation` applies at the next
64-sample block boundary. Faust constant-folds `tan()`/`pow()` of a
literal at compile time — sweep with a real runtime `hslider`.
`df.box.boxFromDSP`/`boxToSource` (inside `with df.FaustContext():` —
SEGFAULTS without it) is the compile-time-cliff bisection reproduction
(95-500+ real seconds/iteration, cheaper than CI). Warm delay-line files
~90000 samples before measuring. `faust2bench` is the CPU A/B
counterpart — run manually only (20 runs, `-bs 64`, `git stash` A/B same
tree), never wired into critical-path CI. `[[memory:
ci-build-pipeline-history]]`.

`tools/dsp-cli/build.bat <repo_root> <dsp_file> [-I flags]` compiles ANY
`.dsp` with the real local `C:\Faust\bin\faust.exe` + MSVC to a
standalone `dsp_cli.exe` in ~1-2s — no CI/Docker/Python. Real offline
`-lang cpp` + ordinary link (never JIT) compiles files DawDreamer
categorically cannot: anything pulling in an `ffunction` extern
(`multitranspose.dsp`, `pitch.dsp`), since both FFI headers are
header-only. `--gen0 wav:<path> --gen1 step:...` drives real corpus
audio on one channel while scripted step/silence automation drives
others (needed for tracking/timing state machines). `--list-zones`/
`--stats` round out inspection. See `tools/dsp-cli/README.md`.

---

# LV2 hosting

`Lv2Host::instantiate()` must pass a real, NULL-TERMINATED
`LV2_Feature* const*` (`static const LV2_Feature* const kNoFeatures[] = {
nullptr };`), never a bare `nullptr` — Faust's generated `lv2.cpp` does
`for (int i=0; features[i]; i++)` with no null-check on `features`
itself. Wrap `instantiate()`/`activate()` in the same sigsetjmp
crash-isolation watchdog `runOne()` uses (ADR-002) — a load-time crash
is as untrusted as a runtime one.

`readTtl()`'s bundle match must strip trailing slashes (lilv's resolved
path carries one, `bundlePath` never does — a raw prefix compare
silently and permanently fails, falling back to a no-port-wiring
`.so`-only path with the crash watchdog disabled). `setControl` matches
Faust's MANGLED port symbol (`mangleFaustLabel(rawLabel) + "_"`, prefix
match — Faust turns non-alnum chars to `_` then appends
`"_<portIndex>"`, e.g. `fx2/FLANGEAMT` → `fx2_FLANGEAMT_3`). Verify new
targets against the deployed bundle's `.ttl` (`grep lv2:symbol *.ttl`)
— exact-symbol matches nothing, permanently, silently.
`Lv2Plugin::descriptor` is cached at `instantiate()` time, never
re-resolved on the RT block path.

`aloop.lv2` must be excluded from apkovl packaging — `home-fx-lv2` job
compiles `dsp/aloop.dsp` (same source `faustHome` compiles natively)
purely as a CI packaging-reproducibility check (ADR-003); deployed
alongside `guitar_lofi_fx.lv2` it'd run the whole home stack twice.
Excluded by name in `lib-boot-tree.sh`.

## Resonode: separate, conditionally-called LV2 bundle

`effects/home/faust/resonode_synth.dsp` — pulled out of the always-on
Faust graph (a real ~2ms idle `readi` gap, no runtime branching) into
`resonode.lv2` via a dedicated `Lv2Host resonodeFx` (`/effects/resonode`);
`.process()` only called when `fx/resonode/engaged` reads true.

**Architecture**: per-voice `note`/`gate`/`vel` are LV2 control ports,
updated per control-tick from `ApcGrid`'s MIDI handlers.
`effects_runtime.dsp` takes one audio-rate `resonodeIn`, zeroed (not
passed-through) when engaged with no plugins loaded — silence is the
correct degraded state, unlike `homeFx`/`userFx`'s dry-passthrough
default. Guitar/lofi-fx run as an INPUT stage before
`faustHome.compute()`; Resonode's exciter is fed from that same
post-guitar/lofi-fx signal, output re-enters the crossfade BEFORE
`microStage:filterStage:delayStage:reverbStage`. Locked pitch REPLACES,
never layers over, the original. `RESONODE_ENGAGED`'s zone is written
directly via `fui.set()` in the worker loop, NOT through
`targetToZone`/`resolvedControls` — TWO real consumers (C++ process-gate
+ Faust crossfade checkbox); any control gaining a second consumer
needs both write paths audited.

**DSP mechanism**: 6-modes/voice, 4-voice physically-modeled resonator,
excited ONLY by live mic ("reactor mode" — silent input, held key =
exact silence). Exciter is a SHARED broadband highpass(60Hz)+lowpass
(tone); each mode's own resonant filter does 100% of frequency
selection. Strike envelope `en.adsr(0.004, 0.11, 0.09, 0.25, xgate)`.
**`couple`** (knob 7): nearest-neighbor mode coupling via one `letrec`
block, skew-symmetric energy exchange on peak-normalized states,
hard-clamped ±8 (over `tanh` — identity below threshold, provably).
Verified against real recorded excitation (12/12 configs
finite/unclipped). `[[memory: resonode-exciter-coupling-cpu-history]]`.

**16 modes** (of 24-entry tables), five named ratio tables blended by 5
hsliders, shared across 4 voices. `modeCount` capped by real CPU cost
AND a Faust compile-time ceiling (24 modes kills `faust` via SIGALRM
~2min). Shipped: zero gaps idle; 8-key stress 34-73% peak/0-2 gaps;
worst combined case 80% peak/3 gaps, zero xruns. `[[memory:
resonode-exciter-coupling-cpu-history]]`.

**Named sweetspot patches** (`kResonodePatches`, knob slots 1-4, from a
real DawDreamer grid search; `collision` hand-set):

| Patch | position | decay | damping | stretch | collision | character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp transient |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s ring, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s ring, harmonic |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass |

Knobs 5-7: tone brightness (log taper), level, `couple` (linear 0..1).
`[[memory: resonode-exciter-coupling-cpu-history]]`.

Per-voice structural modulation (fixed internal constants, no free
knob-bank slot): `positionDriftEnv` starts each voice brighter at the
strike, decays to the patch's `position` over ~350ms (fixes "sounds
static over its own decay"); `stretch` gets per-note sample-and-hold
jitter (`stretchJitterAmt=0.02`) latched at `attackEdge`. `bassBoost`
gives the fundamental up to 1.35x gain below 220Hz. `aliasGuard` fades
any mode crossing the top 5% of Nyquist to silence. `collision` (0..1,
per-patch) is a bounded `ma.tanh` waveshaper before summing. Pitch-mod
adds a small (~44 cents max) onset bump on attack/steal. Morph knobs
glide via a `letrec` one-pole that SNAPS on `ba.time==0`, glides only
later.

**Disclosed, not addressed**: mono in/out, matching the mono
end-to-end aloop path — real stereo diffusion needs a dedicated
audio-thread architecture change.

**Defense-in-depth**: a NaN/Inf guard at the C++ call site
(`audio_thread.cpp`, right after `resonodeFx.process()`), independent
of the DSP-level `coupleFeedback` fix — zeroes the block, logs a
rate-limited (max 1/s) wall-clock-timestamped `[diag-resonode]` line on
any non-finite sample. Keep even after any future coupling fix
(ADR-002 pattern).

**`ApcGrid::bindAll` must `ps.bind()` every internal flag a C++ path
later `setByName`s** — silent no-op otherwise. Real incidents:
`fx/resonode/engaged`, `fx/resonode/collision`,
`cmd/halfspeed`/`cmd/doublespeed` (routed only through
`config/controls.conf`'s generic fallback — grep the config file too).

## `config/controls.conf` regression guardrails

`cmd/halfspeed`/`cmd/doublespeed` must stay bound as `note70`/`note71`,
never `cc70`/`cc71` — the real APC Key25 sends NOTES 70/71 on channel 0
(`apcKey25.cpp:142-143,187-188`), not CCs; a `cc70`/`cc71` binding
matches nothing the hardware transmits. `note91` must never be
(re-)bound to `cmd/clearall` — a live binding there races `ApcGrid`'s
shadow-state reset (a PLAY press during a SHIFT-held gesture could wipe
DSP loop content while shadow state stays stale); `midi.cpp`'s note-91
intercept is unconditional on shift to prevent this.

## delayverb: separate, conditionally-called LV2 bundle

`effects/delayverb-src/delayverb.dsp` extracted into `delayverb.lv2`
(`delayverb-lv2` job), compiled in two halves (`aloop_pre.dsp`/
`aloop_post.dsp`) around it — both stages were fully unconditional and
ran TWICE (cue + master paths) regardless of DELAYAMT/REVAMT;
`audio_thread.cpp` now calls `.process()` only on whichever instance
has a meaningfully nonzero amount. Build container needs
`libboost-dev` (`lv2.cpp` uses `boost/circular_buffer`).

## Tracktion Engine — evaluated and REJECTED, do not re-open without new evidence

Disqualified: two ALSA devices with different buffering aren't
expressible in `AudioDeviceManager`'s one-device/rate/buffer/callback
model; per-core `pthread_setaffinity_np` pinning would fight
`tracktion_graph`'s own thread pool; the 1.333ms budget makes DAW-graph
plugin-delay-compensation an unprovable regression risk without real
hardware. Also pulls in `juce_gui_extra`/X11/freetype on a headless
device, GPL/Commercial licensing. **Higher-leverage alternative**:
folding `guitar_lofi_fx.lv2` into Core-3 Faust natively would retire
`lv2_host.{cpp,h}`/lilv/the crash watchdog/the cross-compile job with
no new dependency/latency risk — confirm `/effects/user` (the
swappable user-LV2 extension point) is genuinely unused first.

---

# Control surface (`src/control/apc_grid.cpp`)

Every momentary Faust gate must be explicitly released or it sticks at 1
forever: `looperN/erase` (`wipe=max(clearAll,eraseN)` gates ring
recirculation — a stuck erase silently wipes playback forever while
recording still works; `pollHolds` releases after ~50ms),
`looperN/finishreq` (same shape), `cmd/clearall` (genuinely HELD —
note-on sets, note-off releases). `rec` is a persistent `ParamStore`
value — `applyRecPlayCycle` sets `rec=0` on FINISH or it re-records
live input forever. Per-looper cycle: empty → ARM (`rec=1`) → FINISH
(`rec=0`, `play=1`) → pause (`play=0`) → resume (`play=1`); **ARM/
FINISH fire on PRESS**, pause/resume on release. CLEAR_ALL zeroes both
`play`/`rec` in Faust, not just C++ shadow state; `onStopImmediate`
also zeroes `rec` for a mid-recording abort. `m_masterLenSamples`/
`cmd/master_len`/`cmd/recorded_bpm` reset to 0 whenever the last looper
with content is erased, from any path.

**Master phrase length comes from `writeIdx` telemetry, never
wall-clock** — `deriveTempoQuant` proposes a BPM to Link only, never
resizes `m_masterLenSamples`; read `snapshotTelemetry().looperWriteIdx`.

**Quantization is powers of 2 only, always the CEILING** — a recording's
raw duration snaps to a power-of-2 subdivision/multiple of the master
phrase (`kMaxLoopSamples` top, M/16 bottom via `lowerExp` floor -4.0);
`bestLen=upperCand` always rounds up, never truncates. Every looper's
`wrapLen` is a power-of-2 ratio of every other (drift-free repeat
alignment). `verify-quantization.js`'s `ceilingPow2Candidate` matches
this.

**Content phase-anchor**: every loop plays back anchored to a shared
`masterPhase` grid, never a per-take offset. Recording start is
PHRASE-TOP quantized (RC-505-derived): `armEdge` for a non-first looper
fires only on `masterPhaseWrapped` (`masterPhase < masterPhasePrev`,
the top of the shared master phrase) — every looper anchors to the SAME
reference beat, not merely its own nearest beat (loop 1 arms instantly,
no grid exists yet). **Backdating grace window**: real MIDI/human press
timing cannot hit a phrase-top sample-exact, so a press up to
`kArmBackdateGraceSamples` (2400 = 50ms @ 48kHz) AFTER the most recent
phrase-top arms IMMEDIATELY on that press, backdated to the phrase-top
just passed (`samplesSincePhraseTop` tracks elapsed samples since the
last wrap; `rsmNext` still captures the real `masterPhase` at armEdge,
so a backdated arm correctly encodes "this content starts N samples
into the phrase," not exactly at 0) — a press outside the grace window
waits for the NEXT phrase-top as before. `cycleOffset` accumulates
`+masterLen` per wrap, reset at `armEdge`. `wrapLen=
gridMultiple*anchorGridLenNow`, `gridMultiple` always a ceiling.
**Known, disclosed edge case**: `winSamples`/`xfSamples` can freeze at
floor on a true zero-context cold start (gate rising at the DSP
instance's very first sample) — doesn't matter in real performance,
unfixed (compile-time-cliff risk). `kArmBackdateGraceSamples` is a
first-pass value, not yet by-ear tuned on real hardware. Commit lineage
(including a superseded "nearest beat, not phrase-top" design and the
same-sample arm-pulse off-by-one this replaces): `[[memory:
control-surface-quantization-history]]`.

**First (master-length-establishing) recording's tempo/beat-count
comes from a real synced Link tempo when one exists, never a
duration-only guess** — when `link->audioRead().synced && bpm>1.0` at
FINISH, `recorded_beats=round(recordedSeconds*bpm/60)` and
`recorded_bpm` is that real bpm directly, skipping `proposeTempo`;
`deriveTempoQuant`'s power-of-2 heuristic remains fallback-only for
no-tempo-reference cases. Mirrors the non-first-looper FINISH branch's
own `tempoScale` pattern. Bug history: `[[memory:
control-surface-quantization-history]]`.

**Real APC Key25 hardware re-sends note-on for an already-held pad** —
`onPadPress` tracks `m_looperHeld` per pad, treats a repeat as a no-op
(same for `onLofiFxPress`, edge-triggered via SHIFT rather than
hold-duration timed for this reason). **Guitar-fx held REDIRECTS
looper pad presses** to `onSidechainLooperToggle` (one-shot
sidechain-source toggle, not ARM/FINISH) while `m_guitarFxHeld` —
auto-clears when that looper's content is wiped.

## LofiFx/granulator button — SHIFT disambiguates the two gestures (note 69)

Both fire instantly on PRESS: plain tap toggles
`m_granulatorLatched`/`setGranulatorEnabled`; SHIFT+tap toggles
Resonode engage (forces the granulator latch off — Resonode always
wins; disengaging releases every held Resonode voice). Every press
switches the active knob bank to LofiFx; reverts on release only if
Resonode is NOT engaged. While Resonode is engaged the keybed drives 4
Resonode voices via `Lv2Host::setControl` to
`fx/resonodevoice{v}/{note,gate,vel}` (genuinely skipped when
disengaged, unlike `multitranspose.dsp`'s 6 always-on voices). LED:
blinking red = Resonode engaged, solid green = granulator latched.

LofiFx latches permanently on press (matching Dub/Guitar), no
revert-on-release. `m_lofiShiftMode` selects the knob page: plain =
granulator (bitcrush + 4 named patches + 3 direct dials), SHIFT =
Resonode (bitcrush + 4 named patches + tone/level/couple).

## Granulator (`src/dsp/sampler/sampler.h`) — 4 named patches + 3 direct dials

C++ (not Faust): 7 underlying params (`grainMs`/`grainRateHz`/
`pitchSprayCents`/`posJitterMs`/`scanRate`/`reverseProb`/`envShape`),
`MAX_GRAINS=48` shared across 16 voices, cubic-interpolated reader.
`scanRate=0` freezes scan; negative `rate`/`reverseProb` plays
backward; `envShape` morphs Blackman→Hann→percussive attack-decay,
LUT-cached double-buffered. Direct dials (knobs 5-7) override the
corresponding patch-blended field only once touched
(`m_lofiFxKnobTouched[5..7]`): Scan/Freeze (0-3.0, 0=frozen, 1.0=normal,
3x=fast-forward), Density (log taper 2-200Hz → `grainRateHz`), Pitch
Scatter (0-1200 cents linear). `kGranPatchCount=4` (down from 6).
`[[memory: granulator-investigation-history]]`.

**48-grain pool is budgeted PER VOICE, never exhaustible** —
`_recomputePerVoiceGrainBudget()` divides the pool by active voice
count per block, `_spawnGrain` refuses to exceed its share
(`_stealMostFinishedGrainSlot()` structurally unreachable). Gain
compensation tracks the BUDGETED spawn period, not requested overlap —
level flat within 0.5dB regardless of voice count (removed an
accidental -43dB limiter at 16 held keys, so downstream headroom now
genuinely matters at that extreme). `MAX_GRAINS` deliberately NOT
raised (4x pool = 4x worst-case per-grain CPU). `[[memory:
granulator-investigation-history]]`.

**Grain pitch can be quantized to musical intervals** (Octaves/Fifths/
Minor Triad/Minor Pentatonic beside continuous `pitchSprayCents`) at
zero CPU, `std::atomic<int>`. Knob 7 segmented (`v01<=0.5` continuous
spray, above selects the four interval sets in equal quarters) —
untouched knob 7 leaves prior behavior exact.
`kGranPitchContinuousSprayMode` in `apc_grid.h` duplicates the enum's
zero value — `static_assert` in `apc_grid.cpp` fails the build if the
two drift.

`Voice::grainNextPeriod` applies `kGrainTimingJitterAmt=0.15` (±15%)
random deviation per grain-fire — keeps the spawn clock from reading
mechanically regular (matches Resonode's own internal-constant jitter
convention). `kGranPatches[0]` (fallback default) is the
90ms/35Hz/25-cent-spray/35ms-jitter patch, deliberately textured.
`[[memory: granulator-investigation-history]]`.

**Considered, not implemented**: an ambient background voice with no
held key — two real blocking bugs identified (`Sampler::ROOT_NOTE=60`
sits inside the drum-key range; `_noteOn`'s same-note release logic
would kill the ambient voice the first time that note is played
manually). Needs a dedicated non-keybed-reachable voice slot or
explicit re-arm, neither exists today.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching
8-knob banks selected via `ApcGrid::onFxKnobCC` on
`m_activeBank`/`m_shift`. `kFxKnobCcNumbers = {48,49,50,51,54,55,57,53}`
(CC53 double-duties as Formant on Dub only):

| Page | Regular (knobs 1-7) | Shift |
|---|---|---|
| Dub | `fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant | dance-gate+LFO: `fx/dubgate/{amt,pattern}`, `fx/dublfo/{rate,depth,shape,target,phase}`, tempo-synced via `fx/dubgate/clockphase` off the shared 4-beat clock |
| Guitar | `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}` (shared `BANKSPEED` LFO), CC53=`fx2/GATEAMT` | 8-dial dual-ADSR bank for the Sampler engine (filter-cutoff + amplitude envelopes), writes straight into C++ `Sampler`, no Faust/LV2 targets |
| LofiFx | knob0 `fx2/BITCRUSHAMT`, knobs1-4 named-patch weights (granulator or Resonode per `m_lofiShiftMode`) | knobs5-7 direct dials |

`compressor.dsp` stays in-tree unreferenced (`ab_fm_def.py`'s fast-math
test uses it). `samplerate.dsp`/`mixbus.dsp`/`gateStage`'s multi-pattern
select/`SRRAMT`/`rawGlitchTap` removed as confirmed-dead. `chain.dsp`
is NOT dead — `home-fx-lv2` builds it as a packaging check.

**Groove shuffle**: the 4 metronome-flash pads (notes 15/23/31/39) are
also shuffle buttons, routed to a 4-bit `fx/shuffle/mask`. True
retrigger/reorder, not swing/groove-offset — a continuous-perturbation
offset reads as a "double-tap" from re-reading already-played content,
so this stays whole-beat, block-boundary only.
`kShiftReorderTables[mask]` (15 hand-verified-distinct 4-entry
sequences) structurally eliminates the double-tap mode. Runs on its
own free-running `shuffleClockSamples`, added on top of the real
`masterPhaseSamples+i` ramp.

`dsp/loop.dsp` varispeed has NO deadzone — `varispeedActive = effSpeed
!= 1.0` (exact-equality) — a deadzone would discard small Link-tempo
mismatches, causing steady phasing between loopers of different
lengths. `resyncCoeff` is gated to `0.0` whenever `|effSpeed-1.0|>0.3`
so it never fights a manual half/double-speed press. **Both
beat-shuffle's hard clip and varispeed's instant speed jump are
INTENTIONAL** (explicit user direction) — don't smooth either without
confirming a report is about a genuinely distinct defect, not the
intended abrupt transition.

`microrepeat.dsp`'s `sliceBlocks = max(1, int(beatBlocks/divSafe))*2`
with `divSafe=max(1,DIV)` (multiplies the already-computed slice
length, never halves the divisor first — floor-collides `div=1`/
`div=2` at `int(1/2)=0`). `mode2`/`mode3`/`mode4`'s damping exponent is
strength-reduced from `pow()` to literal integer multiplies
(bit-exact).

CC53 formant: deadzone 60-68, `((data2-64)/63.0)*1.5` (clamped by the
`-3..3` hslider). SHIFT must never change a knob's own behavior —
reserved exclusively for the native fold/resample gesture (direct user
direction).

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a
completely different USB role (peripheral/gadget vs. host mode on the
USB-A ports a flash drive plugs into).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring
(5s). `audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(),
N)` every block, next to `g_sampler->captureBlock(...)` — same post-fx
tap point. Single-atomic-counter SPSC ring (`std::atomic<uint64_t>`
write/read counters) that NEVER blocks/allocates — if the consumer
falls behind, `pushBlock` advances the read counter itself (drops
oldest samples, increments an overrun counter).

**Control side**: all file I/O happens in `UsbRecorder::poll()`, called
from `main.cpp`'s 5 Hz control loop — deliberately NOT a dedicated
pthread. Chunks are fixed-size, cyclically `O_TRUNC`-reopened, so the
ring bounds disk usage by construction. Mount detection is a `stat()`
device-id comparison (`isMounted()`), not `/proc/mounts` parsing.

**Config**: `[storage]` in `config/aloop.conf` — `usb_record`,
`usb_mount_point` (default `/media/aloop-usb`), `usb_chunk_minutes`
(10), `usb_chunk_count` (6). `effectiveChunkCount()` shrinks the ring
for smaller drives via `statvfs`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`usb-automount-setup.sh` (local.d bootstrap, APPENDS to
`/etc/mdev.conf`, never overwrites, does its own explicit coldplug pass
since `local.d` runs AFTER `mdev -s`'s sysinit scan). Mount attempts: no
`-t` first, then explicit `vfat`/`ext4`/`exfat`/`ntfs`. **exFAT/NTFS
userspace tools are almost certainly NOT in the minimal Alpine RPi
tarball** — only kernel-native FAT32/ext4 expected to work without
further vendoring. UNVERIFIED on real hardware, along with mdev.conf
rule syntax and real USB-drive enumeration. Both scripts are registered
in BOTH `_exec_paths` and `_nb_exec_paths`.

---

# Faust Libraries reference

Faust Libraries is the standard DSP library collection for the Faust
language — documents the libraries only, not compiler flags (see the
Faust DSP section above; flag reference is
[faustdoc.grame.fr/manual/optimizing](https://faustdoc.grame.fr/manual/optimizing/)).
Prefer Markdown sources over built HTML: [libs index](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/libs/index.md),
[standard functions](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/standardFunctions.md),
[overview](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/organization.md),
[libs folder API](https://api.github.com/repos/grame-cncm/faustlibraries/contents/doc/docs/libs).
HTML equivalents: [libs](https://faustlibraries.grame.fr/libs/),
[standard functions](https://faustlibraries.grame.fr/standardFunctions/),
[motion functions](https://faustlibraries.grame.fr/motion_functions/).
