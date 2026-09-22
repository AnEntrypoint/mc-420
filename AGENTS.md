# aloop — technical constraints reference

Durable constraints for this codebase and its build/deploy pipeline. Real Pi 4
device: `192.168.137.100`, root/aloop. Real Pi 3B+ debug device reaches the
host via netboot (`.netboot-serve-pi3/`, `[[memory: project-pi3-netboot]]`).
Read before touching the device, the DSP, or the image/netboot scripts.

This file is a lean, current-state operational reference — hardware facts,
build/deploy procedures, current shipped architecture, working rules, and
currently-open/disclosed bugs. Long-form multi-session investigation history
(rejected designs, session-by-session debugging narration, superseded
measurements) lives in the auto-memory system
(`~/.claude/projects/<project>/memory/`); `[[memory: ...]]` pointers below
point at that context whenever a "why not X instead" behind a current value
matters. This file itself is re-compacted whenever it exceeds ~30KB — see
`~/.claude/CLAUDE.md` invariant 3 — draining fresh narrative to memory each
pass; if a value here lacks a memory pointer, no narrative was owed.

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

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD` env var:
`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`). `boot_tree_apkovl` (binary,
LV2, services, vendored libs) is 100% shared/unconditional. Only
`boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config` (boot
cmdline/USB-gadget config) dispatch per board.
`board_supports_usb_gadget`/`board_wifi_irq_name`/`board_firmware_names` in
`lib-boot-tree.sh` are the authoritative capability source, not this table:

| Board | SoC | Boot chain | USB-audio gadget | WiFi chip |
|---|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711, quad Cortex-A72 aarch64 | Pi firmware, FAT partition | dwc2 peripheral — real UAC2 gadget | Broadcom brcmfmac |
| pi3 | BCM2837, quad Cortex-A53 aarch64 | Pi firmware, FAT partition | none — no OTG-capable controller | Broadcom brcmfmac |
| pi5 | BCM2712, quad Cortex-A76 aarch64 | Pi firmware, FAT partition | none — RP1 southbridge USB is host-only | Broadcom brcmfmac |
| opi-prime | Allwinner H5, quad Cortex-A53 aarch64 | Armbian U-Boot (raw SD sectors) + ext4 root + extlinux.conf | unproven | Realtek RTL8723BS |

**Pi 3B+ ships network boot ENABLED from the factory** (no OTP write needed,
unlike plain 3B/CM3/3A+); ROM boot order is SD (if `bootcode.bin` present) →
USB → Network, so "prep the SD for netboot" means wiping the card, not
writing to it. `[[memory: project-pi3-netboot]]` for the full setup history
and `[[memory: feedback-verify-before-irreversible-hw]]` for the process
lesson (WebSearch hardware-OTP claims before any irreversible action, even
after the user has already picked an option).

## Orange Pi Prime specifics

SoC is Allwinner H5 (64-bit Cortex-A53, not H3) — Alpine's existing aarch64
packages apply directly. **USB-audio-gadget mode is UNPROVEN**: H5's MUSB
dual-role controller is on the micro-USB OTG port only, the 3 USB-A ports
are host-only EHCI/OHCI. `board_supports_usb_gadget` returns false for
`opi-prime`; fallback is the board's built-in 3.5mm analog codec as a
normal ALSA HOST device.

**Boot chain is structurally incompatible with the Pi's FAT-partition
model** — Allwinner's BootROM reads a raw SPL/U-Boot image at a raw SD
sector offset before any partition table exists. `boot_tree_fetch_opi`/
`boot_tree_config_opi` download Armbian's `dl.armbian.com/orangepiprime/
Trixie_current_minimal` stable redirect URL (never a resolved
`github.com/armbian/community/releases/...` asset URL), read the real
partition table via `sfdisk` (never a fixed-offset assumption), extract
the pre-partition-1 region as the U-Boot blob, loop-mount the ext4 root
for kernel/dtb/initrd. Writes `/boot/extlinux/extlinux.conf` with the same
isolcpus/RT cmdline as the Pi boards' `cmdline.txt` (a defensive fallback —
Armbian's own compiled `bootcmd` on this board sources `/boot/boot.scr` by
fixed filename directly, ignoring `extlinux.conf`). `build-image.sh`'s
`opi-prime` branch needs real root (`sudo losetup`/`mount`) — CI or real
Linux host only, never Windows. **No netboot path** (BootROM requires
local U-Boot before PXE/TFTP is reachable) — `build-image.yml` skips
netboot-build/validate/SD-zip for `BOARD=opi-prime`. Full rationale for
each of the above (why the stable-redirect URL, why `sfdisk` not a fixed
offset, why extlinux.conf is fallback-only): `[[memory:
opi-prime-boot-history]]`.

`boot_tree_write_boot_scr_opi`'s address constants MUST match THIS U-Boot
build's own compiled-in defaults (`strings`-extracted, not generic
sunxi-common.h values): `kernel_addr_r=0x40080000`, `fdt_addr_r=0x4FA00000`,
`ramdisk_addr_r=0x4FF00000`, `loadaddr=0x42000000`, `scriptaddr=0x4FC00000`
— untested past `booti`'s handoff on real hardware as of this writing.
`earlycon=uart8250,mmio32,0x01c28000` is diagnostic (H5's real uart0 MMIO
base); `console=ttyS0,115200` is independently verified correct for this
DTB. WiFi is Realtek RTL8723BS — `kernel/rt-tune.sh`'s IRQ-steering matches
`rtl8723bs` alongside `brcmfmac`.

`build-opi-armbian-source.yml` pins Armbian's last pre-6.18 sunxi64
`current` kernel (checkout `armbian/build@be0bd46...`, verified to resolve
to 6.12) with two patch-time workarounds (unrelated-hardware series.conf
entries disabled; several Realtek USB-WiFi driver configs unset for a
`-Werror` build failure against 6.12's `cfg80211_ops` — not this board's
own `rtl8723bs` driver, which builds clean). Full patch detail: `[[memory:
opi-prime-boot-history]]`.

## apkovl assembly constraints

- **`boot_tree_apkovl` must stamp `.default_boot_services`** — Alpine's
  `rc_add modloop sysinit` gate needs it or `/lib/modules` stays empty,
  `/proc/asound` never exists, `/sys/kernel/config/usb_gadget/` can't be
  created (init removes the marker after reading it, one-shot).
- **`aloop`'s OpenRC service needs `rc_ulimit="-l unlimited -r 95"`**, not a
  `local.d` `ulimit` call — `rt-tune.sh`'s memlock ulimit runs in a
  transient subshell that never reaches the separately-started `aloop`
  process; `rc_ulimit` is read by `openrc-run.sh` immediately before exec.
- **`aloop`'s `depend()` needs `after local autoap`** — `aloop` opens
  Link's UDP multicast socket at startup; `src/main.cpp` also waits for the
  interface to carry an address before starting Link.
- **Vendor alsa-lib and the whole lilv stack as real `.so` files; never
  `apk add` at boot** — the device's reachable apk repo (~100 packages, no
  CDN fallback) has none of `alsa-lib`/`lilv-libs`/`serd-libs`/`sord-libs`/
  `sratom`/`zix-libs`. Real musl-aarch64 `.so`s live in `vendor/lib-aarch64/`.
  alsa-lib also needs its DATA tree (`vendor/share-alsa/`, ~340K) — without
  `alsa.conf`, `snd_pcm_open("default", ...)` segfaults in alsa-lib's
  config parser.
- **`hostapd`/`dnsmasq` must be vendored as aarch64 binaries**
  (`vendor/sbin-aarch64/`) — the tarball's repo lacks them and its
  `APKINDEX.tar.gz` can't be regenerated on Windows. `hostapd` also needs
  `libnl-3.so.200`/`libnl-genl-3.so.200` (`vendor/lib-aarch64/`). `dnsmasq`
  needs explicit `user=root`/`group=root` in `dnsmasq.conf` — vendoring the
  binary doesn't create the `dnsmasq` system user.
- **Every `cmdline.txt`/`extlinux.conf` APPEND write must stay a single
  line** — Pi firmware and U-Boot both read only line 1. Every writer
  collapses via `tr '\n' ' '` + `tr -s ' '`; `validate-image.sh`/
  `validate-netboot.sh` assert this by counting newlines.
- **Anything newly vendored needs adding to BOTH `tar --mode='+x'` lists**
  (`_exec_paths` in `lib-boot-tree.sh`, `_nb_exec_paths` in
  `build-netboot.sh`) — NTFS carries no Unix exec bit, `chmod +x` is a
  silent no-op on Windows (`[[memory: windows-host-constraints]]`). Read
  modes from `tar -tvzf` listings, never extracted files — a re-appended
  path legitimately appears twice; verifiers grep the LAST match.
- **The `find` calls building those lists must run inside the overlay
  directory** (`cd "$OVL" && find usr/sbin ...`) — against the caller's own
  cwd, `find` silently returns empty with no error, dropping matches with
  zero visible failure — a real ticker-AP outage class.
- **`core.autocrlf=true` corrupts shell scripts on this Windows clone** —
  `.gitattributes` forces `eol=lf` on scripts/configs. If a script behaves
  strangely on-device, `file path/to/script.sh` for "CRLF line
  terminators"; fix via `rm` + `git checkout --`.
  `[[memory: windows-host-constraints]]`.

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load.** A
`.so` built with host g++ dlopens with no discovery error, then fails at
load: `Error relocating .../foo.so: unsupported relocation type 7`. CI green
only ever means "x86_64 compiled". Pattern (`.github/workflows/
build-lv2.yml`): split `faust2lv2`'s stages — `faust -i -a lv2.cpp` emits a
self-contained `.cpp`; a `$HOST_CXX` compile+run of it emits `.ttl` metadata
(host-only); only the final `-shared .so` link targets the device,
cross-compiled in a real Alpine aarch64 container
(`docker/setup-qemu-action` + `docker run --platform linux/arm64
alpine:3.20`). Verify: `objdump -p foo.so | grep NEEDED` must show
`libc.musl-aarch64.so.1`, never `libc.so.6`. Pass `CPPFLAGS` into nested
`docker run ... sh -c "..."` via `-e VAR="$VAR"`, never string
interpolation (escaped quotes lose their escapes across the nested-shell
boundary).

**`actions/upload-artifact@v4` `path:` wildcard-vs-literal.** `path:
effects/home/*.lv2` (wildcard) preserves the matched directory's basename;
`path: effects/home/guitar_lofi_fx.lv2` (literal) flattens its CONTENTS at
the zip root, silently dropping the `.lv2/` wrapper. Always use the
wildcard form for LV2 bundle artifacts.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes
`audio_thread.cpp`'s worker skip `homeFx.process()`/`userFx.process()`
entirely — fully silent, no error, survives any `rc-service aloop
restart`. Always `grep -n disable_core3_lv2 /etc/aloop.conf` (anchored,
no leading `#`) before debugging "guitar/lofi effects don't do anything"
as a code bug.

---

# Deploy, netboot, SSH

**SSH: use a JS `ssh2` client, never Windows ssh.exe or sshpass**
(`[[memory: windows-host-constraints]]` — password auth root/aloop,
fastPut unreliability + base64/exec fallback, MSYS path-conversion). A
fresh netboot generates a new host key every boot, breaking raw
`ssh`/known_hosts but not `ssh2`.

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process**
(`config/aloop.conf`'s `[remote] token=`, `udp/4446`,
`src/control/remote_control.cpp`). If `aloop` has crashed, nothing is
listening and `image/aloop-reboot.js` silently does nothing — OpenRC's
`respawn_max=0` means it won't restart a crashed `aloop` either. If
`rc-service aloop status` shows `crashed`, use `node ssh-exec.js
192.168.137.100 "reboot"` instead. Always verify a reboot actually
happened before trusting any device-state observation: check `cat
/proc/uptime` and `md5sum /opt/aloop/aloop` against the deployed binary,
BEFORE reading logs.

## Netboot self-update: two rebuild paths

- **Automatic**: `image/serve-netboot-win.js` (elevated, needs
  `GITHUB_TOKEN`/`gh auth token` and `PI_TOKEN`) polls `build-binary.yml`/
  `build-lv2.yml`'s latest green `main` run every 30s, downloads artifacts,
  calls `image/build-netboot.sh` when the combined SHA changes. State in
  `.netboot-update-sha` (`<binSha>:<lv2Sha>`). **Blind to changes in the
  packaging scripts themselves** — neither workflow lists `image/**` in
  `paths:`; a packaging-script change needs a manual rebuild.
- **Manual**: `ALOOP_BIN=<path> LV2_DIR=<path> RESONODE_LV2_DIR=<path>
  PITCHTRACKER_LV2_DIR=<path> DELAYVERB_LV2_DIR=<path> OUT=.netboot-serve
  NETBOOT_SERVER=192.168.137.1 bash image/build-netboot.sh`. **All three
  `*_LV2_DIR` vars are mandatory** — `lib-boot-tree.sh` excludes those
  three bundles by name from the general `LV2_DIR` find; passing `LV2_DIR`
  alone silently ships none of them (warns on stdout, still produces a
  complete-looking apkovl). Prefer deleting `.netboot-update-sha` and
  letting `serve-netboot-win.js` rebuild. Verify: `tar -tzf
  .netboot-serve/aloop.apkovl.tar.gz | grep -oE
  'effects/[a-z]+/[a-z_]+[.]lv2' | sort -u` — expect delayverb,
  guitar_lofi_fx, pitchtracker, resonode.
- **Verify the deployed checksum after every manual rebuild, BEFORE
  rebooting**: extract `opt/aloop/aloop` from the fresh apkovl and
  `md5sum` against the source binary — a match proves SERVER state only,
  cross-check `/proc/uptime` for whether the device actually picked it up.
- **Any new LV2 bundle needs deploy wiring into BOTH `build-image.yml` AND
  `serve-netboot-win.js`** — grep both for every existing `*-lv2` artifact
  name before considering wiring complete. `[[memory:
  deploy-two-paths-lv2]]`.

**`build-netboot.sh` publish is a staged-directory atomic `mv`, never
`rm -rf` + populate-in-place** — a Pi can be actively TFTP/HTTP-fetching
mid-rebuild; the staging dir is a SIBLING of the real output dir (same
filesystem, atomic `rename(2)`), never under `mktemp -d`'s `$WORK` (often a
different mount, silently degrading the swap to copy+delete). The netboot
root must be `chmod -R a+rX`'d after copy — the Alpine tarball ships
`boot/initramfs-rpi` mode 600 and `cp -a` preserves it.

**Netboot silently outranks the SD card** — Pi 4 firmware prefers network
boot when reachable; a correct SD card can look like a broken fix while the
device fetches from a stale `.netboot-serve/`. Confirm which path booted
(`.netboot-serve.log`) and compare running binary md5 against the card's
before trusting any observation. `serve-netboot-win.js` can die holding its
`updateInFlight` guard, freezing state indefinitely.

**Netboot DHCP diagnosis** — three distinct failure signatures (dead
option-66 address with zero TFTP reads; DISCOVERs never becoming REQUESTs
from a wrong netmask/egress interface; a stale baked-in server IP that
stalls in initramfs after TFTP succeeds). `serve-netboot-win.js`'s
`ensureCorrectSubnetMask()` self-heals a wrong netmask on every startup.
Full diagnostic commands and root-cause detail:
`[[memory: netboot-dhcp-diagnosis-history]]`.

**Fast DSP-only iteration**: `node image/dsp-hotdeploy.js --target
home|guitar|both` — pushes a committed/pushed `.dsp` edit through CI's real
musl/aarch64 cross-compile, SFTPs the artifact onto a live device, restarts
over `ssh2`. Requires `gh` authenticated; fails loudly on non-`success` CI
or a non-`started` service after. **Stops the service BEFORE overwriting
`/opt/aloop/aloop`** — `sftp.fastPut` against a currently-executing
binary's inode fails with musl ETXTBSY (stop → fastPut → start, never
`restart`-after-write). Does NOT replace the netboot path for
`lib-boot-tree.sh`/`build-netboot.sh`/kernel/cmdline/OpenRC changes.

## CI runner, docker-step, artifact discipline

Cross-compilation runs on native `ubuntu-24.04-arm` runners (no QEMU
emulation needed). Docker build steps are split with per-command `timeout`
+ `set -x`, never one unbounded `sh -c`. All workflow artifacts ship
`retention-days: 3` (opi armbian image: 7). `build-image.yml` downloads
BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2` from the same green
`build-lv2.yml` run — a `workflow_run` trigger only carries its own run's
artifacts, and `home-fx-lv2` alone ships zero usable home-FX effects
(`aloop.lv2` is filtered back out by `lib-boot-tree.sh`;
`guitar_lofi_fx.lv2` is the wanted one). The rolling `latest` release
hard-gates on a real bundled aloop binary (`payload_check`) — stricter
than `validate-image.sh`, which only WARNS on a missing payload (a
legitimate structural-only build). The SD-card zip is extracted straight
out of the already-validated FAT image (same mtools offset view
`validate-image.sh` uses), skipped for opi-prime (no FAT partition). Full
incident history behind each of these: `[[memory:
ci-build-pipeline-history]]`.

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

`PHRASE_BEATS 64.0` in esp-idf-link is NOT the Link quantum — its own
transport-correction/SPP boundary. Host election is MAC-ordered (never
"host if scan found nothing" — that makes two cold-booting devices both
host, two isolated L2 domains). Both hold for a duration strictly monotonic
in their own MAC (lowest ≈0s, highest ≈6s), rescan every second, join the
instant a peer's AP appears; yield to a strictly-lower-BSSID AP but never
while clients are attached.

`src/net/autoap.sh`: must host `ticker`, never `aloop`; needs ≥1 active
`network={}` block in `wpa_supplicant.conf`; AP-mode rescan must not use a
naive `grep -oE 'ssid="[^"]*"'` (doesn't skip comments); **POSIX-clean**
(busybox ash — check `dash -n src/net/autoap.sh`); `start_ap()` must clear
a previous hostapd, not just wpa_supplicant (stale hostapd → `Match already
configured` → `Could not set channel` — that channel error is a red
herring, ch6 is a paired invariant, never "fix" by changing it).
`rc-service autoap status` reporting `started` is the real signal — a
`crashed` status with a plausible `ip addr` and no AP is exactly what a
broken AP looks like.

## Ableton Link integration checklist

`capture/commitAppSessionState()` from non-audio threads only,
`capture/commitAudioSessionState()` from the audio thread only — aloop
calls only App variants, hands the audio thread a lock-free
double-buffered `LinkSnapshot` (ADR-005, up to one control-tick stale).
`enableStartStopSync(true)` pairs with both reading `isPlaying()` and
calling `setIsPlaying()` (esp-idf-link only consumes). The three
notification callbacks run on a Link-managed thread — bounded
logging/atomics only, not RT-safe for more. `setTempo` rewrites tempo for
EVERY peer — `proposeTempo` refuses when peers are present and never sets
tempo itself. `kLinkQuantum`/`LINK_QUANTUM` (both `16.0`) move together.
Telemetry carries peer count (`status.json`'s `link.peers`/`link.playing`).
Interface readiness: `depend() { after local autoap; }` plus a bounded
`waitForNetworkInterface()` before `link.start()`. Audit any Link change
against `build/_deps/abletonlink-src/TEST-PLAN.md` (Ableton's official
12-case plan) — TEMPO-4's 20-999bpm range matched by both, `effSpeed`
clamps 0.1..8.0, AUDIOENGINE-1 onset-to-pulse alignment is unverified.

## Link varispeed and transport-anchor mechanism

`audio_thread.cpp` matches playback to session tempo by scaling read RATE
(`linkSpeedRatio = linkBpm/recordedBpm`, folded into `effSpeed`) — never a
read-position jump. `dsp/loop.dsp` advances `rposNext` by `speedClamped`
per sample, so `effSpeed>1` reads FASTER (a 100bpm loop on a 120bpm session
needs 1.2, not 0.833). Residual phase error is a BOUNDED SPEED TRIM
(`kLinkPhaseTrimPerSample=0.00005`, clamped `kLinkPhaseTrimMax=0.03` = 51
cents), applied to `effSpeed` only, never to the `masterPhaseSamples`
advance (that advance is the TARGET timeline and must track
`N*linkSpeedRatio*g_manualSpeedMul`). The trim is suspended while
`abs(g_manualSpeedMul-1.0)>0.3` so it yields to a manual half/double-speed
punch. Runs only while `linkVarispeedEngaged` (before any take,
`recorded_bpm` is unset and the ratio is legitimately 1.0 — trimming then
would saturate). `weOwnTempo` guards `proposeTempo` only, never the
varispeed ratio (stays true for the whole session after any recording).
`LinkBridge::setTransportPlaying(true)` anchors beat 0 via
`setIsPlayingAndRequestBeatAtTime(true, now, 0.0, kLinkQuantum)`, never a
bare `setIsPlaying` (stop path keeps the bare call — no beat to anchor).

Quick live check needing no recording: `/run/aloop/status.json`'s
`eff_speed` must read exactly `1.0000` with nothing recorded; 0.97/1.03
means the trim is saturating because the ratio isn't engaged. Design
rationale: `[[memory: link-varispeed-trim-history]]`.

## MIDI clock fan-out (`src/control/midi_clock.cpp`)

24 PPQN `0xF8` plus `0xFA`/`0xFC` to every hardware MIDI output except the
control surface's own. **No `/dev/snd/seq`** — enumeration walks
`/proc/asound/card*/midi*`, opens `hw:CARD,0,0` via `snd_rawmidi`, rescans
every 2s. Owns its own thread, derives every tick from
`LinkBridge::beatNow()`, never a local timer (neither `midi.cpp`'s 100ms
poll nor `main.cpp`'s 5Hz loop can carry 20.8ms/tick at 120bpm); catch-up
after a scheduling hiccup bounded to 4 pulses. The control surface is
excluded by the card the MIDI loop actually opened (`controlSurfaceCard()`),
not by parsing `midi_device` (normally the literal string `auto`). Waits
15s for the surface to be identified, releases any port later found to be
the surface (e.g. across a replug) — the clock racing the MIDI loop's
auto-scan can otherwise steal the surface's own Tx port. `[[memory:
mesh-link-midi-history]]`.

## Other Link/mesh facts

`pinLinkThreadsToControlCore` (`main.cpp`) walks `/proc/self/task`, matches
Link's internal threads by `comm` name, pins them to `kControlCore=2`
(matches `rt-tune.sh`'s `CONTROL_CORE`) — prevents Link's own
peer-discovery messages from contending with the isolated audio cores (a
~30-37ms/1Hz audio stall otherwise), adds no audio-path latency. `aloop.conf`'s `[link] enabled = true` must be
parsed as a word (`true`/`1`/`yes`/`on`), not `%d`. **Unproven**: whether
Link's multicast crosses the Pi's own AP/stations on Broadcom `brcmfmac`
(`ap_isolate=0` set, may be sufficient — do not port the ESP32's unicast
relay speculatively; `docs/LINK-MESH-TESTING.md` Tests 1-3).

---

# Audio thread and ALSA

`src/dsp/audio_thread.cpp`'s `worker()` opens two distinct PCM devices —
never conflate them: **instrument device** (default `hw:0,0`, e.g. M-Audio
AIR 192|4) — real tight-latency capture+playback, opened blocking, retried
30x/1s if not plugged in; **OTG gadget** (`f_uac2`, `hw:UAC2Gadget,0`) —
best-effort MIRROR, opened NONBLOCK so a missing host can never stall the
real path (`-EAGAIN` expected; any other negative return triggers a
one-shot recover; a permanently-gone device degrades silently).

Instrument device is **S32_LE only** — class-compliant USB interfaces like
the AIR 192|4 have no S16_LE fallback; requesting `SND_PCM_FORMAT_S16_LE`
returns success while the device negotiates S32_LE anyway (16-bit
normalization on 32-bit data = loud static). Buffer type `int32_t`,
normalization divisor `2147483648.0f`; negotiated format is read back and
compared, warning loudly on mismatch. The OTG mirror is genuinely separate
S16_LE — the two output paths need separate wire buffers in native formats.

Playback needs `start_threshold` lowered to one period
(`snd_pcm_sw_params_set_start_threshold(pcm, sw, period)`) — the hw_params
default is the full `buffer_size`, and this block loop writes only one
N-frame period per `snd_pcm_writei()` then blocks on the next capture read,
so playback stays `PREPARED` forever otherwise. **4 periods minimum** — 2
(256 frames, ALSA minimum) produces hundreds of xruns/sec on the instrument
PCM; the OTG mirror deliberately uses looser timing (period=4×N,
buffer=4× that).

`f_uac2-gadget.sh`: `req_number` must be **4**, not the kernel default 2 —
the default silently caps ALSA's negotiated `buffer_size` at 256 frames
regardless of `hw_params`. Gadget presents a STEREO wire (`c_chmask`/
`p_chmask=0x3`) — capture L/R averaged to mono for Faust, mono result
duplicated onto both playback channels; DSP stays mono internally. Runs
from `/etc/local.d` after `libcomposite` loads.

`main.cpp` declares `AudioThread` (hands its address to `runMidiLoop` for
VU telemetry) BEFORE `audio.start()` — safe only because
`snapshotTelemetry()` returns the default-constructed all-zero `Telemetry`
pre-`start()`; any future constructor change must preserve this.
Flush-to-zero must be set explicitly (`setFlushToZero()`, AArch64 FPCR FZ
bit via inline asm, SSE intrinsics on x86) — denormals in any decaying
IIR/feedback loop are 10-100x slower on both architectures. `AloopLoopDsp`
(~320 MiB, 20 loopers × `MAXLEN=48000*60` rings) and `Sampler` (~5.3MB)
must be `std::make_unique`'d at thread startup, never stack-local
(SIGSEGVs on first write) and never in the RT hot path.

**Per-block hot path: resolve string-keyed lookups ONCE, never per block**
— both control WRITE and telemetry READ paths cache resolved `(ParamStore
slot, Faust zone float*)` pairs at startup, rebuilt only when
`ParamStore::count` grows. Resolving per-block instead makes `readi()`
take 2.2-2.7ms against a 1.333ms budget with unbounded xruns.
Diagnostic signature: `/proc/<tid>/schedstat` ~95% on-CPU with far fewer
voluntary context switches than the block rate implies;
`/proc/<tid>/stat`'s `state` should read `S` between blocks, not `R`.

`FaustUI` shim's `addHorizontalBargraph`/`addVerticalBargraph` must do
`zones[full(l)]=z` like every other control type, or every `hbargraph()`
falls through to an O(n) scan on every `fui.get()`. `targetToZone()` needs
a case for every control target — a missing case returns `""` and the
value silently never reaches the Faust zone, zero error output.

`masterPhaseBuf` must ramp per-sample within the block —
`masterPhaseBuf[i]=masterPhaseSamples+i` (running accumulator, wrapped at
`masterLen`, bit-exact vs the `fmod` formula); `std::fill()` with a
block-constant value freezes `readIdx0`/`readIdx1` and jumps 64 samples at
block boundaries (audibly = bitcrushing).

Recording taps a dedicated post-fx Faust input (`loop.dsp`'s `prevFiltIn`)
fed from `prevFiltOut` — structurally prevents post-fx content re-entering
`fx`; must always capture the fully-effected mix, never raw pre-fx.
Sampler `captureBlock` reads the same `prevFiltOut`, never `fin` (which
post-`renderInto()` contains this block's own sampler-playback voices —
would let a sample record itself).

**SHIFT (`fx/monitorfold`) fold**: `worker()` does `fin[i] +=
prevLoopSum[i]*combinedFold` when engaged, ramping `foldGain` at
`kFoldStep` (1/16/block); `prevLoopSum` always exactly one block behind.
`foldTarget = (shiftHeldNow && !anyXposeVoiceGatedNow) ? 1.0 : 0.0` — a
SHIFT+held-key pitch-lock must not also play the raw unshifted loop
alongside the locked wet bus. SHIFT's fold adds one block of recording
lag: `dsp/loop.dsp`'s `latencyBiasN` is subtracted from `masterPhase` at
`recordStartPhaseOffset` latch; `applyRecPlayCycle` writes
`kShiftFoldBlockLatencySamples` (64) at FINISH if
`m_looperShiftHeldDuringTake[looper]` was ever set, else 0.

---

# Faust DSP

## Language gotchas

`par()`-replicated UI controls silently duplicate — a `button()`/
`hslider()` inside a `par()`-instantiated function is RE-ELABORATED at each
call site even with the declaration hoisted; verify against generated C++
(`grep -c '"name"'` must be 1), never source reading. Fix: thread the value
as a plain signal input. Genuinely per-looper once-per-take values
(`finishtarget`, `latencybias`) are correctly `par()`-replicated. Momentary/
held UI state threads as signal inputs by convention even outside `par()`
(`multitranspose.dsp`'s `note`/`gate`/`free`).

Faust has no runtime branching — `select2`/`ba.if` choose among
ALREADY-COMPUTED signals; there is no way to skip a stage's cost when its
own amount is zero. This is why Guitar/LofiFx are a permanent always-on
Core-3 LV2 bundle (a real ~7pp `core_busy` regression was measured trying
an in-Faust 3-way `fx/bank` crossfade) and why Resonode/delayverb are
separate conditionally-called LV2 bundles instead of in-graph components.

Direct function-call syntax substitutes whole expressions, not buses —
`f(loop(...), a, b)` binds the ENTIRE multi-wire `loop(...)` output to the
FIRST formal parameter (symptom: `too much arguments` buried deep in the
callee); use `,` to build the bus then `:` to pipe.

Always read the real stdlib definition (`/usr/share/faust/*.lib`) before
trusting a call site's size argument — `ef.transpose` has a HARDCODED
`maxDelay=65536` independent of the window argument passed.

Faust already CSEs `par()`-replicated pure-signal subexpressions (including
through recursive `~` signals and across `component()`-composed files
sharing a control) — only `button()`/`hslider()` boxes are exempt. Check
the real generated C++ call count before proposing a manual hoist.

Comments compile away to nothing (confirmed via real `faust -lang cpp` A/B)
— a comment-only diff is byte-identical, no DawDreamer/hardware check
needed to trust a comment removal.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation
(`build-local.sh`, `build-binary.yml`, both `build-lv2.yml` jobs). `-ct 0`
(disable table range-checking) is safe because every `rwtable` index here
is software-bounded already — any new `rwtable` needs its own explicit
index-bound trace before this flag stays valid. `-mcpu=cortex-a72` at
every target-compile step, NOT the two native-host `.ttl`-metadata g++
compiles. `-O3`, no `-Ofast`/`-march=native`/fast-math.

**Deliberately NOT shipped**: `-mapp` (real-aarch64 SIGSEGV despite a
byte-identical x86_64 A/B); `-fm def` (emits `fast_tanf`/`fast_powf` calls
the LLVM JIT can't resolve, segfaults at `render()` while `compile()`
reports success — `test/faust-flags/README.md`); `ba.tabulate` for
`filters.dsp`/`pitch.dsp` (both claim bit-identical hardware parity;
tabulation is approximate); per-effect LV2 splitting (multiplies RT
dispatch); Faust's `-omp`/`-sch` (fights manual `pthread_setaffinity_np`
pinning); `-mcd`/`-dlt` (govern `de.delay` codegen only, not `rwtable`);
`-clang` (every real compile uses gcc/g++); `-mem` (unified-heap Linux,
not separate memory banks). `-vs 16` (a smaller vector size) kills the
real `faust` compiler via SIGALRM ~2min into `dsp/aloop_pre.dsp` codegen
when applied at every invocation site — do not re-propose without a fresh
compile-time investigation, and all sites must move together if retried.

`guitar_lofi_fx.dsp` (always-on Guitar+LofiFx bank) has no exploitable CPU
waste at the Faust-source level — every standard candidate (shared LFO
CSE, `pow(x,4.0)` strength-reduction, block-rate coefficients, `MAXD`
sizing, phaser cascade division) is already handled by the compiler.
Several sound-character tradeoffs remain open, gated on a by-ear pass, not
applied. `[[memory: guitar-lofifx-cpu-audit-history]]`.

## Buffer sizing constants

All sized to "real usage ceiling + margin", verified bit-exact via
DawDreamer JIT before shipping: `delay.dsp`'s `MAXD=52000` (real ring 65536
floats — `TIME`'s `targetSamples()` caps usable delay at ~999.6ms/~47999
samples @ 48kHz); `microrepeat.dsp`'s `MR_MAX=36000` (`sliceLen`'s real
ceiling across the full `DIV`/`MLB` grid is exactly 32768; `rwtable`
allocates its declared size exactly, unlike `de.delay`'s power-of-2
rounding). `-ct 0`'s safety story is untouched — `de.fdelay`/`de.delay`
sizing is structurally different from the `rwtable`/`table` primitives that
flag governs.

`bitcrush.dsp`'s `BITS_MAX=24` (not 16) — the real path never round-trips
through int16 (S32_LE/24-bit instrument device), so 16 would be a real
always-on precision floor at `BITCRUSHAMT=0`.

`delay.dsp`'s slew recursion (`curStep(target,c)=c+(target-c)*SLEW`,
`SLEW=0.0001`) must have NO additive drift term — a stray `+1.0` (mistaking
a bookkeeping tautology for a required correction) gave a fixed point of
`target+10000` samples, a hidden ~208ms floor under every TIME setting.
`MIN_DELAY_MS=1000.0/SR` (1 sample); TIME sweeps 0.02ms-~999.6ms linearly.
Warm the ring ~90000 samples before measuring anything in this file.

Parameter smoothing in `effects_runtime.dsp`'s `filterStage`/`delayStage`/
`reverbStage`/`pitchStage` is deliberately absent (no `si.smoo` upstream of
`pow()`/`exp()`) — verified against per-render-constant normalized CC
values with an all-defaults byte-exact passthrough, matching the looper's
own piecewise-constant behavior. Adding `si.smoo` would break that parity.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices (current architecture)

`effects/home/faust/multitranspose.dsp`: NVOICES=6 polyphonic pitch-LOCK
(Digitech Whammy/Manipulator behavior — output lands on the exact held
key), additive with the mono SNAC "pedal ride" engine (`fx/pitchbend`,
CC52). Each voice owns its own `EngineSoladSnac` (`pitch_poly.dsp`/
`pitch_poly_ffi.h`, `DubfxPolyVoice[6]`) — the same engine as the mono
effect, made polyphonic; no per-file delay-line shifter exists anymore.
`shiftAmount = targetNote - heldDetNote` (continuously re-tracked)
converts to `pow(2, shiftAmount/12)`, threaded as a plain signal argument
(compile-time-cliff discipline below).

**Absolute pitch-lock**, per explicit user direction — not an interval
harmonizer. `freqDet = ba.if(
extFreqDet>0.5, extFreqDet, detectedFreq(sigIn))` prefers
`pitchtracker.lv2`'s reading (`fx/extfreqdet`) over the internal
zero-crossing fallback. `freeXpose` must follow `foldGain` (hoisted
`static`, previous-block read), not raw SHIFT button state — the two must
track the same quantity the audio fold uses. Full SHIFT/free-guard bug
history: `[[memory: multitranspose-investigation-history]]`.

**`trackingAllowed = trustedTracker > 0.5`, not `| inLockWarmup`.** A
warmup-bypass OR term would let the first ~80ms of every note trust the
slow, non-monotonic internal zero-crossing fallback whenever the external
tracker hasn't locked yet, producing attack-transient pitch-lock
instability. `[[memory: multitranspose-investigation-history]]`.

**`heldDetNote` reseeds to `targetNote` on every attack until the external
tracker has EVER been trusted, not just at the DSP instance's literal
`ba.time==0`.** A `ba.time==0`-only seed goes stale the instant any time
passes with no note held — always true on real hardware, since boot and
the first note are never the same instant; without the reseed, a first
note with the tracker still untrusted reads a runaway multi-octave shift
instead of safe unity. `everTrusted` (a permanent latch, true the first
time `trackingAllowed` is ever true) gates the reseed; once real trust
lands even once, the reseed never fires again. `[[memory:
multitranspose-investigation-history]]`.

**Voice mechanics**: shared `an.pitchTracker` detection runs once/sample.
Each voice glides shift via a one-pole (`tau2pole(0.008)`), gated by
`en.adsr` (3ms/30ms/sustain 1/50ms release), shifted by its
`EngineSoladSnac`, formant-shaped by `LpcFormantShifter`, block-buffered at
16 samples (~0.33ms onset latency, fixed regardless of pitch/formant).
Fixed per-voice gain 0.6 + static `ma.tanh` soft-clip on the summed bus
(never dynamic `1/sqrt(activeVoices)` — pumps on chord-note release).
Round-robin/oldest-steal allocation (`ApcGrid`); a steal calls
`reengage()`. **Engaged state is held by a linear release counter**
(`engageReleaseHoldS=0.06`), never gated on raw `gate>0.5` or `voiceEnv>0`
directly — an instant-disengage-on-note-off bug and an asymptotic-envelope
stall bug are both closed this way. `DubfxPolyVoice::pos`/`inBuf`/`outBuf`
are cleared on reengage (prevents stale-sample bleed into a new note).

**Formant control** (`fx/formant`, CC53) is a plain signal argument,
reachable range ~±1.5 of the `-3..3` hslider (`((data2-64)/63)*1.5`,
deadzone 60-68). Moved by `LpcFormantShifter` (`vowelFormant.h`), an LPC
spectral-envelope shifter — `GrainFormant` is entirely inert on this poly
path. `SibilanceDetector` (per-voice, gated on SNAC-unlocked + HF-energy
ratio) crossfades output toward raw dry (up to 85%) during
fricatives/consonants, not yet by-ear verified on real hardware. LPC
design/aliasing fixes, the high-fundamental defect, CPU measurements, the
superseded `VowelFormantShaper`: `[[memory: lpc-formant-shifter-history]]`.

**Splice-path upward-shift**: `upshiftTargetLag()` raises target lag on
upshifts so periodic resplice can fire on the upward direction too, not
only downward drift. Neutral
formant runs on the phase-coherent splice path (the `scale>1.02`
forced-grain override is removed). Residual splice degradation at high
shifts (~2.21 ratio at +12 semitones) is confirmed PSOLA legitimately
restructuring harmonic material, not an artifact. Full trace/measurements:
`[[memory: multitranspose-investigation-history]]`.

**`pitchtracker.lv2` is accurate below 500Hz, unreliable above** — the
range this pitch-lock is actually played in (guitar/bass/vocal) is
accurate everywhere measured; 3 of 16 test files ≥500Hz are genuinely
wrong (octave-down locks), deliberately not fixed (on the wrong side of
the compile-time-cliff). The internal zero-crossing fallback tracker (used
only when `pitchtracker.lv2` is NOT loaded) can take >400ms to converge and
drift non-monotonically — do not attempt a timing-heuristic fix inside
`multitranspose.dsp` itself, real risk of the compile-time cliff.
`[[memory: multitranspose-investigation-history]]`,
`[[memory: faust-compile-time-cliff]]`.

**One shared SNAC period tracker serves all 6 voices**
(`snacPeriodTracker.h`, extracted verbatim from `EngineSoladSnac`,
bit-identical to pre-refactor). `reengage()` on a shared-tracker voice
INHERITS the locked period (removes most per-note lock-time variance). The
shared tracker's step MUST stay phase-aligned with the engine's own
per-block cadence — a past misalignment silently degraded tremolo/AM
material. Full measurement and two rejected fix attempts: `[[memory:
multitranspose-investigation-history]]`.

**Compile-time-cliff discipline**: any new UI primitive declared inside
`multitranspose.dsp` itself risks unbounded real-`faust` compile time
regardless of DawDreamer JIT results — new controls are declared elsewhere
(`effects_runtime.dsp`) and threaded in as signal arguments. `[[memory:
faust-compile-time-cliff]]`.

**Verification**: DawDreamer's JIT cannot compile this file or `pitch.dsp`
directly (the `ffunction` JIT limitation) — `real_audio_cross_verify.py`
shells out to `test-audio-corpus/multitranspose_harness.cpp` (links
`pitch_poly_ffi.h` directly, so it tests the shifter engine only, not the
tracking/lock state machine above). **`verify_highoctave_transient.py` is
a broken gate, pre-existing on `main`, disclosed not fixed** — still calls
the JIT path this rewrite made impossible; `test-pitch-tracker` is red on
every push touching this file and carries no information until it gets the
same harness port.

`tools/dsp-cli` closes the gap the above two miss: real
local `faust -lang cpp` codegen (no JIT, so no `ffunction` limitation) +
real MSVC link, compiling this file's ACTUAL tracking/lock state machine —
not just the shifter — against real corpus audio in ~1-2s. This is what
found and verified the trackingAllowed/heldDetNote/everTrusted fixes above;
prefer it over hand-porting new C++ reference logic for any future bug in
this file's control-rate behavior. `[[memory:
multitranspose-investigation-history]]`.

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s
`dubfx_pitch_tick` `ffunction`, ADR-004): SNAC pitch tracker on a
1024-sample window + solad delay-line PSOLA shifter (resplices by an
INTEGER MULTIPLE of the detected period) + independent formant grain stage
(`grainFormant.h`) — the SAME class `multitranspose.dsp`'s 6 voices run,
the only splice/PSOLA implementation in the codebase (0.99-1.00 THD to
5000Hz on a clean sweep).

Key values: `INITIAL_READ_OFFSET_DEFAULT=64` samples (1.3ms algorithmic
delay); `m_respliceFrac=1.0`; splice search matches value+slope ONLY among
integer-period candidates; `triggerSpliceByPeriod` jumps whole periods to
clear drift in one splice plus a `per*0.9` cooldown; `reengage()` seeds
`kReengageSeedPeriod=600.0f` (~80Hz, deliberately long so no real note
biases toward a half-period splice); sinc-kernel phases normalized to
unity DC gain; crossfade is EQUAL-GAIN LINEAR (not cosine — the two
readers are correlated, cosine sums to +3dB mid-fade), its LENGTH divided
by pitch ratio on upward shifts (`m_xfadeLen` is one input period counted
in output samples; dividing keeps reader travel at one period regardless
of shift, divisor clamped ≥1.0 so downshift/unity stay bit-identical).
`m_transientHold` holds off resplicing ~2 grains post-transient;
`m_envSlow<0.004` clamps the reader with no splice (quiet-input escape).
`DL=32768` (128KB/channel ring — 131072 corrupts on the Pi's
32-bit-pointer build). `MIN_PERIOD=48` (1000Hz tracking ceiling — 32
measurably degrades real wet-output pitch accuracy). `DUBFX_BS=64` (latency dominated by downshift
reader geometry, not buffering; `DUBFX_POLY_BS=16` is the separate poly-path
value, see the `beginBlock` note above). Every tunable here is already at
its measured optimum — full splice-parameter sweep, the SNAC frequency bias
measurement, and the crossfade-division's unpitched-material tradeoff:
`[[memory: free-transpose-engine-history]]`.

**Open, disclosed bug**: SNAC period-tracker drift on tremolo/AM content —
`detectPitchStep()`'s anti-jitter clamp forces a slow climb toward a wrong
subharmonic rather than rejecting it. STEADY content is unaffected (a
first-strong-peak candidate-selection rule handles it); tremolo/dynamic
content still reproduces the drift, unfixed. `[[memory:
free-transpose-engine-history]]`, `[[memory: cold-start-self-trap]]`.

`pitch.dsp`'s `ffunction` rides params on the SAME per-sample call as the
audio sample (a separate call site would let Faust constant-fold params
away); buffers exactly `DUBFX_BS=64` samples per `processBlock`, a genuine
permanent 1-block (~1.333ms) algorithmic latency while engaged (working-rule
carve-out).

**Shared, both engines**: `reengage()` calls `m_grainFormant.reset()` and
restores the dialed formant factor with a proper glide, so a new note
never inherits the previous note's free-running grain-clock state.

## `pitchtracker.lv2`: standalone autocorrelation pitch tracker

`effects/pitchtracker-src/pitchtracker_ac.dsp` — a genuinely separate
compilation unit (compile-time-cliff constraint), its own LV2 bundle
(`build-lv2.yml`'s `pitchtracker-lv2` job), hosted via `Lv2Host
pitchTrackerFx` (`AudioConfig::pitchTrackerDir`, default
`/effects/pitchtracker`). Normalized-autocorrelation with local-maximum
peak selection (rejects harmonic/subharmonic false locks) and a
`holdLastGood`/`energyReady` onset gate (~35-40ms hold at fresh onset,
signals "no reading yet" via `extFreqDet>0.5`). Structurally immune to the
broadband-burst/plosive octave-search failure the old zero-crossing
tracker had. Must be deployed to `/effects/pitchtracker/pitchtracker.lv2/`
for `multitranspose.dsp` to use it — see the deploy-two-paths note above.

## DawDreamer verification harness

[DawDreamer](https://github.com/DBraun/DawDreamer)'s `FaustProcessor` — a
real Linux `libfaust` LLVM JIT with `compile_flags` passthrough
(`pip install dawdreamer`; `test/faust-flags/` is a committed example).
Known limits: the JIT refuses to link `ffunction`-declared external
symbols (`dubfx_pitch_tick`) — harnesses stub `pitch.dsp` to a bare
passthrough. `FaustProcessor`'s parameter list is alphabetical, not
declaration-order — match by name via `get_parameters_description()`,
never raw index; `set_automation` applies at the next 64-sample block
boundary. Faust constant-folds `tan()`/`pow()` of a literal at compile
time — sweep with a real runtime `hslider`. `df.box.boxFromDSP`/
`boxToSource` (inside `with df.FaustContext():` — SEGFAULTS without it)
runs the real codegen path, the local compile-time-cliff bisection
reproduction (95-500+ real seconds/iteration, cheaper than a CI
round-trip). Warm delay-line-bearing files ~90000 samples before
measuring. `faust2bench` is the CPU-measurement counterpart for a
Faust-flag A/B — run manually only (20 runs, `-bs 64`, real shipped flags,
`git stash` A/B on the same tree), never wired into critical-path CI.
`[[memory: ci-build-pipeline-history]]`.

## `tools/dsp-cli` — local Faust harness (complements DawDreamer above)

`tools/dsp-cli/build.bat <repo_root> <dsp_file> [-I flags]` compiles ANY
`.dsp` file with the real local `C:\Faust\bin\faust.exe` + MSVC (both
already installed on the primary dev machine) to a standalone
`dsp_cli.exe` in ~1-2s — no CI, no Docker, no Python/DawDreamer install.
Because it's real offline `-lang cpp` codegen + ordinary link (never a
JIT), it compiles files DawDreamer categorically cannot: anything pulling
in an `ffunction`-declared extern (`multitranspose.dsp`, `pitch.dsp`) links
cleanly since both companion headers (`pitch_poly_ffi.h`/`pitch_ffi.h`) are
header-only. `--gen0 wav:<path> --gen1 step:... ...` drives real corpus
audio on one Faust input channel while scripted step/silence automation
drives others (needed for tracking/timing state machines, not just shifter
ratio accuracy — see the `multitranspose.dsp` section above for a worked
example). `--list-zones`/`--stats` round out inspection. See
`tools/dsp-cli/README.md` for the full command grammar.

---

# LV2 hosting

`Lv2Host::instantiate()` must pass a real, NULL-TERMINATED
`LV2_Feature* const*` (`static const LV2_Feature* const kNoFeatures[] = {
nullptr };`), never a bare `nullptr` — Faust's generated `lv2.cpp` does
`for (int i=0; features[i]; i++)` with no null-check on `features` itself.
Wrap `instantiate()`/`activate()` in the same sigsetjmp crash-isolation
watchdog `runOne()` uses (ADR-002) — a plugin crashing during LOAD is as
untrusted as one crashing during `run()`.

`readTtl()`'s bundle match must strip trailing slashes (lilv's resolved
path carries one, the passed-in `bundlePath` never does — a raw prefix
compare silently and permanently fails, falling back to a no-port-wiring
`.so`-only path with the crash watchdog disabled). `setControl` matches
Faust's MANGLED LV2 port symbol (`mangleFaustLabel(rawLabel) + "_"`, prefix
match — Faust's `mangle()` turns non-alnum/underscore chars into `_` then
appends `"_<portIndex>"`, e.g. `fx2/FLANGEAMT` → `fx2_FLANGEAMT_3`). Verify
any new target against the deployed bundle's own `.ttl` (`grep lv2:symbol
*.ttl`) — an exact-symbol match matches nothing, permanently, silently.
`Lv2Plugin::descriptor` is cached at `instantiate()` time, never
re-resolved via `dlsym`/URI-scan on the RT block path.

`aloop.lv2` must be excluded from apkovl packaging — `build-lv2.yml`'s
`home-fx-lv2` job compiles `dsp/aloop.dsp` (the same source
`audio_thread.cpp`'s `faustHome` already compiles natively) purely as a CI
packaging-reproducibility check (ADR-003); deployed alongside
`guitar_lofi_fx.lv2` it runs the whole home stack twice. Excluded by name
in `lib-boot-tree.sh`.

## Resonode: separate, conditionally-called LV2 bundle

`effects/home/faust/resonode_synth.dsp` — pulled out of the always-on
Faust graph (a real, sustained ~2ms `readi` gap even idle, Faust has no
runtime branching) into `resonode.lv2`, loaded via a dedicated `Lv2Host
resonodeFx` (`/effects/resonode`); `resonodeFx.process()` is only ever
called when `fx/resonode/engaged` reads true.

**Architecture**: per-voice `note`/`gate`/`vel` are LV2 control ports
(`hslider`), updated per control-tick from `ApcGrid`'s MIDI handlers.
`effects_runtime.dsp` takes one audio-rate `resonodeIn` signal, zeroed (not
passed-through) when engaged with no plugins loaded — silence is the
correct degraded state, unlike `homeFx`/`userFx`'s dry-passthrough default.
Guitar/lofi-fx run as an INPUT stage on `fin` before `faustHome.compute()`;
Resonode's exciter is fed from that same post-guitar/lofi-fx signal, its
output re-enters the crossfade BEFORE
`microStage:filterStage:delayStage:reverbStage`. Locked pitch REPLACES,
never layers over, the original (`resonodeEngageGate` crossfades the
entire dry/pitch-lock/harmony term against `resonodeOut`).
`RESONODE_ENGAGED`'s Faust zone is written directly via `fui.set()` in the
worker loop (matching `MONITORFOLD`/`GLITCHFOLD`), NOT through
`targetToZone`/`resolvedControls` — it has TWO real consumers (C++
process-gate + Faust crossfade checkbox); any control gaining a second
consumer needs both write paths audited.

**DSP mechanism**: 6-modes/voice, 4-voice physically-modeled resonator,
excited ONLY by the live mic signal ("reactor mode" — silent input, held
key = bit-exact silence). Exciter is a SHARED broadband
highpass(60Hz)+lowpass(tone); each mode's own resonant filter does 100% of
frequency selection. Percussive strike envelope `en.adsr(0.004, 0.11,
0.09, 0.25, xgate)`. **`couple`** (knob 7): nearest-neighbor mode coupling
via one Faust `letrec` block, skew-symmetric energy exchange on
peak-normalized states, hard-clamped ±8 as last-resort guard (chosen over
`tanh` — identity below threshold, provably). Verified against real
recorded excitation (12/12 configs finite/unclipped at the two
highest-risk patches). Full exciter/envelope/coupling redesign history
(two coupling generations, the divergence bug that motivated both,
rejected alternatives): `[[memory: resonode-exciter-coupling-cpu-history]]`.

**16 modes** (of 24-entry tables), five named ratio tables (string/bell/
plate/membrane/bar) blended by 5 hsliders, shared across all 4 voices.
`modeCount` is capped by BOTH real CPU cost and a Faust compile-time
ceiling (24 modes kills `faust` via SIGALRM ~2min into codegen). Shipped:
zero gaps idle; 8-key stress 34-73% peak/0-2 gaps; worst combined case
(Resonode+guitar+lofi+8 keys) 80% peak/3 gaps, zero xruns. Full
optimization ladder: `[[memory: resonode-exciter-coupling-cpu-history]]`.

**Named sweetspot patches** (`kResonodePatches`, knob slots 1-4 — found
via a real DawDreamer 625-combo grid search against measured features;
`collision` is hand-set, not swept): Percussive (position 0.08, decay
0.15, damping 0.80, stretch -0.10, collision 0.55 — ~60ms decay, sharp
transient); Metal/Glass (0.08, 7.00, 0.97, 1.20, 0.15 — ~2.5s ring,
bright/inharmonic); Strings (0.08, 7.00, 0.97, -0.10, 0.00 — ~2.5s ring,
harmonic partials audible); Dance Bass (0.42, 7.00, 0.15, -0.10, 0.30 —
long ring, sub-bass-dominant). Knobs 5-7: tone brightness (log taper),
level, `couple` (linear 0..1). Distinctness measurement: `[[memory:
resonode-exciter-coupling-cpu-history]]`.

Per-voice structural modulation (fixed internal constants, no free
knob-bank slot): `positionDriftEnv` starts each voice brighter at the
strike, decays to the patch's set `position` over ~350ms (Objekt's
"Bassonic" technique — direct fix for "a patch sounds static over its own
decay"); `stretch` gets a per-note sample-and-hold jitter
(`stretchJitterAmt=0.02`), latched at `attackEdge`. `bassBoost` gives the
fundamental mode up to 1.35x gain below 220Hz. `aliasGuard` fades any mode
crossing the top 5% of Nyquist to silence. `collision` (0..1, per-patch) is
a bounded `ma.tanh` waveshaper on each voice's `bank()` output before
summing. Pitch-mod adds a small (~44 cents max) onset bump on the same
attack/steal edge as the exciter retrigger. All morph knobs glide via a
`letrec` one-pole that SNAPS on `ba.time==0`, glides only later.

**Disclosed, not addressed**: `resonode_synth.dsp` is mono in/out and the
entire aloop path is mono end-to-end — real stereo diffusion would mean
carrying a second channel through the whole pipeline, left open for a
dedicated audio-thread architecture change.

**Defense-in-depth**: a NaN/Inf guard at the C++ call site
(`audio_thread.cpp`, right after `resonodeFx.process()`), independent of
the DSP-level `coupleFeedback` fix — zeroes the block and logs a
rate-limited (max 1/s), wall-clock-timestamped `[diag-resonode]` line on
any non-finite sample. Keep even after any future coupling fix, same as
ADR-002's crash isolation.

**`ApcGrid::bindAll` must `ps.bind()` every internal flag a C++ path later
`setByName`s** — silent no-op on an unbound name. Real incidents:
`fx/resonode/engaged`, `fx/resonode/collision`,
`cmd/halfspeed`/`cmd/doublespeed` (routed only through
`config/controls.conf`'s generic fallback — grep the config file too, not
just hardcoded `setByName` call sites).

## `config/controls.conf` regression guardrails

`cmd/halfspeed`/`cmd/doublespeed` must stay bound as `note70`/`note71`,
never `cc70`/`cc71` — the real APC Key25 sends NOTES 70/71 on channel 0
(`apcKey25.cpp:142-143,187-188`), not CCs; a `cc70`/`cc71` binding matches
nothing the hardware transmits. `note91` must never be (re-)bound to
`cmd/clearall` — a live binding there races `ApcGrid`'s shadow-state reset
(a PLAY press during a SHIFT-held gesture could wipe DSP loop content
while shadow state stays stale); `midi.cpp`'s note-91 intercept is
unconditional on shift to prevent this.

## delayverb: separate, conditionally-called LV2 bundle

`effects/delayverb-src/delayverb.dsp` (delay+reverb) extracted into
`delayverb.lv2` (`build-lv2.yml`'s `delayverb-lv2` job), compiled in two
halves (`aloop_pre.dsp`/`aloop_post.dsp`) around it — both stages were
fully unconditional and ran TWICE (cue + master paths) every block
regardless of DELAYAMT/REVAMT; `audio_thread.cpp` now calls `.process()`
only on whichever instance has a meaningfully nonzero amount. Build
container needs `libboost-dev` (Faust's `lv2.cpp` uses
`boost/circular_buffer`).

## Tracktion Engine — evaluated and REJECTED, do not re-open without new evidence

Disqualified by the threading/device model: two ALSA devices with
deliberately different buffering aren't expressible in
`AudioDeviceManager`'s one-device/rate/buffer/callback model; per-core
`pthread_setaffinity_np` pinning would fight `tracktion_graph`'s own thread
pool; the 1.333ms budget makes DAW-graph plugin-delay-compensation an
unprovable regression risk without real hardware. Also pulls in
`juce_gui_extra`/X11/freetype on a headless device, GPL/Commercial
licensing. **Higher-leverage alternative**: folding `guitar_lofi_fx.lv2`
into the Core-3 Faust program natively would retire `lv2_host.{cpp,h}`/
lilv/the crash watchdog/`build-lv2.yml`'s cross-compile job with no new
dependency/latency risk — confirm `/effects/user` (the swappable user-LV2
extension point) is genuinely unused before acting.

---

# Control surface (`src/control/apc_grid.cpp`)

Every momentary Faust gate must be explicitly released or it sticks at 1
forever: `looperN/erase` (`dsp/loop.dsp`'s `wipe=max(clearAll,eraseN)`
gates ring recirculation — a stuck erase silently wipes playback forever
while recording still works; `pollHolds` releases after ~50ms),
`looperN/finishreq` (same shape), `cmd/clearall` (genuinely HELD — note-on
sets, note-off releases, no deadline needed). `rec` is a persistent
`ParamStore` value — `applyRecPlayCycle` sets `rec=0` on FINISH or a
`rec=1`/`play=1` press re-records live input forever. Per-looper cycle:
empty → ARM (`rec=1`) → FINISH (`rec=0`, `play=1`) → pause (`play=0`) →
resume (`play=1`); **ARM/FINISH fire on PRESS**, not release —
pause/resume stay on release. CLEAR_ALL zeroes both `play` and `rec` in
Faust, not just C++ shadow state; `onStopImmediate` also zeroes `rec` for
a mid-recording looper (abort, stays "empty"). `m_masterLenSamples`/
`cmd/master_len`/`cmd/recorded_bpm` reset to 0 whenever the LAST looper
with content is erased, from ANY path (checked in `pollHolds`).

**Master phrase length comes from `writeIdx` telemetry, never wall-clock**
— `deriveTempoQuant` proposes a BPM to Link only, never resizes
`m_masterLenSamples`; read `AudioThread::snapshotTelemetry().looperWriteIdx`
(the DSP's true elapsed sample count).

**Quantization is powers of 2 only, always the CEILING** — a subsequent
recording's raw duration snaps to a power-of-2 subdivision/multiple of the
master phrase length (`kMaxLoopSamples` top, M/16 bottom via
`lowerExp` floor -4.0). `bestLen=upperCand` in every non-degenerate case —
ALWAYS rounding up so recorded audio is never truncated. Every looper's
`wrapLen` is a clean power-of-2 ratio of every other, guaranteeing
drift-free repeat alignment. `test/hardware/verify-quantization.js`'s own
`ceilingPow2Candidate` helper matches this exactly.

**Content phase-anchor**: every loop plays back starting at the SAME
shared downbeat (`masterPhase==0`), never a per-take offset. Recording
start is DOWNBEAT-ONLY quantized (RC-505 behavior): `armEdge` for a
non-first looper fires only at the next `masterPhase==0`; `recordStartMasterPhase`
is hardcoded `0.0` for every non-first looper (loop 1 is the one
exception — no downbeat to wait for). `cycleOffset` accumulates
`+masterLen` on each wrap, reset at `armEdge`. `wrapLen =
gridMultiple*anchorGridLenNow`, `gridMultiple` a CEILING — can only round
UP to contain everything recorded, never truncate. **Known, disclosed edge
case**: `winSamples`/`xfSamples` can permanently freeze at floor on a TRUE
zero-context cold start (gate rising at the very first sample of a DSP
instance, zero prior audio) — does not matter in realistic performance
(any lead-in avoids it); unfixed (a source-level fix risks the
compile-time cliff).

**Real APC Key25 hardware re-sends note-on for an already-held pad** —
`onPadPress` tracks `m_looperHeld` per pad, treats a repeat as a no-op
(same pattern applies to `onLofiFxPress`, which is why that gesture is
edge-triggered via SHIFT rather than hold-duration timed — hold-duration
timing is unreliable against real hardware's repeat note-on behavior).
**Guitar-fx held REDIRECTS looper pad presses** to
`onSidechainLooperToggle` (toggles sidechain-source designation, one-shot,
not ARM/FINISH) while `m_guitarFxHeld` — auto-clears when that looper's
content is wiped.

## LofiFx/granulator button — SHIFT disambiguates the two gestures (note 69)

Both gestures fire instantly on PRESS: plain tap toggles
`m_granulatorLatched`/`setGranulatorEnabled`; SHIFT+tap toggles Resonode
engage (forces the granulator latch off — Resonode always wins;
disengaging releases every held Resonode voice). Every press switches the
active knob bank to LofiFx; the bank reverts on release only if Resonode is
NOT engaged. While Resonode is engaged the keybed drives 4 Resonode voices
via `Lv2Host::setControl` pushes to `fx/resonodevoice{v}/{note,gate,vel}`;
Resonode's 4 voices are only computed when engaged (genuinely skipped at
the C++ call site), unlike `multitranspose.dsp`'s 6 always-on voices. LED:
blinking red while Resonode engaged, solid green while granulator latched.

LofiFx must latch permanently on press (matching Dub/Guitar), no
revert-on-release. `m_lofiShiftMode` selects the knob page: plain press =
granulator (bitcrush + 4 named patches + 3 direct dials), SHIFT press =
Resonode (bitcrush + 4 named patches + tone/level/couple).

## Granulator (`src/dsp/sampler/sampler.h`) — 4 named patches + 3 direct dials

C++ (not Faust): 7 underlying params (`grainMs`/`grainRateHz`/
`pitchSprayCents`/`posJitterMs`/`scanRate`/`reverseProb`/`envShape`),
`MAX_GRAINS=48` shared across all 16 voices, cubic-interpolated reader.
`scanRate=0` freezes the scan position; negative `rate`/`reverseProb`
plays backward; `envShape` morphs Blackman→Hann→percussive attack-decay,
LUT-cached double-buffered. Direct dials (knobs 5-7,
`applyGranulatorDirectKnob`) override the corresponding patch-blended
field only once touched (`m_lofiFxKnobTouched[5..7]`) — additive over
prior patch-only behavior: Scan/Freeze (0-3.0, 0=frozen, 1.0=normal,
3x=fast-forward), Density (log taper 2-200Hz → `grainRateHz`), Pitch
Scatter (0-1200 cents linear → `pitchSprayCents`). `kGranPatchCount=4`
(down from 6). Full history behind these additions (the "every parameter
only reachable via preset-guessing" problem, "boring" diagnosis):
`[[memory: granulator-investigation-history]]`.

**48-grain pool is budgeted PER VOICE, never exhaustible** —
`_recomputePerVoiceGrainBudget()` divides the pool by active granular
voice count per block, `_spawnGrain` refuses to exceed its share
(`_stealMostFinishedGrainSlot()` structurally unreachable, 0 thefts across
the production-reachable space). Gain compensation tracks the BUDGETED
spawn period (not requested overlap) — level stays flat within 0.5dB
regardless of voice count, removing what had been an accidental -43dB
limiter at 16 held keys (so downstream headroom now genuinely matters at
that extreme). `MAX_GRAINS` deliberately NOT raised — not the binding
constraint, and 4x pool = 4x worst-case per-grain CPU. Full exhaustion/
gain-collapse measurements: `[[memory: granulator-investigation-history]]`.

**Grain pitch can be quantized to musical intervals** (Octaves/Fifths/
Minor Triad/Minor Pentatonic beside continuous `pitchSprayCents`) at zero
CPU, held in a lock-free `std::atomic<int>`. Knob 7 is segmented (`v01
<=0.5` continuous spray, above selects the four interval sets in equal
quarters) — an untouched knob 7 leaves Continuous mode, prior behavior
exact. `kGranPitchContinuousSprayMode` in `apc_grid.h` duplicates the
enum's zero value (`Sampler` only forward-declared there) — a
`static_assert` in `apc_grid.cpp` fails the build if the two drift.

`Voice::grainNextPeriod` applies a fixed internal
`kGrainTimingJitterAmt=0.15` (±15%) random deviation to each grain's own
inter-onset interval, drawn fresh per grain-fire — keeps the grain-spawn
clock from reading as mechanically regular (matches Resonode's own
`positionDriftAmt`/`stretchJitterAmt` internal-constant convention).
`kGranPatches[0]` (fallback before any patch-weight knob is touched) is
the 90ms/35Hz/25-cent-spray/35ms-jitter patch — a deliberately textured
default, not the tamest patch in the table. Both measured via standalone harness:
`[[memory: granulator-investigation-history]]`.

**Considered, not implemented**: making the granulator audible without a
held key (auto-triggering a background voice on latch — two real blocking
bugs identified: `Sampler::ROOT_NOTE=60` sits inside the drum-key range,
and `_noteOn`'s same-note release logic would kill the ambient voice the
first time that exact note is played manually). Left open, needs a
dedicated non-keybed-reachable voice slot or explicit re-arm, neither
exists today.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching 8-knob
banks selected via `ApcGrid::onFxKnobCC` on `m_activeBank`/`m_shift`.
`kFxKnobCcNumbers = {48,49,50,51,54,55,57,53}` (CC53 double-duties as
Formant on Dub only, intercepted before the table). Dub regular:
`fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant. Dub shift: a
dance-gate + LFO bank (`dubGateLfoStage`) — `fx/dubgate/{amt,pattern}`,
`fx/dublfo/{rate,depth,shape,target,phase}`, tempo-synced via
`fx/dubgate/clockphase` off the same shared 4-beat clock as the guitar
gate/groove-shuffle. Guitar regular:
`fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}`
(shared `BANKSPEED` LFO), CC53=`fx2/GATEAMT`. Guitar shift: an 8-dial
dual-ADSR bank for the Sampler engine (filter-cutoff envelope + amplitude
envelope), writes straight into the C++ `Sampler` object, no Faust/LV2
targets. LofiFx: knob0 `fx2/BITCRUSHAMT`, knobs1-4 named-patch weights
(granulator or Resonode per `m_lofiShiftMode`), knobs5-7 direct dials.

`compressor.dsp` stays in-tree unreferenced (only `ab_fm_def.py`'s
fast-math test uses it — don't delete without updating that test).
`samplerate.dsp`/`mixbus.dsp`/`gateStage`'s multi-pattern select/`SRRAMT`
stutter/`rawGlitchTap` were removed as confirmed-dead (zero consumers).
`chain.dsp` is NOT dead — `build-lv2.yml`'s `home-fx-lv2` job builds it as
a packaging check.

**Groove shuffle**: the 4 metronome-flash pads (`kBeatPadNotes`, notes
15/23/31/39) are also shuffle buttons, routed via
`onShuffleButtonPress`/`Release` to a 4-bit `fx/shuffle/mask`. True
retrigger/reorder, not swing/groove-offset — a continuous-perturbation
offset is audible as a "double-tap" from re-reading already-played
content, so this must stay whole-beat, block-boundary only.
`kShiftReorderTables[shuffleMaskNow]` (15
hand-verified-distinct 4-entry sequences) gives whole-beat, block-boundary
offsets only — structurally eliminates the double-tap mode. Runs on its
own free-running `shuffleClockSamples`, added on top of the real
`masterPhaseSamples+i` ramp.

`dsp/loop.dsp` varispeed must have NO deadzone — `varispeedActive =
effSpeed != 1.0` (exact-equality) — a deadzone would discard small real
Link-tempo mismatches, causing steady phasing between loopers of different
lengths. The soft-resync drift-correction term (`resyncCoeff`) is gated to
`0.0` whenever `|effSpeed-1.0|>0.3` so it never fights a deliberate manual
half/double-speed press. **Both beat-shuffle's hard clip and varispeed's
instant speed jump are INTENTIONAL**, per explicit user direction — do
not smooth either without confirming whether a report is about the
(intended) abrupt transition itself vs. a genuinely distinct defect.

`microrepeat.dsp`'s `sliceBlocks = max(1, int(beatBlocks/divSafe))*2` with
`divSafe=max(1,DIV)` (multiplying the already-computed slice length,
never halving the divisor first — would floor-collide `div=1`/`div=2` at
`int(1/2)=0`). `mode2`/`mode3`/`mode4`'s damping exponent is
strength-reduced from `pow()` to `damping`/`damping*damping`/
`damping*damping*damping` (literal integer exponents, bit-exact).

CC53 formant: deadzone 60-68, `((data2-64)/63.0)*1.5` — a real ~±1.5
range (clamped by the `-3..3` hslider). SHIFT must never change a knob's
own behavior (no shift-dependent widening) — it is reserved exclusively
for the native fold/resample gesture, per direct user direction.

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a
completely different USB role (peripheral/gadget vs. host mode on the
USB-A ports a flash drive plugs into).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring (5s).
`audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(), N)` every
block, next to `g_sampler->captureBlock(...)` — same post-fx tap point.
Single-atomic-counter SPSC ring (`std::atomic<uint64_t>` write/read
counters) that NEVER blocks/allocates — if the consumer falls behind,
`pushBlock` advances the read counter itself (drops oldest samples,
increments an overrun counter).

**Control side**: all file I/O happens in `UsbRecorder::poll()`, called
from `main.cpp`'s 5 Hz control loop — deliberately NOT a dedicated
pthread. Chunks are fixed-size, cyclically `O_TRUNC`-reopened, so the ring
bounds disk usage by construction. Mount detection is a `stat()`
device-id comparison (`isMounted()`), not `/proc/mounts` parsing.

**Config**: `[storage]` in `config/aloop.conf` — `usb_record`,
`usb_mount_point` (default `/media/aloop-usb`), `usb_chunk_minutes` (10),
`usb_chunk_count` (6). `effectiveChunkCount()` shrinks the ring for
smaller drives via `statvfs`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`usb-automount-setup.sh` (local.d bootstrap, APPENDS to `/etc/mdev.conf`,
never overwrites, does its own explicit coldplug pass since `local.d`
runs AFTER `mdev -s`'s sysinit scan). Mount attempts: no `-t` first, then
explicit `vfat`/`ext4`/`exfat`/`ntfs`. **exFAT/NTFS userspace tools are
almost certainly NOT in the minimal Alpine RPi tarball** — only
kernel-native FAT32/ext4 expected to work without further vendoring.
UNVERIFIED on real hardware, along with mdev.conf rule syntax and real
USB-drive enumeration. Both scripts are registered in BOTH
`_exec_paths` and `_nb_exec_paths`.

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
