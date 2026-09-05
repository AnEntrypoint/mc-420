# aloop — technical constraints reference

Durable constraints for this codebase and its build/deploy pipeline. Real Pi 4
device: `192.168.137.100`, root/aloop. Read before touching the device, the DSP,
or the image/netboot scripts.

This file is a lean, current-state operational reference — hardware facts,
build/deploy procedures, current shipped architecture, working rules, and
currently-open/disclosed bugs. Long-form multi-session investigation history
(rejected designs, session-by-session debugging narration, superseded
measurements) has been moved to the auto-memory system
(`~/.claude/projects/<project>/memory/`); see the `[[memory: ...]]` pointers
below for that context when the "why not X instead" behind a current value
matters.

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

Anchors below name established engineering disciplines this project follows;
each replaces what would otherwise be a paragraph of restated rationale — treat
the anchor name as shorthand for the full technique, not decoration.

## No comments in code, ever — Self-Documenting Code (Martin, *Clean Code*)

No inline, block, or doc comments anywhere (C++, Faust `.dsp`, JS, shell, YAML,
config). A name, a function boundary, an extracted variable, or a small type IS
the explanation — rename or restructure instead of annotating. A paragraph-long
comment is the same violation at higher volume; explaining a "why" is not an
exemption.

Hardware quirks, root-causes, and design rationale belong in THIS file or
`.wfgy/lessons.md`, never inline — durable knowledge lives in one place (SSOT),
not scattered across call sites. `[[memory: no-comments-rule]]`.

A comment encountered anywhere — pre-existing, vendored, another session's — is
converted to self-explanatory code the same turn: read it, fix the root cause it
was compensating for, delete it (Boy Scout Rule / Broken Windows). One sighting
spawns a full sweep of that file.

## Never add audio-path latency — Fitness-Function Invariant (Ford et al.,
*Building Evolutionary Architectures*); Chesterton's Fence

The existing ~7ms block latency must never grow — not temporarily, not to work
around an unrelated bug. If a fix seems to need a bigger ALSA buffer/period, more
block lag, or any added buffering stage, stop and ask first (one-way door, see
gm Section 4). Any audio glitch is a regression to root-cause (Five Whys), not a
hardware limit to negotiate around.

A wet effect's own algorithmic latency while engaged (e.g. `ef.transpose`'s
window, the SNAC engine's engaged-only latency) is not covered by this rule — it
is additive on top of an always-instant dry path, not part of the fixed block
chain.

## Never trust an in-repo comment as ground truth — Hyrum's Law inverted; Popper
(falsifiability)

Comments in this tree have been confidently wrong about current intent (loop
quantization spec), about performance ("already alloc-free" when it allocated per
block), and about numeric guarantees ("byte-exact passthrough" that measured
1.5e-05). Read what the code does (ground truth is execution, not prose); for
spec questions, grill the user for the current requirement rather than assuming
either code or comment is right.

## Real hardware over asking the user to reproduce input — Characterization by
Live Witness (Feathers, adapted); Least-Interruption Principle

Prefer byte-level MIDI injection (`tcp/9401`, `src/control/midi.cpp`) or
SSH-based log/state inspection over asking the user to press buttons. Reserve
`AskUserQuestion` for physical steps only once a byte-level substitute is proven
impossible for that bug class (audible sound quality, real analog behavior) or the
user has said they want to verify by ear.

## Stay grounded in what this system is — Cargo Cult Science (Feynman);
First Principles

A real-time C++/Faust audio looper on real ALSA hardware, a real Pi 4, real USB
devices, real MIDI gestures. Abstract "formal verification"/"proof
assistant"/"dependent types" framings do not apply and must not be adopted. Work
the concrete bug with the concrete tools this project uses: static reading, real
device logs, byte-level MIDI injection, CI-verified builds, DawDreamer renders.

## Compiling clean proves nothing about runtime safety — Fallacies of
Distributed/Cross-Target Computing (Deutsch, adapted); Popper (unfalsified ≠
verified)

Repeatedly true here: a synthetic x86_64 A/B passed while real aarch64 codegen
SIGSEGV'd (`-mapp`); a JIT `compile()` reported success and crashed at `render()`
(`-fm def`); CI green meant "x86_64 compiled", never "runs on target". Any
numeric-approximation or codegen flag needs a real-target, real-signal test before
shipping. `[[memory: faust-verification-discipline]]`, `[[memory:
faust-compile-time-cliff]]`.

## Diagnostic logging must carry wall-clock timestamps — Observability over
Inference (Shewhart/statistical process control, adapted)

A threshold-triggered log line's line-count density is not a proxy for elapsed
time. Always log `clock_gettime(CLOCK_MONOTONIC, ...)` as `t=<sec>.<ms>` alongside
the magnitude, or periodic-vs-bursty is indistinguishable.

---

# Boards, images, boot trees

## `image/lib-boot-tree.sh` is BOARD-parameterized

One source of truth for every board's boot tree, dispatched by a `BOARD` env var
(`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`).

`boot_tree_apkovl` (binary, LV2, services, vendored libs) is 100% shared and
unconditional — architecture-independent aarch64 userspace. Only
`boot_tree_fetch` (firmware/kernel/DTB) and `boot_tree_config` (boot
cmdline/USB-gadget config) dispatch per board.

`board_supports_usb_gadget`/`board_wifi_irq_name` in `lib-boot-tree.sh` are the
authoritative capability source, not this table:

| Board | SoC | Boot chain | USB-audio gadget | WiFi chip |
|---|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711, quad Cortex-A72 aarch64 | Pi firmware, FAT partition | dwc2 peripheral — real UAC2 gadget | Broadcom brcmfmac |
| pi3 | BCM2837, quad Cortex-A53 aarch64 | Pi firmware, FAT partition | none — no OTG-capable controller | Broadcom brcmfmac |
| pi5 | BCM2712, quad Cortex-A76 aarch64 | Pi firmware, FAT partition | none — RP1 southbridge USB is host-only | Broadcom brcmfmac |
| opi-prime | Allwinner H5, quad Cortex-A53 aarch64 | Armbian U-Boot (raw SD sectors) + ext4 root + extlinux.conf | unproven | Realtek RTL8723BS |

## Orange Pi Prime specifics

**SoC is Allwinner H5, not H3.** 64-bit Cortex-A53 aarch64, Alpine's existing
aarch64 packages apply directly.

**USB-audio-gadget mode is UNPROVEN.** H5 uses a MUSB dual-role controller on
the micro-USB OTG port; the 3 full-size USB-A ports are host-only EHCI/OHCI
and can never do gadget mode. `board_supports_usb_gadget` returns false for
`opi-prime`; the fallback is the board's built-in analog codec (3.5mm in/out)
as a normal ALSA HOST device. If gadget-mode UAC2 is ever proven on real
hardware, add `opi-prime` to the true case and update this.

**Boot chain is structurally incompatible with the Pi's FAT-partition
firmware model.** Allwinner's BootROM reads a raw SPL/U-Boot image at a fixed
raw SD sector offset before any partition table exists. `boot_tree_fetch_opi`/
`boot_tree_config_opi` download Armbian's `dl.armbian.com/orangepiprime/
Trixie_current_minimal` **stable redirect URL** (never a resolved
`github.com/armbian/community/releases/...` asset URL — Armbian's rolling
trunk moves that version string every build), read the image's own partition
table via `sfdisk` (never assume a fixed offset), extract the raw
pre-partition-1 region as the U-Boot blob, loop-mount the ext4 root to pull
kernel/dtb/initrd. `boot_tree_config_opi` writes
`/boot/extlinux/extlinux.conf` carrying the same isolcpus/RT kernel cmdline
as the Pi boards' `cmdline.txt`.

`image/build-image.sh`'s `opi-prime` branch needs real root
(`sudo losetup`/`mount`) — CI or a real Linux host only, never the Windows
dev host.

**No netboot path — SD-card-flash-only.** Allwinner's BootROM requires
U-Boot resident on local media before PXE/TFTP is reachable. `build-image.yml`
skips netboot-build/validate/SD-zip for `BOARD=opi-prime`.

**`boot_tree_write_boot_scr_opi`'s `kernel_addr_r`/`fdt_addr_r`/
`ramdisk_addr_r`** must match THIS specific U-Boot build's own compiled-in
defaults, not generic sunxi-common.h values — real hardware only reaches
`booti`'s handoff with the values `strings`-extracted from the real
downloaded U-Boot blob (`kernel_addr_r=0x40080000`, `fdt_addr_r=0x4FA00000`,
`ramdisk_addr_r=0x4FF00000`, `loadaddr=0x42000000`, `scriptaddr=0x4FC00000`).
Untested past `booti`'s handoff on real hardware as of this writing — the
next thing to verify once real hardware/serial adapter access exists.
Armbian's own compiled `bootcmd` sources `/boot/boot.scr` by fixed filename
directly and never touches `extlinux.conf` — `extlinux.conf` is a defensive
fallback only, kept for any future U-Boot build with
`CONFIG_DISTRO_DEFAULTS` compiled in.

`boot_tree_config_opi`'s `earlycon=uart8250,mmio32,0x01c28000` is a
diagnostic console param (H5's real uart0 MMIO base); `console=ttyS0,115200`
is independently verified correct for this board's DTB.

**WiFi is Realtek RTL8723BS.** `kernel/rt-tune.sh`'s IRQ-steering matches
`rtl8723bs` alongside `brcmfmac`.

**`build-opi-armbian-source.yml` pins Armbian's last pre-6.18 sunxi64
`current` kernel.** Checkout pinned to `armbian/build@be0bd46058e23cfdad66e840198dda157b998db5`,
with a verification step asserting the checkout genuinely resolves to 6.12
(grep of `config/sources/families/include/sunxi64_common.inc`). Two patch-time
workarounds are applied before compiling: known-broken unrelated-hardware
entries are disabled in `patch/kernel/archive/sunxi-6.12/series.conf` (Rockchip
SPI runtime-PM fixes, Cedrus probe-cleanup), and Realtek USB-WiFi driver
configs (RTL8189ES/FS, RTL8192EU, 88XXAU, RTL8821CU) are unset in
`linux-sunxi64-current.config` because they fail `-Werror=incompatible-pointer-types`
against 6.12's `cfg80211_ops` signature.

## apkovl assembly constraints

**`boot_tree_apkovl` must stamp `.default_boot_services`.** Alpine's
`rc_add modloop sysinit` gate is conditioned on
`[ -f "$sysroot/etc/.default_boot_services" -o ! -f "$ovl" ]` — without the
marker `/lib/modules` stays empty, `/proc/asound` never exists, and
`/sys/kernel/config/usb_gadget/` cannot be created. Init removes the marker
after reading it (one-shot Alpine mechanism).

**`aloop`'s OpenRC service needs `rc_ulimit="-l unlimited -r 95"`, not a
`local.d` `ulimit` call.** `kernel/rt-tune.sh`'s memlock `ulimit` runs inside
a `local.d/*.start` transient subshell — never reaches the separately-started
`aloop` process. `rc_ulimit` is read by `openrc-run.sh` immediately before it
execs `command`.

**`aloop`'s `depend()` needs `after local autoap`.** `aloop` constructs
`ableton::Link`'s UDP multicast socket at startup; with both services
declaring only `after local`, Link could open its socket before `autoap`
brought `wlan0` up. `src/main.cpp` additionally waits for the interface to
carry an address before starting Link.

**Vendor alsa-lib and the whole lilv stack as real `.so` files; never
`apk add` at boot.** The device's only reachable apk repo is the ~100-package
minimal set bundled in the Alpine RPi tarball (no CDN fallback) — none of
`alsa-lib`/`lilv-libs`/`serd-libs`/`sord-libs`/`sratom`/`zix-libs` are in it.
Real musl-aarch64 `.so` files live in `vendor/lib-aarch64/` and are copied
into `usr/lib/`.

**alsa-lib needs its DATA tree too (`/usr/share/alsa/alsa.conf`).** With
`libasound.so.2` vendored but no `alsa.conf`, `snd_pcm_open("default", ...)`
segfaults inside alsa-lib's config parser. The whole `vendor/share-alsa/`
tree (~340K) is vendored.

**`hostapd`/`dnsmasq` must be vendored as aarch64 binaries.** The Alpine RPi
tarball's local repo has no hostapd/dnsmasq packages and its
`APKINDEX.tar.gz` is RSA-signed by Alpine (cannot regenerate on Windows).
Real aarch64 binaries live in `vendor/sbin-aarch64/`. `hostapd` additionally
needs `libnl-3.so.200`/`libnl-genl-3.so.200`, vendored into
`vendor/lib-aarch64/`.

**`dnsmasq` needs explicit `user=root`/`group=root` in
`src/net/config/dnsmasq.conf`** — vendoring the binary does not create the
`dnsmasq` system user; without this the daemon exits immediately with
`unknown user or group: dnsmasq`.

**Every `cmdline.txt`/`extlinux.conf` APPEND write must stay a single
line.** Pi firmware and U-Boot both read only line 1; an embedded newline
silently truncates every kernel param after it. Every writer collapses both
halves via `tr '\n' ' '` + `tr -s ' '` before emitting one line.
`validate-image.sh`/`validate-netboot.sh` assert this by counting newlines.

**Anything newly vendored needs adding to BOTH `tar --mode='+x'` lists.**
NTFS carries no Unix exec bit (see `[[memory: windows-host-constraints]]`);
`chmod +x` in the overlay is a silent no-op on this Windows host.
`image/lib-boot-tree.sh` (`_exec_paths`, apkovl build) and
`image/build-netboot.sh` (`_nb_exec_paths`, netboot repack) each re-append
every executable path by name via `tar --mode='+x' -rf ...`. A file not named
in those lists ships `-rw-r--r--`. Read modes from `tar -tvzf` archive
listings, never from extracted files. `opt/aloop/aloop` legitimately appears
twice in the listing (a `-rw-r--r--` entry then `-rwxr-xr-x`) since the `+x`
pass re-appends rather than overwrites — verifiers grep the LAST match.

**The `find` calls building these lists must run inside the overlay
directory** (`cd "$OVL" && find usr/sbin ...`), never in the caller's own
cwd — a `find` against a path that doesn't exist relative to cwd returns
empty with no error, silently dropping matches from the `+x` re-append with
zero visible failure anywhere in the pipeline. This produced a real
ticker-AP outage once (hostapd/dnsmasq correctly matched in one list via a
hardcoded path but silently excluded from the `find`-derived list).

## `core.autocrlf=true` on this Windows clone corrupts shell scripts

See `[[memory: windows-host-constraints]]`. A repo-level `.gitattributes`
forces `eol=lf` on `*.sh *.start *.conf *.yml *.yaml Makefile cmdline.txt
config.txt usercfg.txt`. If a script behaves strangely on-device despite
looking correct, check `file path/to/script.sh` for "with CRLF line
terminators"; fix via `rm path/to/script.sh && git checkout -- path/to/script.sh`.

---

# Device runtime environment

## Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load

A `.so` built with the host's g++ (glibc/x86_64) dlopens on the device with no
bundle-discovery error, then fails at load time:
`Error relocating .../foo.so: unsupported relocation type 7`. CI green only ever
means "the x86_64 build compiled", never "the plugin runs on target".

Pattern (see `.github/workflows/build-lv2.yml`): split `faust2lv2`'s stages —
`faust -i -a lv2.cpp ...` emits a self-contained `.cpp` (only libc/libstdc++/lv2/
boost includes); a `$HOST_CXX` compile+run of that same `.cpp` emits the plugin's
`.ttl` metadata (host-only, never touches target arch/libc); only the final
`-shared .so` link targets the device. Cross-compile that one step in a real
Alpine aarch64 container via `docker/setup-qemu-action` +
`docker run --platform linux/arm64 alpine:3.20`, matching `build-binary.yml`.
Verify: `objdump -p foo.so | grep NEEDED` must show `libc.musl-aarch64.so.1`,
never `libc.so.6`.

**Pass `CPPFLAGS` into nested `docker run ... sh -c "..."` via
`docker run -e VAR="$VAR"`, never string interpolation** — escaped quotes lose
their escapes across the nested-shell boundary.

## `actions/upload-artifact@v4` `path:` wildcard-vs-literal

`path: effects/home/*.lv2` (wildcard) zips the matched directory WITH its basename
preserved. `path: effects/home/guitar_lofi_fx.lv2` (literal single directory) zips
its CONTENTS flattened at the zip root, silently dropping the `.lv2/` wrapper.
Always use the wildcard form for LV2 bundle artifacts.

## `disable_core3_lv2` in `/etc/aloop.conf`

An uncommented `disable_core3_lv2 = 1` makes `audio_thread.cpp`'s worker skip
`homeFx.process()`/`userFx.process()` entirely every block, so `guitar_lofi_fx.lv2`
never runs its DSP at all — fully silent, fully inert, no error or warning. This is
a live-device-only state that survives any number of `rc-service aloop restart`s.
Always `grep -n disable_core3_lv2 /etc/aloop.conf` (anchored to line-start, no
leading `#`) before debugging "guitar/lofi effects don't do anything" as a code
bug.

---

# Deploy, netboot, SSH

## SSH: use a JS `ssh2` client, never Windows ssh.exe or sshpass

See `[[memory: windows-host-constraints]]` for the full detail (password
auth root/aloop, fastPut unreliability + base64/exec fallback, MSYS
path-conversion). A fresh netboot generates a new host key every boot,
breaking raw `ssh`/known_hosts but not `ssh2`.

## The `REBOOT:<token>` UDP listener lives INSIDE the aloop process

`config/aloop.conf`'s `[remote] token=` enables a `udp/4446` listener
(`src/control/remote_control.cpp`). If `aloop` has crashed, nothing is
listening and `image/aloop-reboot.js` silently does nothing. OpenRC's
`respawn_max=0` means it will not restart a crashed `aloop` either, so a
crashed device stays crashed indefinitely.

If `rc-service aloop status` shows `crashed`, use
`node ssh-exec.js 192.168.137.100 "reboot"` instead. Only use the UDP REBOOT
path once `aloop` is confirmed running.

**Always verify a reboot actually happened before trusting any device-state
observation**: check `cat /proc/uptime` and `md5sum /opt/aloop/aloop` against
the binary just deployed, BEFORE reading logs.

## Netboot self-update: two rebuild paths

- **Automatic**: `image/serve-netboot-win.js` (run elevated, needs
  `GITHUB_TOKEN`/`gh auth token` and `PI_TOKEN`) polls `build-binary.yml`/
  `build-lv2.yml`'s latest green run on `main` every 30s, downloads artifacts
  into `.netboot-update-work/{bin,lv2}`, calls `image/build-netboot.sh` when
  the combined SHA changes. State lives in `.netboot-update-sha`
  (`<binSha>:<lv2Sha>`) — matching SHA means the poll loop does nothing.
- **Manual**: `ALOOP_BIN=<path> LV2_DIR=<path> OUT=.netboot-serve
  NETBOOT_SERVER=192.168.137.1 bash image/build-netboot.sh`.

**The automatic path's SHA-tracking is blind to changes in the packaging
scripts themselves** — neither workflow lists `image/**` in its trigger
`paths:`. Any packaging-script change requires a manual `.netboot-serve/`
rebuild.

**Verify the deployed checksum after every manual rebuild, BEFORE
rebooting**: `tar -xzf .netboot-serve/aloop.apkovl.tar.gz -C
<fresh-empty-dir> ./opt/aloop/aloop && md5sum <fresh-empty-dir>/opt/aloop/aloop`
vs the source binary. A checksum match proves SERVER state only — cross-check
`/proc/uptime` for whether the device actually picked it up.

**Any new LV2 bundle needs deploy wiring into BOTH `build-image.yml` AND
`serve-netboot-win.js`.** `[[memory: deploy-two-paths-lv2]]` — grep both for
every existing `*-lv2` artifact name before considering a new bundle's
deploy wiring complete.

## `build-netboot.sh` publish discipline

**Publish is a staged-directory atomic `mv`, never `rm -rf` + populate-in-
place.** `image/serve-netboot-win.js` can rebuild the netboot root while a Pi
is actively TFTP/HTTP-fetching from it; the staging directory is built as a
SIBLING of the real output dir (same filesystem, atomic `rename(2)`) — never
under `mktemp -d`'s `$WORK`, which typically lands on a different mount and
silently degrades the swap to copy+delete.

**The netboot root must be `chmod -R a+rX`'d after copy.** The Alpine
tarball ships `boot/initramfs-rpi` mode 600 and `cp -a` preserves it; an
unprivileged TFTP server then gets "Permission denied" and the Pi panics
"unable to mount root fs".

## Netboot silently outranks the SD card

Pi 4 firmware prefers network boot when a netboot server is reachable — a
correctly written SD card can look like a broken fix while the device fetches
from a stale `.netboot-serve/`. Before trusting any on-device observation
after an SD update, confirm which path booted (`.netboot-serve.log`) and
compare the running binary's md5 against the card's. `serve-netboot-win.js`
can also die while holding its `updateInFlight` guard, freezing
`.netboot-serve/`/`.netboot-update-sha` indefinitely.

## Netboot DHCP diagnosis

**DHCP REQUESTs with ZERO TFTP reads = option 66 points at a dead
address**, not a competing DHCP server. `SERVER_IP` must be an address an
interface actually holds (Windows ICS may assign e.g. `192.168.137.101`, not
`.1`). `resolveServerIp()` auto-detects the single live
`192.168.137.0/24` address and REFUSES an explicit `--server` no interface
holds. Tell a stale ICS lease renewal apart from a real DHCP loop: `arp -a`
shows the local address as `Interface: <ip>`; `ping` TTL=128 (Windows) vs
TTL=64 (Linux).

**DHCP DISCOVERs that never become REQUESTs = wrong egress interface.**
Cause: the netboot NIC holding `192.168.137.1` with a **/16** mask while
Wi-Fi holds a /24 in the same range — Windows routes by longest prefix
match, so replies to the directed broadcast go out Wi-Fi. Diagnose:
`Find-NetRoute -RemoteIPAddress 192.168.137.255`; confirm
`Get-NetIPAddress -AddressFamily IPv4` shows `PrefixLength 24`. Fix:

```
Remove-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.137.1 -Confirm:$false
New-NetIPAddress   -InterfaceAlias Ethernet -IPAddress 192.168.137.1 -PrefixLength 24
Set-NetIPInterface -InterfaceAlias Ethernet -InterfaceMetric 10
```

The server resolves `SERVER_IP` once at startup — a running instance keeps
serving the old address after an interface change; restart it.
`pkill -f serve-netboot-win` does not always reap the listener; confirm
ports are free (`netstat -ano | grep -E ':(67|69|8080)\s'`) before concluding
a restart took.

## Fast DSP-only iteration: `image/dsp-hotdeploy.js`

A pure `.dsp`/Faust edit does not need a full image assembly or reboot.
`node image/dsp-hotdeploy.js --target home|guitar|both` pushes a commit
through CI's real musl/aarch64 cross-compile, SFTPs the changed artifact
onto a live device, restarts the service over `ssh2`. Requires the edit
already committed and pushed (it polls the run that commit triggered, does
not trigger one) and `gh` authenticated. Fails loudly if the run's
conclusion isn't `success` or `rc-service aloop status` isn't `started`
afterward.

**It STOPS the service BEFORE overwriting `/opt/aloop/aloop`, not after** —
`sftp.fastPut` against a currently-executing binary's inode fails with musl
ETXTBSY. Sequence is stop → `fastPut` → start, never `restart`-after-write.

Does NOT replace the netboot path for changes to
`image/lib-boot-tree.sh`/`image/build-netboot.sh`, kernel/cmdline config, or
OpenRC service files.

## CI runner, docker-step, and artifact discipline (build workflows)

- **Cross-compilation runs on native `ubuntu-24.04-arm` runners** (`build-binary.yml`,
  `build-lv2.yml`): the Alpine `linux/arm64` container then needs NO QEMU
  emulation. Measured need: the QEMU-emulated link step alone took ~14 minutes
  on `ubuntu-latest` (the compile itself ~1 minute) — QEMU user-mode binary
  translation is disproportionately slow for a linker's memory-access pattern.
- **Docker build steps are split with per-command `timeout` bounds + `set -x`.**
  An unbounded single `docker run ... sh -c` stalled silently multiple times
  under emulation (apk-mirror stall / QEMU codegen hang) until GitHub's
  multi-hour job timeout, with no signal naming WHICH sub-step hung.
- **All workflow artifacts ship `retention-days: 3`** (opi armbian image: 7).
  These workflows run on nearly every push; at the default 90-day retention,
  accumulated ~68MB image artifacts hit the account-wide Actions storage quota
  and blocked EVERY workflow's uploads repo-wide until GitHub's quota
  recalculation cycled days later.
- **`build-image.yml` downloads BOTH `home-fx-lv2` AND `guitar-lofi-fx-lv2`
  from the same green `build-lv2.yml` run into sibling dirs** (a
  `workflow_run` trigger only carries its own run's artifacts). Fetching only
  `home-fx-lv2` shipped images with ZERO usable home-FX effects silently —
  that bundle contains `aloop.lv2`, which `lib-boot-tree.sh` filters back out;
  `guitar_lofi_fx.lv2` is the wanted standalone effect.
- **The rolling `latest` release hard-gates on a real bundled aloop binary**
  (`payload_check` step): `validate-image.sh` deliberately only WARNS on a
  missing payload (legitimate structural-only build), so the release job needs
  its own stricter gate refusing a payload-less "latest".
- **The SD-card zip is extracted straight out of the already-built+validated
  FAT image** via the same mtools offset view `validate-image.sh` uses, so it
  can never drift from what was actually validated. Skipped for opi-prime
  (raw-U-Boot-sector + ext4 layout, no FAT partition to zip — dd-only flash).

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, the "ticker" box) form ONE ad-hoc
single-AP mesh so Ableton Link's multicast peer discovery reaches every device. No
credential provisioning: exactly one device hosts the open SSID `ticker`, everyone
else joins as a station. Changing any value below in one project alone silently
stops meshing, with no error on either side.

| Invariant | aloop | esp-idf-link |
|---|---|---|
| Mesh SSID | `src/net/config/hostapd.conf` `ssid=ticker`, `wpa_supplicant.conf` `ssid="ticker"` | `main.cpp` `wifi_scan_best_bssid("ticker")` / `wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`; `wpa=` commented out) | `wifi_connect_sta("ticker", "")` |
| AP address / DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` `192.168.4.1/255.255.255.0` |
| Channel | `hostapd.conf` `channel=6` | SoftAP ch6 |
| Link multicast | Link's hardcoded `224.76.78.75:20808` | same (hardcoded in Link) |
| Link quantum | `link_bridge.cpp` `quantum = 16.0` | `main.h` `#define LINK_QUANTUM 16.0` |
| Start/stop sync | `link_bridge.cpp` `enableStartStopSync(true)` | `main.cpp` `g_link->enableStartStopSync(true)` |
| Host election | lowest MAC/BSSID wins | lowest MAC/BSSID wins |

`PHRASE_BEATS 64.0` in esp-idf-link is NOT the Link quantum — it is that project's
transport-correction/SPP boundary (16 bars), intentionally different.

**Host election is MAC-ordered, not "host if scan found nothing".** A naive
"nothing found → host" makes two cold-booting devices both host, producing two
isolated L2 domains Link can never cross. Both projects hold for a duration
strictly monotonic in their own MAC (lowest ≈ 0s, highest ≈ 6s), rescanning
every second and joining the instant a peer's AP appears. Both supervisors
yield if another `ticker` AP with a strictly-lower BSSID appears — but never
while clients are attached.

## `src/net/autoap.sh` constraints

- Must host SSID `ticker`, never `aloop`.
- `wpa_supplicant.conf` must carry at least one active (non-commented)
  `network={}` block, or `known_net_available()` can never associate.
- The AP-mode rescan pattern must not use a naive
  `grep -oE 'ssid="[^"]*"' wpa_supplicant.conf` — grep does not skip
  comments.
- **Keep this file POSIX-clean** — busybox ash on Alpine; bashisms
  (`grep -qFf <(...)`) are a hard syntax error. Check with
  `dash -n src/net/autoap.sh`.
- **`start_ap()` must clear a previous hostapd, not just wpa_supplicant** —
  a stale hostapd holding the interface produces `Match already configured`
  then `Could not set channel`. **The channel error is a red herring — ch6
  is fine and is a paired invariant with esp-idf-link's `cfg.ap.channel = 6`;
  never "fix" this by changing the channel.**

`rc-service autoap status` reporting `started` is the real signal — a
`crashed` status with a plausible-looking `ip addr` (wlan0 at
`192.168.4.1/24`) and no AP is exactly what a broken AP looks like.

## Ableton Link integration checklist

- **Thread-correct session-state API.** `captureAppSessionState()`/
  `commitAppSessionState()` from non-audio threads;
  `captureAudioSessionState()`/`commitAudioSessionState()` from the audio
  thread ONLY. aloop calls only the App variants and hands the audio thread a
  lock-free double-buffered `LinkSnapshot` (ADR-005) — audio-side beat/phase
  is up to one control-tick stale.
- **`enableStartStopSync(true)` must be paired with both reading
  `isPlaying()` and calling `setIsPlaying()`.** aloop does both; esp-idf-link
  only consumes.
- **The three notification callbacks** run on a Link-managed thread,
  documented Realtime-safe: no — bounded logging and atomics only.
- **Tempo authority.** `setTempo` rewrites tempo for EVERY peer. aloop's
  `proposeTempo` refuses when peers are already present and aloop never set
  the tempo itself.
- **Quantum is a shared constant.** `kLinkQuantum`
  (`src/link/link_bridge.h`) and `LINK_QUANTUM` (esp-idf-link `main.h`) are
  both `16.0` and move together.
- **Telemetry carries peer count, not just a bool** (`status.json`'s
  `link.peers`/`link.playing`).
- **Interface readiness is a real race** — `depend() { after local autoap;
  ... }` plus a bounded `waitForNetworkInterface()` before `link.start()`.

## Ableton's Link Test Plan

`build/_deps/abletonlink-src/TEST-PLAN.md` is Ableton's official 12-case
Link Test Plan; audit any Link change against it. Notable project-specific
points: TEMPO-4's 20-999bpm range is matched by both projects; `effSpeed`
clamps 0.1..8.0 in `dsp/loop.dsp` and never saturates inside that range;
AUDIOENGINE-1 (onset-to-pulse alignment within 3ms) is unverified and
interacts with the SHIFT-fold latency compensation and one-control-tick
audio-thread snapshot staleness — the levers if it ever fails are a shorter
publish interval or explicit output-latency compensation, never added
buffering.

## `pinLinkThreadsToControlCore`

`ableton::Link` spawns its own internal threads ("Link Main"/"Link
Dispatcher") the moment it's constructed, with no thread-affinity hook in
its public API. `main.cpp`'s `pinLinkThreadsToControlCore` walks
`/proc/self/task`, matches by `comm` name, and `sched_setaffinity`s them
onto the control core (`kControlCore = 2`, matching `kernel/rt-tune.sh`'s
`CONTROL_CORE` — keep in sync). This fixed a real ~30-37ms/1Hz audio stall
traced to Link's own periodic peer-discovery messages contending with the
isolated audio cores; adds no audio-path latency, only steers two
pre-existing background threads' CPU affinity.

## `[link] enabled` must be parsed as a word, not `%d`

`aloop.conf`'s `[link] enabled = true` ships the literal text `true` —
`sscanf(line, " enabled = %d", &v)` returns 0 matches against that.
`cfg.linkEnabled` accepts `true`/`1`/`yes`/`on`, matching `usb_record`'s own
boolean-parsing convention.

## Unproven: AP-mode multicast forwarding on the Pi

Whether Link's multicast crosses between the Pi's own AP and its associated
stations on Broadcom `brcmfmac` is UNVERIFIED. `ap_isolate=0` is set and may
be sufficient — but the ESP32's SoftAP needed a full unicast relay beyond
isolation. Do NOT port that relay speculatively — confirm the gap on real
hardware first (`docs/LINK-MESH-TESTING.md` Tests 1-3).

---

# Audio thread and ALSA

## Two ALSA devices, never conflate them

`src/dsp/audio_thread.cpp`'s `worker()` opens two distinct PCM devices:

- **Instrument device** (default `hw:0,0`, e.g. M-Audio AIR 192|4) — the
  real tight-latency capture+playback path, opened blocking, retried up to
  30 times at 1s intervals if not yet plugged in.
- **OTG gadget** (`f_uac2`, `hw:UAC2Gadget,0`) — a best-effort MIRROR of the
  same processed output, opened NONBLOCK so a missing/non-streaming host can
  never stall the real path. `-EAGAIN` is expected/skipped; any other
  negative return triggers a one-shot recover; a permanently gone device
  degrades silently.

## Instrument device is S32_LE — ALSA silently ignores a wrong format request

Class-compliant USB interfaces like the AIR 192|4 support only S32_LE
(24-bit data left-justified in a 32-bit word) with no S16_LE fallback.
Requesting `SND_PCM_FORMAT_S16_LE` returns success while the device
negotiates S32_LE anyway — 16-bit normalization on 32-bit data produces loud
static. Buffer type is `int32_t`, normalization divisor
`2147483648.0f`; the negotiated format is read back and compared against the
request, warning loudly on mismatch. The OTG gadget mirror is a genuinely
separate S16_LE device — the two output paths need separate wire buffers in
their own native formats.

## Playback needs `start_threshold` lowered to one period

The hw_params default `start_threshold` for a PLAYBACK stream is the full
`buffer_size`; this block loop writes only one N-frame period per
`snd_pcm_writei()` then blocks on the next capture read, so playback stays
`PREPARED` forever and desyncs from capture. Fix:
`snd_pcm_sw_params_set_start_threshold(pcm, sw, period)`.

## ALSA period/buffer sizing: 4 periods minimum

2 periods (256 frames, ALSA minimum) produces hundreds of xruns/sec on the
USB instrument-device PCM. 4 periods at the real `block_size` N keeps the
same latency granularity with enough slack for USB transfer-scheduling
jitter on top of SCHED_FIFO jitter. The OTG gadget mirror deliberately uses
looser timing (period = 4xN, buffer = 4x that).

## `f_uac2-gadget.sh`: `req_number` must be 4, not the kernel default 2

`req_number` is the f_uac2 driver's isochronous USB request queue depth,
separate from ALSA's `buffer_size`/`period_size`. The default of 2 silently
caps ALSA's negotiated `buffer_size` at 256 frames regardless of what
`hw_params` requests. The gadget presents a STEREO wire (`c_chmask`/
`p_chmask = 0x3`) — `wireCh` handling averages capture L/R to mono for the
Faust DSP and duplicates the mono result onto both playback channels; DSP
stays mono internally. Runs at boot from `/etc/local.d` after `libcomposite`
loads.

## `main.cpp` declares `AudioThread` before starting the MIDI thread on purpose

`aloop::AudioThread audio;` is declared, and its address handed to
`runMidiLoop` (for live LED VU-meter telemetry), BEFORE `audio.start()`
runs. Safe only because `AudioThread::snapshotTelemetry()` returns the
default-constructed all-zero `Telemetry` before `start()`, never
uninitialized state — any future change to `AudioThread`'s construction must
preserve this default-safe-snapshot property.

## Flush-to-zero must be set explicitly on the audio thread

Denormal floats occur naturally in any decaying IIR filter/feedback loop
and are 10-100x slower on both ARM and x86. No portable C++ API on ARM —
`setFlushToZero()` sets the AArch64 FPCR FZ bit via inline assembly on
`__aarch64__`, SSE intrinsics on x86. Applied once at thread startup.

## `AloopLoopDsp` must be heap-allocated, never a stack-local

`sizeof(AloopLoopDsp)` is ~320 MiB (20 loopers x `MAXLEN=48000*60` rings
each). A stack-local SIGSEGVs at the first local-variable stack write since
the frame is unmapped the moment the stack pointer moves to make room. Use
`std::make_unique<AloopLoopDsp>()` at thread startup, never in the per-block
RT hot path. The `Sampler` (~5.3MB) is heap-allocated the same way.

## Per-block hot path: resolve string-keyed lookups ONCE, never per block

Both the control WRITE path and the telemetry READ path cache resolved
`(ParamStore slot, Faust zone float*)` pairs at thread startup, rebuilt only
when `ParamStore::count` grows (`resolvedControls`/`sidechainSrcSlot`/
`looperTelemetryZones[]`). Doing this per-block previously produced `readi()`
taking 2.2-2.7ms against a 1.333ms expectation with unbounded-climbing
xruns. Diagnostic signal for this class of bug: `/proc/<tid>/schedstat`
showing the RT thread on-CPU ~95% with far fewer voluntary context switches
than the real block rate implies; `/proc/<tid>/stat`'s `state` should read
`S` between blocks, not `R`.

## `FaustUI` shim must register bargraph zones

`addHorizontalBargraph`/`addVerticalBargraph` in the hand-written `FaustUI`
shim must do `zones[full(l)] = z` like every other control type, or every
`hbargraph()` zone falls through to an O(n) linear suffix-scan fallback on
every `fui.get()`.

## `targetToZone()` must have a case for every control target

A missing case falls through to `return ""` and the value silently never
reaches the Faust zone — zero error output.

## `masterPhaseBuf` must ramp per-sample within the block

`dsp/loop.dsp`'s `absPos` formula treats `masterPhase` as this looper's
actual per-sample READ POSITION at `effSpeed==1.0`. Filling it via
`std::fill()` with a block-constant value freezes `readIdx0`/`readIdx1`
within each block and jumps 64 samples at block boundaries — audibly
indistinguishable from bitcrushing. Fill as
`masterPhaseBuf[i] = masterPhaseSamples + i`, wrapped at `masterLen` via a
running accumulator (verified bit-exact against the `fmod` formula).

## Recording must tap a dedicated post-fx Faust input, never fold post-fx into `fin`

`loop.dsp`'s `process()` has a dedicated second input `prevFiltIn` that ONLY
the record-capture term consumes, structurally preventing post-fx content
re-entering `fx`. `audio_thread.cpp` feeds it from `prevFiltOut`, a
snapshot of the previous block's fully-effected mix — recording must always
capture the fully-effected signal, not raw pre-fx input.

## Sampler capture taps `prevFiltOut`, same one-block-lag discipline

`captureBlock` reads `prevFiltOut`, never `fin` (which, post-`renderInto()`,
contains this block's own sampler-playback voices — capturing from it would
let a sample record itself).

## SHIFT (`fx/monitorfold`) native fold mechanism

`worker()` does `fin[i] += prevLoopSum[i] * combinedFold` whenever
`fx/monitorfold` is engaged, ramping `foldGain` at `kFoldStep` (1/16 per
block). `prevLoopSum` is always exactly one block behind the live signal.
`foldTarget` also depends on whether any transpose voice is gated
(`foldTarget = (shiftHeldNow && !anyXposeVoiceGatedNow) ? 1.0f : 0.0f`) — a
SHIFT+held-key pitch-lock must not simultaneously play the raw unshifted
loop alongside the locked wet bus.

## SHIFT-hold recording latency compensation

SHIFT's fold adds one block of lag into what gets captured.
`dsp/loop.dsp`'s `latencyBiasN` is subtracted from `masterPhase` at the
instant `recordStartPhaseOffset` latches. `applyRecPlayCycle` writes
`kShiftFoldBlockLatencySamples` (64) at FINISH if
`m_looperShiftHeldDuringTake[looper]` was ever set during the take, else 0 —
sampled every `pollHolds` tick against `fx/monitorfold`, reset at ARM.

---

# Faust DSP

## `par()`-replicated UI controls silently duplicate — use signal inputs

A `button()`/`hslider()` inside a function that `par()` instantiates N times
gets RE-ELABORATED at each call site — even with the declaration text
hoisted outside the `par` and passed as a parameter. Verify against the
generated C++ (`grep -c '"speed"'` must be 1, not 20), never against how the
source reads. Fix: thread the value as a plain signal input to `process()`.
Genuinely per-looper values that only change once per take (`finishtarget`,
`latencybias`) are correctly `par()`-replicated hsliders. Momentary/held UI
state is threaded as signal inputs by convention even in non-`par()`-wrapped
files (`multitranspose.dsp`'s `note`/`gate`/`free`).

## Faust has no runtime branching

`select2`/`ba.if` choose among ALREADY-COMPUTED signals; there is no
in-Faust way to skip a stage's cost based on its own runtime amount being
zero. Any "gate this expensive stage when its amount is 0" idea must be
solved at the topology level (move the stage to another core/plugin), not
with a selector. This is why `effects_runtime.dsp` has no in-Faust `fx/bank`
3-way crossfade (a real ~7pp `core_busy` regression when tried) — Guitar and
Lofi-Fx live in a permanent Core-3 LV2 bundle instead, always active, never
gated. It is also why Resonode was pulled out into its own conditionally-
called LV2 bundle (see LV2 hosting section).

## Faust direct function-call syntax substitutes whole expressions, not buses

`f(loop(...), a, b)` binds the ENTIRE multi-wire `loop(...)` output to `f`'s
FIRST formal parameter — function application is closer to textual
substitution than a wire-count splice (symptom: `too much arguments`
buried deep in the callee). `:`-based composition wires positionally by
wire count. Correct idiom: build the bus with `,` then pipe with `:`.

## Faust stdlib functions can hide oversized buffers

Always read the real stdlib definition (`/usr/share/faust/*.lib`) before
trusting a call site's own window/size argument — `ef.transpose` has a
HARDCODED `maxDelay=65536` independent of the window argument passed. This
is why `multitranspose.dsp` originally defined its own local `xpose` sized
to its real usage ceiling instead of calling `ef.transpose` directly; that
local shifter itself has since been replaced by the per-voice
`EngineSoladSnac` C++ engine (see the `multitranspose.dsp` section below),
so the concrete example is gone, but the underlying stdlib-footgun lesson
still applies to any future `ef.transpose`/similarly-sized stdlib call.

## Faust compiler flags — currently shipped

**`-vec -fun -dfs -vs 32 -nvi -ct 0`** at every real `faust` invocation site
(`build-local.sh`, `build-binary.yml`, both jobs in `build-lv2.yml`).
`-ct 0` (disable table range-checking) is safe because every `rwtable` index
in this codebase is software-bounded already (`dsp/loop.dsp`'s
`readIdx0`/`readIdx1` modulo `wrapLen`; `microrepeat.dsp`'s `wpos`/`rpos`
clamped/modulo'd). **Any new `rwtable` needs its own explicit index-bound
trace before this flag stays valid.**

**`-mcpu=cortex-a72`** at every real target-compile step, NOT on the two
native-host `.ttl`-metadata `g++` compiles (those run on the CI runner's
x86_64).

**`-O3`** for the aloop binary, matching the LV2 `.so` builds — no
`-Ofast`, no `-march=native`, no fast-math.

`-vs 16` measured a real ~14% CPU reduction over the shipped `-vs 32` on
x86_64 CI hardware, but is REJECTED on CI-witnessed evidence (2026-08-24,
commits 468c10541a → reverted in 655e742e09): with all invocation sites moved
together, the real `faust` compiler was killed by SIGALRM ~2 minutes into
codegenning `dsp/aloop_pre.dsp` — `build-binary.yml` and `build-lv2.yml` both
failed hard before any binary existed to A/B. Do not re-propose without a
fresh, separately-justified compile-time investigation; all invocation sites
must still move together if ever retried.

**Faust already CSEs `par()`-replicated pure-signal subexpressions** — a
subexpression built purely from already-shared signal inputs (no UI
primitive) already compiles to exactly one instance across `par()`-replicated
call sites, including through recursive `~` signals. Only `button()`/
`hslider()` boxes are exempt (each must produce its own zone). Before
proposing a manual hoist, check the real generated C++ call count first.

## Faust compiler flags — deliberately NOT shipped

- **`-mapp`** — 100%-reproducible real-aarch64 SIGSEGV inside
  `AloopLoopDsp::compute()` despite a byte-identical synthetic x86_64 A/B.
  Re-adding requires a fresh live Pi 4 test with real audio.
- **`-fm def`** — emits calls to `fast_tanf`/`fast_powf`/etc. from
  `faust/dsp/fastmath.cpp`, an architecture file meant for `-lang cpp`
  output, never baked into `libfaust` — the LLVM JIT can't resolve those
  symbols and segfaults at `render()` on every real-usage case while
  `compile()` reports success. See `test/faust-flags/README.md`.
- **`ba.tabulate`** for `filters.dsp`'s/`pitch.dsp`'s `pow()` calls — both
  files claim exact-port/bit-identical hardware parity; tabulation is
  inherently approximate.
- **Splitting the home Faust stack or Core-3 bundle into per-effect LV2
  bundles** — multiplies per-plugin dispatch on the RT block path.
- **Faust's `-omp`/`-sch` scheduler** — fights this project's own manual
  per-core `pthread_setaffinity_np` pinning.
- **`-mcd`/`-dlt`** — govern only `de.delay`-family codegen, not `rwtable`
  (this project's rings). `delay.dsp`/`reverb.dsp` are comfortably above
  the default `-mcd 16` regardless.
- **`-clang`** — every real target compile here uses gcc/g++.
- **`-mem`** — for genuinely separate memory banks; the Pi 4 is a normal
  unified-heap Linux process.

## Buffer sizing constants — current values and why

Buffer sizes here are all "real usage ceiling + margin", verified bit-exact
against the unsized-down original via DawDreamer JIT before shipping:

- `delay.dsp`'s `MAXD = 52000` (real ring 65536 floats) — `TIME`'s own
  `targetSamples()` caps the real usable delay at ~999.6ms (~47999 samples
  @ 48kHz), roughly half the previous `96000`.
- `microrepeat.dsp`'s `MR_MAX = 36000` — `sliceLen`'s real reachable
  ceiling across the full `DIV`/`MLB` grid is exactly 32768; `rwtable`
  allocates its declared size exactly (unrounded, unlike `de.delay`'s
  power-of-2 rounding).

`-ct 0`'s safety story is untouched by any of the above — `de.fdelay`/
`de.delay` sizing is a structurally different mechanism from the
`rwtable`/`table` primitives that flag governs.

## Faust comments compile away to nothing

A comment-only diff produces byte-identical generated C++ — confirmed via
real `faust -lang cpp` A/B, no DawDreamer render or real-hardware check
needed to trust a comment removal. The entire `.dsp` tree (`dsp/` and
`effects/home/faust/`) is comment-free, per the no-comments working rule.

## Parameter smoothing order is deliberate

`effects_runtime.dsp`'s `filterStage`/`delayStage`/`reverbStage`/
`pitchStage` take raw `hslider` values straight into `pow()`/`exp()`-bearing
math with no `si.smoo` upstream — intentional, since the audio path is
verified against per-render-constant normalized CC values with an
all-defaults byte-exact passthrough, matching the looper's own per-block
piecewise-constant behavior. Adding `si.smoo` would change transient
response and break that parity guarantee.

## `bitcrush.dsp` `BITS_MAX` is 24, not 16

At `BITCRUSHAMT=0`, `BITS_MAX=16` would quantize to 16-bit resolution
unconditionally (~500x the float32 rounding floor) — the real production
path never round-trips through int16 (instrument device negotiates
S32_LE/24-bit), so this was a real always-on precision floor. `24` brings
the amt=0 diff to the expected float32 rounding band while leaving the
crushed extreme unchanged.

## `delay.dsp` slew recursion must have no additive drift term

`curStep(target, c) = c + (target - c)*SLEW` (`SLEW=0.0001`) — a `+1.0`
term (mistaking a bookkeeping tautology in a C++ reference comment for a
required correction) has fixed point `target + 10000` samples, a hidden
~208ms floor under every TIME setting. `MIN_DELAY_MS = 1000.0/SR` (1
sample); TIME sweeps linearly 0.02ms to ~999.6ms. Warm the ring ~90000
samples before measuring anything in this file.

## `multitranspose.dsp`: polyphonic pitch-LOCK, 6 voices — current architecture

`effects/home/faust/multitranspose.dsp` is an NVOICES=6 polyphonic
pitch-LOCK stage (Digitech Whammy / Infected Mushroom Manipulator
behavior): the output lands on the exact held key regardless of what pitch
is actually being played. Strictly additive with the existing mono SNAC
engine (`fx/pitchbend`, CC52/mod wheel, `pitch_ffi.h`), which remains the
mono "pedal ride" lane, untouched.

**Shifter engine (current, post-`xpose` rewrite)**: each of the 6 voices
now owns its own `EngineSoladSnac` instance (`pitch_poly.dsp` /
`pitch_poly_ffi.h`, a `DubfxPolyVoice[6]` array) — the SAME SNAC-tracked
splice-based PSOLA engine that already powers the mono "pedal ride" effect
(`pitch.dsp`/`pitch_ffi.h`/`soladSnacOctaver.h`), made polyphonic. The
OLD per-file two-tap delay-line `xpose()` shifter (pitch-synchronous
window/crossfade sizing, `windowFor()`, `winSkewMul`/`formantXfSkew`,
`xposeMaxDelay`) no longer exists anywhere in this file or the codebase —
do not look for it. `shiftAmount = targetNote - heldDetNote` (still
sampled once per voice at `attackEdge`, held for the whole sustain per the
same absolute-pitch-lock design) converts to a ratio (`pow(2, shiftAmount
/ 12)`) and is threaded straight into the per-voice engine as a plain
signal argument, per the compile-time-cliff discipline below.

**Current mechanism (absolute pitch-lock, per explicit user direction — an
earlier "interval harmonizer" rearchitecture was tried and reverted)**:
unchanged from before the shifter rewrite. The detected pitch source is
`freqDet = ba.if(extFreqDet > 0.5, extFreqDet, detectedFreq(sigIn))` —
prefers the external `pitchtracker.lv2` autocorrelation tracker's reading
(`fx/extfreqdet`, fed from `audio_thread.cpp` via `pitchTrackerFx`) when
present, falls back to the internal zero-crossing tracker
(`trackPitchHzAndHp`/`jumpGuard`) otherwise.

**Known, disclosed, current limitation**: the internal zero-crossing
fallback tracker (when `pitchtracker.lv2` is NOT loaded) has a real,
unresolved note-selection accuracy problem — it can take well over 400ms to
converge and can drift non-monotonically rather than settle. With
`pitchtracker.lv2` genuinely loaded (the real, intended on-device
configuration — see deploy section), lock is near-instant and accurate
(~11-38 cents on real recordings spanning piano/violin/vocal/brass/
woodwind/marimba/vibraphone). Do not attempt a timing-based heuristic fix
for the fallback tracker's convergence in `multitranspose.dsp` itself —
this file's own history (see `[[memory: faust-compile-time-cliff]]`)
records the real, repeated risk of touching this file's tracker internals.

**Voice mechanics**: `an.pitchTracker`-derived detection runs on the live
input once per sample (shared instance, not per-voice). Each voice's shift
glides via a one-pole (`normalGlidePole`, `tau2pole(0.008)`), gated by
`en.adsr` (3ms attack/30ms decay/sustain 1/50ms release — 50ms release is
the verified click-free value), then shifted+formant-shaped by the
per-voice `EngineSoladSnac`+`GrainFormant` engine (see below), block-
buffered at 64 samples (~1.333ms), the same fixed algorithmic latency as
the mono engine's wet effect regardless of pitch or formant. Gain staging:
fixed per-voice gain (0.6) + static `ma.tanh` soft-clip on the summed bus
(never a dynamic `1/sqrt(activeVoices)` renormalization — that pumps on
every chord-note release). Voice allocation: round-robin/oldest-steal
(`allocateTransposeVoice`/`releaseTransposeVoice` in `ApcGrid`) — a held
note reuses its own slot, an unheld slot is preferred, oldest-triggered is
stolen once all 6 are held (ADSR re-attacks, and each steal calls
`EngineSoladSnac::reengage()` to reset that voice's read position/period
tracking cleanly). Note-off releases by GATE only, never a hard cut.

**Formant control** (`fx/formant`, CC53) reaches this engine as a plain
signal argument into `pitchPoly`'s `process()`; real-world CC range is
`((data2-64)/63)*1.5` clamped to the `-3..3` hslider range in
`effects_runtime.dsp`, so the practically reachable magnitude is ~1.5, not
3 (`applyFormantCC` in `apc_grid.cpp`, gated on `(m_liveEngaged ||
m_keysMode==KeysMode::MultiKey)` — a genuine no-op when neither pitch-shift
engine is active).

**Investigated but NOT fixed this way — a tempting routing fix for "gappy"
turned out to be unsafe, keep it that way**: `EngineSoladSnac::processBlock()`
blends two internal signals — the phase-coherent splice/PSOLA reader (`y`)
and `GrainFormant`'s independent overlap-add grain resynthesis (`gOut`, the
ONLY path that moves formants independently of pitch) — and forces the mix
to `1.0` (100% grain path) for ANY upward shift beyond `scale > 1.02`
(~0.34 semitones) regardless of the formant setting. It looked like exactly
the mechanism behind "pushing the pitch up a bit with neutral formant makes
it gappy" (neutral formant silently still meant "use the grain path"), and
also behind "some pitches/formants are more latent than others" (the grain
path's own `targetLag = Tin*(3+fm)` scales with the detected period and the
formant factor). **A real attempt to disable the forced-grain override for
the polyphonic voices only (leaving the mono "pedal ride" engine's default
untouched) was built, then reverted after direct measurement proved it
unsafe**: a standalone C++ harness linking `soladSnacOctaver.h` directly
(bypassing Faust/DawDreamer entirely — see the JIT-limitation note below)
showed the splice-only path (`y` alone, `mixTgt` forced to 0) is NOT
pitch-accurate for real shifts on a clean sine — up to **-200 cents**
(nearly 2 semitones flat) at some frequency/shift combinations, worst around
+1-2 semitones at 110-220Hz, independent of any formant or vowel/sibilance
work. This bug was never visible before because the `scale > 1.02` override
ALWAYS routed every real shift through the (separately measured, ~1-5 cents
accurate) grain path, on both engines, unconditionally — so "the splice path
alone is high quality" (this file's own prior "0.99-1.00 spectral purity on
a clean sweep" claim, which is about harmonic distortion, not frequency
accuracy) was never actually tested at real shift amounts. **Do not disable
or raise the `scale > 1.02` forced-grain threshold on either engine without
first fixing this splice-path frequency bug** (most likely in
`triggerSpliceByPeriod`'s period-multiple resplicing interacting with the
active/passive crossfade) and re-verifying with the same kind of direct
sine-frequency harness — a plausible next step for a session with more
time, but out of scope for the fixes actually shipped here. The literal
"gappy" root cause on real (non-sine) signal therefore remains OPEN — the
grain path is confirmed pitch-accurate and free of gross amplitude dropouts
on both synthetic sine and real vocal/piano/violin corpus content (measured
via the same harness, zero-drop RMS-ratio check across neutral/±1.4 formant
and 0.5-2 semitone shifts), so the remaining "gappy" quality is most likely
a subtler artifact (grain-overlap phase drift when the SNAC period estimate
`Tin` isn't exactly locked between its ~43ms `SNAC_HOP` updates) that needs
real-hardware/real-mic listening to characterize further, per the project's
own "compiling/synthetic-testing clean proves nothing" rule.

**Real formant/vowel/sibilance shaping (new)**: `vowelFormant.h` adds a
`VowelFormantShaper` (3 parallel RBJ peaking biquads tuned to F1/F2/F3 of a
5-point vowel table — U/O/A/E/I, from
`{300,870,2240}`/`{570,840,2410}`/`{730,1090,2440}`/`{530,1840,2480}`/
`{270,2290,3010}` Hz) and a `SibilanceDetector` (a ~4kHz one-pole
highpass energy ratio against a slower broadband envelope). Both are
per-voice, applied in `pitch_poly_ffi.h`'s `dubfx_poly_shape_block()`
right after `EngineSoladSnac::processBlock()` fills that voice's 64-sample
output block — plain C++ math against the existing `formant` scalar and
the block-aligned dry `inBuf`, so this needed NO new Faust UI primitive
and carries none of the compile-time-cliff risk below. The existing
`fx/formant` scalar now does double duty: its magnitude (normalized
against the ~1.5 practical CC range) is both the `GrainFormant` mix depth
(unchanged) and the vowel-filter blend depth, and its sign/position maps
onto the U-O-A-I-E vowel continuum, so sweeping the one existing formant
knob morphs through real vowel coloration on top of whatever `GrainFormant`
mix the engine already settles on, instead of just a spectral-tilt
brightness cue — at `formant=0` both new stages are fully bypassed (zero
coloring, verified identity). Sibilance detection runs unconditionally (not
formant-gated): a detected fricative/consonant crossfades the voice's
output back toward its own raw dry input (up to 85%) so "s"/"sh"/"f"/"t"
transients stay intelligible instead of being pitch/formant-warped.
Verified via a standalone C++ harness (`pitch_poly_ffi.h` linked directly,
no Faust JIT involved — see the DawDreamer-limits note below): finite/
bounded output across the full formant/shift extremes (formant -3..+3,
shift -24..+24 semitones), and pitch accuracy within ~5 cents at neutral
and positive formant on a clean sine (matching the underlying engine's own
accuracy, i.e. the vowel EQ does not itself perturb pitch). At strongly
NEGATIVE formant (`d` near the practical -1.5 floor) the same harness shows
a real, reproducible ~70-90 cents flat error that predates this session's
changes (confirmed by testing raw `EngineSoladSnac`/`GrainFormant` with no
vowel/sibilance code at all) — consistent with this file's own
already-documented free-transpose-engine note that "negative side is
flatter/more non-monotonic... an inherent asymmetry in the `factor=
powf(2,d)` mapping, not an engine defect"; the vowel/sibilance addition
does not make this worse or better. The vowel filter's exact Q/gain
constants and the sibilance detector's HF-corner/ratio thresholds are a
first real implementation, not by-ear-tuned on real hardware yet — needs a
live-mic pass on the Pi 4 before calling the vowel/sibilance character
final.

**Compile-time-cliff discipline for this file**: `[[memory:
faust-compile-time-cliff]]` — any new UI primitive declared inside
`multitranspose.dsp` itself risks an unbounded real-`faust`-CLI compile
time regardless of DawDreamer JIT results. New controls affecting this
engine are declared elsewhere (e.g. `effects_runtime.dsp`) and threaded in
as plain signal arguments. This is why the vowel/sibilance shaping above
lives entirely in the C++ FFI headers instead: it needed zero new Faust
declarations.

**DawDreamer JIT cannot compile `multitranspose.dsp` (or `pitch.dsp`)
directly anymore** — `pitch_poly.dsp`'s `ffunction` declaration hits the
same "calling foreign function ... is not allowed in this compilation
mode" JIT limitation documented below for `pitch.dsp`. `test-audio-corpus/
real_audio_cross_verify.py`'s direct `set_dsp(".../multitranspose.dsp")`
call predated the `xpose`-to-`EngineSoladSnac` rewrite and stopped
compiling once `multitranspose.dsp` started pulling in `pitch_poly.dsp`'s
`ffunction` — fixed by porting it to the same pattern
`free_transpose_harness.cpp` already used for the mono engine: a new
`test-audio-corpus/multitranspose_harness.cpp` links `pitch_poly_ffi.h`
directly (no Faust/DawDreamer involved) and `real_audio_cross_verify.py`
now shells out to it per test case instead of calling `daw.RenderEngine`/
`make_faust_processor` at all. This is also the pattern to reach for when
verifying any future change to this file's shifter/formant/sibilance
behavior — a standalone C++ harness against the real FFI, never the JIT.

## `pitchtracker.lv2`: standalone autocorrelation pitch tracker

`effects/pitchtracker-src/pitchtracker_ac.dsp` — a genuinely separate
compilation unit (not folded into `multitranspose.dsp`, per the
compile-time-cliff constraint above), built into its own LV2 bundle
(`build-lv2.yml`'s `pitchtracker-lv2` job), hosted via a dedicated
`Lv2Host pitchTrackerFx` in `audio_thread.cpp`
(`AudioConfig::pitchTrackerDir`, default `/effects/pitchtracker`).
Normalized-autocorrelation-based (not zero-crossing), with a
local-maximum-peak candidate selection (`pickFundamental`) to reject
harmonic/subharmonic false locks and a `holdLastGood`/`energyReady` onset
gate (holds output at `0.0` for the first ~35-40ms of any fresh onset,
correctly signaling "no reading yet" to `multitranspose.dsp`'s
`extFreqDet > 0.5` fallback check). Structurally immune to the
broadband-burst/plosive octave-search failure class that plagued the
zero-crossing tracker — folds cleanly to its floor (60Hz) during noise and
recovers within ~15-25ms of a burst ending, rather than swinging through
wrong octaves. Verified accurate on real recorded audio across a wide
register (82Hz-1500Hz+) and a broad instrument/vocal corpus. Must be
deployed to the device (`/effects/pitchtracker/pitchtracker.lv2/`) for
`multitranspose.dsp` to use it — see deploy-two-paths memory for the
artifact-fetch wiring this depends on.

## Free-transpose engine (`soladSnacOctaver.h` / `EngineSoladSnac`)

The `-12` live pitch engine, bridged into Faust via `pitch_ffi.h`/
`pitch.dsp`'s `dubfx_pitch_tick` `ffunction` (ADR-004). Combines a SNAC
(McLeod/Tartini-style) pitch tracker on a 1024-sample sliding window with a
solad delay-line PSOLA-style shifter (drifts by construction, resplices by
an INTEGER MULTIPLE of the detected period to stay phase-coherent) and an
independent-formant grain-playback-speed stage (`grainFormant.h`).

**Key current values/mechanisms**:
- Algorithmic delay `INITIAL_READ_OFFSET_DEFAULT = 64` samples (1.3ms);
  `m_respliceFrac = 1.0` (resplice once the reader drifts ~1 period past
  target, the PSOLA minimum).
- Splice search matches value+slope ONLY among already-integer-period
  candidates (never continuous-then-snap) — frequency-neutral and
  seamless simultaneously.
- `triggerSpliceByPeriod` jumps by AS MANY whole periods as needed to clear
  accumulated drift in one splice, plus a `per*0.9`-sample cooldown — avoids
  a resplice storm.
- SNAC's full autocorrelation sweep is chunked across blocks
  (`LAGS_PER_STEP=48`/block) to avoid a real-time deadline overrun;
  `SNAC_HOP=2048` throttles how often a fresh sweep is armed; `m_lockMiss`
  requires 3 consecutive peak-pick misses before `m_periodValid` clears.
- `reengage()` seeds a period BEFORE SNAC's first lock:
  `kReengageSeedPeriod = 600.0f` (~80Hz) — deliberately LONG so no real note
  can ever bias toward a half-period (octave) splice error.
- Sinc-kernel phases are normalized to unity DC gain (fixes a real ~20%
  envelope-modulation tremolo).
- Crossfade is EQUAL-GAIN LINEAR, never equal-power cosine — the two
  readers being crossfaded are correlated (one period apart on a
  quasi-periodic signal), so cosine fades sum to up to +3dB mid-fade.
- `m_transientHold` holds off resplicing for ~2 grains after a detected
  transient, avoiding a double-played attack. The separate snap-to-live
  transient-response mechanism is DISABLED in shipped code (introduced a
  worse spike than the smearing it fixed).
- Quiet-input emergency escape: while `m_envSlow < 0.004`, the reader
  clamps to a safe distance behind the writer with no splice, avoiding an
  unaligned reset mid-silence that would click the next note's onset.
- `DL=32768` (128KB/channel ring) — downsized from a prior 131072 which
  bloated `RubberBandWrapper`'s single allocation and corrupted on the Pi's
  32-bit-pointer build.
- `MIN_PERIOD=48` (1000Hz tracking ceiling) — raising to 32 was measured
  and REJECTED: it genuinely raises the ceiling but real wet-output pitch
  accuracy got WORSE (short-period candidates jitter between adjacent SNAC
  values sweep-to-sweep, injecting real phase error into splice cadence
  that a stable-but-technically-"wrong" subharmonic lock never had).
- Formant control: real, strong, measured on real audio — positive-side
  brightening is large and clean; negative side is flatter/more
  non-monotonic in short windows (an inherent asymmetry in the `factor=
  powf(2,d)` mapping, not an engine defect). A real monotonic RMS loudness
  cost accompanies brightening; a make-up-gain fix was measured
  (grain-path RMS ~57-73% of clean-reader RMS) but deliberately NOT
  implemented — needs by-ear tuning on real hardware, not a blind constant.
- Historical note: this bullet used to contrast this engine against
  `multitranspose.dsp`'s OWN, now-removed, `xpose()` two-tap delay shifter
  ("structurally different splice algorithms"). That's no longer true —
  `multitranspose.dsp`'s 6 voices now each run this exact same
  `EngineSoladSnac` class (see the `multitranspose.dsp` section above), so
  there is only one splice/PSOLA implementation in the codebase now, shared
  by both the mono and polyphonic engines. The measured spectral purity
  (0.99-1.00 THD on a clean sine sweep up to 5000Hz, no degradation near
  700Hz) still stands for this class in general, but see the
  `multitranspose.dsp` section's "Investigated but NOT fixed" note for a
  real, separately-discovered FREQUENCY-ACCURACY (not THD) bug in the
  splice-only mixing mode (`mixTgt` forced to 0) that applies equally to
  both engines and is currently masked on both by the `scale > 1.02`
  forced-grain-mix default.

**Open, disclosed bug**: a genuine SNAC period-tracker drift bug on
tremolo/amplitude-modulated or dynamically-varying content (e.g. vibrato,
forte dynamics, trill technique) — `detectPitchStep()`'s anti-jitter clamp
(`maxDelta = m_period/8 + 2`) forces a slow multi-step climb toward a wrong
subharmonic candidate rather than rejecting it outright, when a raw
autocorrelation sweep genuinely prefers a longer lag. A first-strong-peak
candidate-selection fix (McLeod/SNAC-paper style "take the shortest local-
max peak clearing 90% of the sweep's global max", rather than always
trusting the tallest peak) was shipped and verified to fix this for
STEADY/non-modulated content — but tremolo/dynamic content specifically
still reproduces the drift. Several further fix attempts (plausibility-gate
margin checks, `slowRef`-style second references) were tried and rejected —
see `[[memory: cold-start-self-trap]]` for why a second reference derived
from the same raw stream doesn't help. Not currently fixed.

## `pitch.dsp` / `dubfx_pitch_tick` ffunction bridge

`pitchTick = ffunction(float dubfx_pitch_tick(float, float, float, float),
...)` rides params (`scale`/`FORMANT`/`ENGAGED`) in on the SAME per-sample
call as the audio sample — a separate params-only call site would let Faust
constant-fold params away on some paths. `dubfx_pitch_tick` internally
buffers exactly `DUBFX_BS=64` samples and calls the real `processBlock(...,
64)` once per block (matching the looper's own cadence, since
`EngineSoladSnac`'s SNAC cadence is tuned to 64-sample blocks specifically)
— this introduces a genuine, permanent 1-block (~1.333ms) algorithmic
latency while engaged, covered by the "wet effect's own algorithmic
latency" carve-out in the Working Rules, not a violation of the
never-add-latency rule.

## DawDreamer verification harness

Numeric/behavioral verification of `.dsp` changes uses
[DawDreamer](https://github.com/DBraun/DawDreamer)'s `FaustProcessor` — a
real Linux `libfaust` LLVM JIT with a `compile_flags` passthrough
(`pip install dawdreamer`). `test/faust-flags/` is a committed example.

Known limits (see also `[[memory: faust-verification-discipline]]`,
`[[memory: faust-compile-time-cliff]]`):

- **The JIT refuses to link `ffunction`-declared external symbols**
  (`dubfx_pitch_tick`). Harnesses needing `effects_runtime.dsp`/
  `aloop.dsp` stub `pitch.dsp` to a bare passthrough; `pitch_ffi.h` itself
  is never touched.
- **`FaustProcessor`'s parameter list is alphabetical, not
  declaration-order** — match hsliders by name via
  `set_parameter`/`get_parameters_description()`, never raw index.
  `set_automation(name, array)` applies at the next 64-sample block
  boundary, not the exact sample requested.
- **Faust constant-folds `tan()`/`pow()` of a literal at compile time** —
  sweep with a real runtime `hslider`, matching production wiring.
- **`df.box.boxFromDSP`/`boxToSource`** (inside a `with
  df.FaustContext():` block — calling without it SEGFAULTS immediately)
  runs the REAL codegen path, not the JIT, and is the local reproduction
  for the compile-time-cliff class of bug (95-500+ real seconds per
  iteration, much cheaper than a full CI round-trip).
- Warm delay-line-bearing files ~90000 samples before measuring.

`faust2bench` (real Linux host) is the CPU-measurement counterpart for any
Faust-flag A/B. A mandatory `build-binary.yml` "Benchmark CPU usage" step that
once ran it was REMOVED: its output was human-read-once diagnostics already
recorded here, and it became a real, repeated source of CI stalls (3 of 4
build-binary attempts hung indefinitely on it around the Resonode-LV2
extraction change), blocking every real build behind a step nothing needed.
Run it manually only when a Faust-flag change needs a fresh measured
comparison — never as a critical-path CI step again. Standard invocation: 20
runs, `-bs 64`, real shipped Faust flags, isolated via a `git stash`/
rebuild A/B on the same tree.

---

# LV2 hosting

## Never pass a bare `nullptr` for the features array

`Lv2Host::instantiate()` (`src/host/lv2_host.cpp`) must pass a real,
NULL-TERMINATED `LV2_Feature* const*`. Faust's generated `lv2.cpp` does
`for (int i = 0; features[i]; i++)` with no null-check on `features` itself
— a bare `nullptr` derefs at `features[0]`. Use
`static const LV2_Feature* const kNoFeatures[] = { nullptr };`. Wrap
`instantiate()`/`activate()` in the same sigsetjmp crash-isolation watchdog
`runOne()` uses (ADR-002) — a plugin crashing during LOAD is as untrusted as
one crashing during `run()`.

## `readTtl()`'s bundle match must strip trailing slashes

lilv's resolved bundle path carries a trailing slash the passed-in
`bundlePath` never has, so a raw prefix comparison silently and permanently
fails even for well-formed bundles, falling back to a no-port-wiring
`.so`-only path that gets the plugin crash-watchdog-disabled on every
startup. Strip trailing slashes from both sides and compare for exact
equality.

## `setControl` must match Faust's MANGLED LV2 port symbol

Faust's `lv2.cpp` architecture (`mangle()`) never emits a control's raw
Faust label as the LV2 `lv2:symbol` — non-alnum/non-underscore chars
(including `/`) become `_`, then `"_<portIndex>"` (declaration-order) is
appended. `hslider("fx2/FLANGEAMT", ...)` becomes `fx2_FLANGEAMT_3`.
`Lv2Host::setControl` matches by MANGLED-LABEL PREFIX
(`mangleFaustLabel(rawLabel) + "_"`), so target tables keep natural raw
Faust labels without hardcoding fragile per-build port indices. An
exact-symbol match silently matches nothing, permanently, with zero error
output. Verify any new LV2-hosted Faust control target against the
deployed bundle's own `.ttl` (`grep lv2:symbol *.ttl`), never assume it
equals the raw label.

## `Lv2Plugin::descriptor` is cached at `instantiate()` time

Not re-resolved via `dlsym` + URI-matching scan on every `runOne()` — that
call runs on the RT block path (Core 1 home-fx, Core 3 user-fx) every
block.

## `aloop.lv2` must be excluded from apkovl packaging

`build-lv2.yml`'s `home-fx-lv2` job compiles `dsp/aloop.dsp` — the exact
Faust source `audio_thread.cpp`'s `faustHome` already compiles natively —
into a standalone LV2 bundle purely as a CI reproducibility/packaging check
(ADR-003). Deployed alongside `guitar_lofi_fx.lv2` it runs the whole home
stack a SECOND time (`core_busy` ~23-30% → ~63-65% with continuous xruns).
`image/lib-boot-tree.sh`'s copy step excludes it by name.

## Resonode: a separate, conditionally-called LV2 bundle, not part of the always-on home stack

`effects/home/faust/resonode_synth.dsp` was originally an always-on
`component()` inside `effects_runtime.dsp` — even fully idle/unengaged it
produced a sustained ~2ms `readi` gap against the 1.333ms budget, since
Faust has no runtime branching (see Faust DSP section). Pulled out entirely
into its own standalone LV2 bundle (`resonode.lv2`, `build-lv2.yml`'s
`resonode-lv2` job), loaded via a dedicated `Lv2Host resonodeFx` in
`audio_thread.cpp` from `AudioConfig::resonodeDir` (`/effects/resonode`,
excluded by name from the general `homeFx`/`userFx` `find`).
`resonodeFx.process()` is only ever called when `fx/resonode/engaged` reads
true — the real cost elimination, verified at the C++ call site.

**Architecture**: per-voice `note`/`gate`/`vel` are LV2 control ports
(`hslider`), not signal inputs — updated once per control-tick from
`ApcGrid`'s MIDI handlers, a lossless representation change from the old
Faust-component design. `effects_runtime.dsp`'s `process()` takes a single
audio-rate `resonodeIn` signal input, filled by `audio_thread.cpp` from
`resonodeFx.process()`'s output when engaged (zeroed, not passed through,
when the LV2 host has no plugins loaded — silence is the correct
degraded state for Resonode, unlike `homeFx`/`userFx`'s dry-passthrough
default). Signal-flow order: guitar/lofi-fx (`homeFx`/`userFx`) run as an
INPUT stage on `fin` before `faustHome.compute()`, so they color what
dubfx's own pitch/harmony/filter/delay/reverb chain receives. Resonode's
exciter is fed from that same post-guitar/lofi-fx signal, and its output
re-enters `effects_runtime.dsp`'s crossfade BEFORE
`microStage:filterStage:delayStage:reverbStage`.

**`RESONODE_ENGAGED`'s Faust zone** is written directly via
`fui.set("fx/resonode/engaged", ...)` in the worker loop (matching
`MONITORFOLD`/`GLITCHFOLD`'s C++-internal-flag pattern), NOT through
`targetToZone`/`resolvedControls` — that flag has TWO real consumers (the
C++ process-gate AND the Faust crossfade checkbox), and only routing the
control-port consumer correctly does not imply the Faust-crossfade consumer
still works. Lesson generalizable: when a control target gains a second
consumer during a refactor, each consumer needs its own explicit write path
audited.

**Locked pitch must REPLACE, never layer over, the original** — a
`checkbox("fx/resonode/engaged")`-driven `resonodeEngageGate` crossfades
the entire dry/pitch-lock/harmony term against `resonodeOut`, rather than
summing `resonodeOut` into `dry` upstream of the shared filter/delay/reverb
tail (an earlier design let raw dry keep leaking through the whole time
Resonode was engaged).

**DSP mechanism (current shipped state)**: `resonode_synth.dsp` is a
6-modes/voice, 4-voice physically-modeled resonator, excited ONLY by the
live mic signal — there is NO synthetic exciter anywhere (a held key with
silent live input renders bit-exact silence) — keys drive voice
note/gate/vel only, the mic is the only sound source ("reactor mode").

**The exciter is broadband, not a note-locked bandpass.** The original
design pre-filtered the shared mic tap through a per-voice
`fi.resonbp(freqHz, 15.0, 1.0)` — a Q=15 bandpass locked to the played
note's fundamental, BEFORE splitting into the 6-mode bank. Measured via
DawDreamer JIT (`test/resonode-sweetspot/`): this made modes 2-6 receive
30-190x less excitation energy than mode 1 at the same excitation instant,
regardless of `position`/`stretch`/`damping` — the "6-mode" bank was
functionally a single resonant filter, which is why patches built from
different mode-shape/stretch settings measured audibly indistinguishable
(spectral centroid pinned to the fundamental for every patch, even ones
documented as "bright/inharmonic") and why the instrument read as
narrowband audio-feedback-like ringing rather than a struck object.
`sharedExciteIn` is now a shared (not per-voice) highpass(60Hz)+lowpass(tone)
only — each mode's own resonant filter performs 100% of the frequency
selection, matching both Gabriel Soule's Resonarium thesis and Reason
Studios' Objekt manual's documented architecture (exciter modules are
deliberately broadband; the resonator bank, not the exciter, does mode
selection). `modeFilterR`'s biquad still has the `(1-r)` numerator gain
normalization from before (unnormalized, it was permanently
`ma.tanh`-saturating regardless of input); `modeGain6`'s base coefficient
was raised from `0.16` to `0.55` to close a remaining ~30x mode6 gap that
survives the bandpass removal (a `b0`/`r`-interaction the numerator
normalization does not fully equalize at very long T60) — this is an
empirically-tuned constant, re-verify with `test/resonode-sweetspot/verify_musical_controls.py`'s
`modes_2_to_6_are_not_starved` check before changing mode-gain coefficients.

**The exciter envelope is a percussive strike shape, not a sustained-open
gate.** It was `en.asr(0.02, 1.0, 0.3, xgate)` — attack 20ms then a FULL
sustain level of 1.0 for as long as the key stayed held, meaning a
continuously-open high-Q filter kept re-processing whatever the live mic
was doing for the whole note — structurally the same shape as an audio
feedback loop. It is now `en.adsr(0.004, 0.11, 0.09, 0.25, xgate)`: a 4ms
attack, decaying to a 9%-of-peak sustain floor over 110ms, releasing over
250ms on note-off. Measured via DawDreamer against a continuous moderate
broadband-noise input (a stand-in for room tone/mic bleed): the settled
long-hold RMS relative to the onset peak dropped from ~92% (old, effectively
still wide open) to ~40% (new), with a genuine dip to ~14% in the 100-300ms
window right after the strike — a real, measured "hit-then-settle" contour
that did not exist before. `xgate` gating and voice-steal
retrigger/`stealEvent` timing are unchanged.

**`couple` — nearest-neighbor mode coupling** (`fx/resonode/couple`, knob
slot 7): each mode's excitation now also receives a scaled sum of its
immediate chain-neighbors' PREVIOUS-sample output (mode `k` couples with
`k-1`/`k+1`, a 6-node chain, mode1 and mode6 as the two end nodes with a
single neighbor each — implemented as one Faust `letrec` block over all 6
mode outputs, the general mechanism for mutually-recursive signal networks;
a scattered `x'` reference across independent `with{}` bindings does NOT
work here — Faust's box-language evaluator hits an "endless evaluation
cycle" trying to elaborate it, confirmed via real `faust compile()`
failures during development). Modeled on Resonarium's "interlinked" and
Objekt's "Coupling: On/X-Over" resonator-bank topologies — both reference
documents independently name mode coupling as the single highest-leverage
lever for timbral distinctiveness beyond a purely parallel bank (Resonarium:
"coupling-mode choice... reshape[s] the timbre... moreso than any other
exposed parameter"). A FULLY-CONNECTED coupling matrix (every mode fed by
every other mode, `O(modes^2)`) was considered and rejected in favor of
nearest-neighbor (`O(modes)`, 5 cross-terms/voice instead of 30) per both
documents' own cost-vs-richness guidance. `coupleScale = 8.0` is the
internal knob-to-coefficient multiplier (the user-facing `couple` knob is
0..1); every per-mode filter here is inherently damped (`r<1` always, no
delay-line unity-feedback loop the way Resonarium's own coupling math
assumes) — but the earlier claim here that this topology "cannot diverge by
construction" was WRONG, and has been corrected: each mode filter alone
(`r<1`) is stable, but a real linear feedback LOOP through two or more
coupled modes can still have combined loop gain above unity for some
parameter corner even when every individual pole is damped, and a real one
was found. `test/resonode-sweetspot/verify_musical_controls.py`'s older
checks only ever used a short (~15ms) burst excitation into silence, so
they could never see a divergence that only emerges after continuous
excitation — a real mic input, unlike a burst, never stops exciting the
loop. A direct DawDreamer sweep using SUSTAINED noise excitation over a
multi-second held gate (matching how Resonode is actually played — see
`check_sustained_excitation_stability` below) found a genuine NaN/Inf
runaway at `position=0.08, decay=0.15, damping=0.97, stretch=-0.4,
couple=1.0, note=36` (and other nearby corners), diverging to non-finite
output roughly 1.5s into a held note, not instantly — a real, slow
numerical blow-up, not a one-sample glitch. Fixed by wrapping every
mode-to-mode coupling READ (never a mode's own primary output into the
sum) in a bounded soft-clip, `coupleFeedback(x) = tanh(x*0.25)*4.0`
(`coupleFeedbackKnee`/`coupleFeedbackCeil` in `resonode_synth.dsp`) —
near-identity for normal in-range signal levels (slope 1 at the origin, so
`coupling_changes_output`'s measured couple=0-vs-1 diff/peaks are
unchanged bit-for-bit-close after the fix) but strictly bounded for large
values, which — combined with every mode filter already being BIBO-stable
for a bounded input (`r<1`) — makes the whole coupled network provably
unable to diverge to infinity regardless of parameter corner, closing the
actual gap in the old "cannot diverge by construction" reasoning (that
reasoning was true for the isolated per-mode filters, never extended to
prove the closed-loop coupled system). Re-verified: the same DawDreamer
sweep that found 2 diverging corners out of 288 now finds zero, and every
pre-existing `verify_musical_controls.py` check still passes unchanged
(`coupling_changes_output`'s couple=1.0-vs-0.0 diff/peak numbers are
identical to before the fix). `coupleScale = 8.0` is unchanged and its own
empirical rationale (smallest value giving a clearly audible ~20%
peak-sample/spectral-centroid effect at `couple=1.0` without dominating a
patch's identity) still stands — re-verify with
`test/resonode-sweetspot/verify_musical_controls.py`'s
`coupling_changes_output` AND `sustained_excitation_stability` checks
before retuning either constant.

**Scope note on "doesn't quite sound like Objekt" (disclosed, not fully
addressed)**: the numerical-instability fix above addresses "feeds back
easily"/"unpredictable" directly (a real divergence bug, now closed). It
does not itself close the broader tonal-character gap against Objekt/
Resonarium. One structural difference both reference instruments lean on —
stereo diffusion across the mode bank — is architecturally out of reach
here without a much larger change: `resonode_synth.dsp` is mono in/out,
and the ENTIRE aloop signal path is mono end-to-end (the OTG gadget mirror
already averages capture L/R to mono, `dsp/loop.dsp`'s rings are mono,
`audio_thread.cpp` carries one channel throughout) — giving Resonode real
stereo would mean carrying a second channel through the whole pipeline,
not a local change to this file. Left open for a dedicated audio-thread
architecture change, not attempted here.

**Per-voice structural modulation** (new, cheap, reuses the existing
attack-edge envelope idiom `pitchEnv` already used for pitch-mod): `position`
gets a small live per-voice drift, `positionDriftEnv`, that starts every
voice brighter right at the strike (mode balance shifted toward higher
modes) and decays back to the patch's own set `position` over ~350ms — a
struck object's real spectral-evolution character (bright attack, darker
sustain), and the direct fix for "a single patch sounds static/dull over
its own decay" (Objekt's own "Bassonic" factory-patch technique: reuse an
envelope the engine is already computing to modulate STRUCTURAL balance,
not just amplitude). `stretch` gets a small per-note sample-and-hold random
offset (`no.noise` through `ba.sAndH`, latched fresh at every `attackEdge`)
so repeated strikes of the same key are not bit-identical — Resonarium's
"chaos"-correlated random modulator and Objekt's per-note-latched
"Random1/2" source, both cited as a cheap way to avoid "patches sound too
similar" without adding named patches. Both are fixed internal constants
(`positionDriftAmt = 0.16`, `stretchJitterAmt = 0.02`), not user-facing
knobs — there was no free knob-bank slot for either without displacing an
existing control.

`bwFloorT60 = 0.15` (as `burstGainRefT60`) still clamps every mode's
excitation-gain reference point (measured/tuned jointly with the OLD
exciter's bandpass Q; the removal of that bandpass did not require
re-deriving this constant — verified via the `modes_2_to_6_are_not_starved`
regression check). `process()` order is `(...) : *(outLevel) : ma.tanh`
(outLevel drives INTO the limiter, not scaled past it). `outLevel` default
`25.0` (range `0.0..60.0`, logarithmic-taper knob) — large because a real
narrowband resonator only captures a small fraction of a broadband/mistuned
excitation's energy by design. `bassBoost` gives the fundamental mode (mode
1 only) up to 1.35x gain below 220Hz, tapering to unity at/above 220Hz
(exact identity above the corner). `aliasGuard` fades any mode whose real
frequency crosses the top 5% of Nyquist to silence rather than letting it
fold back as a spurious alias peak. `collision` (0..1, per-patch) is a
bounded `ma.tanh`-based waveshaper on each voice's own `bank()` output
before summing — exact identity at 0, adds real broadband grit/decay-tail
energy at higher values. Pitch-mod (`flexibility = max(0,min(1,(0.5-stretch)))`)
adds a small (~44 cents max), velocity- and stretch-scaled onset frequency
bump via a one-shot exponential decay envelope, retriggered on the same
`attackEdge`/voice-steal edge the exciter retrigger already uses — models a
struck object's transient pitch bend, more prominent on low-`stretch`
("flexible") patches. All morph knobs (`position`/`decay`/`damping`/
`stretch`/`tone`/`level`/`collision`/`couple`) glide via a `letrec`-based
one-pole that SNAPS to the true value on `ba.time==0` and glides only on
later changes (never a naive `si.smooth`, which zero-inits and fades in
from silence on every fresh DSP instance).

**Voice-steal retrigger**: `stealEvent`/`retriggerGate` synthesizes a
one-sample gate dip so a steal (note change while gate stays high) still
fires a genuine fresh attack envelope; `freqGlide` snaps instantly on a true
onset and glides ~10ms on a steal, spreading the resonator-coefficient
jump instead of a one-sample discontinuity.

**Named sweetspot patches** (`kResonodePatches`, knob slots 1-4 in the
Resonode knob bank, convex-blend weighted like the granulator's own
`kGranPatches`):

| Patch | position | decay | damping | stretch | collision | Character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp transient |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s ring, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s ring, harmonic partials audible |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass-dominant (93-97% of energy below 1.5x f0) |

These were found via a real DawDreamer grid search (625 combos of
position/decay/damping/stretch x 5 levels each) against measured features
(decay time, transient ratio, spectral centroid, low-frequency-energy
ratio) scored against a hand-authored target direction per voice —
`collision` values are hand-set judgment calls, not swept. The table's raw
values are unchanged since the exciter/coupling fix above — they did not
need retuning, because the OLD engine's near-total mode 2-6 starvation was
masking the differentiation these values already encoded (measured early-
transient spectral centroid across the 4 patches went from a flat ~220Hz/
1.0x-fundamental for every patch, pre-fix, to a real 340-1300Hz/1.7-5.9x
spread post-fix, with zero changes to `kResonodePatches` itself). Knobs 5-7
are direct performative dials (`applyResonodeDirectKnob`): tone brightness
(logarithmic taper — a linear Hz sweep compressed nearly all audible change
into the first 10-20% of the knob's travel), level, and `couple` (linear
0..1, knob 7 — previously unused/`Unused`, see the coupling paragraph
above).

**`ApcGrid::bindAll` must `ps.bind()` every internal flag a C++ path later
`setByName`s** — `ParamStore::setByName` is a silent no-op on an unbound
name (`bind()` is the only path that inserts into the slot map). Two real
incidents: `fx/resonode/engaged` and `fx/resonode/collision` were both
missing their `bind()` call at different points, producing a permanently
silent feature with zero error anywhere. Same bug class separately hit
`cmd/halfspeed`/`cmd/doublespeed` (routed only through
`config/controls.conf`'s generic `map.find(key)` fallback, easy to miss
when auditing hardcoded `setByName` call sites alone — grep the config file
too). Any new internal (non-MIDI-mapped) C++ flag reaching Faust via
`setByName` needs an explicit `bind()` audit before being trusted.

## delayverb: a separate, conditionally-called LV2 bundle

`effects/delayverb-src/delayverb.dsp` (delay + reverb stages) is extracted out
of the always-on Faust graph into its own `delayverb.lv2`
(`build-lv2.yml`'s `delayverb-lv2` job), compiled in TWO halves
(`aloop_pre.dsp`/`aloop_post.dsp`) around it: both stages were fully
unconditional in-graph (Faust has no runtime branching) and ran TWICE (cue +
master paths) every block regardless of the DELAYAMT/REVAMT knobs' actual
values. `audio_thread.cpp` now calls `.process()` only on whichever instance
(cue/master) has a meaningfully nonzero amount — same extraction pattern as
Resonode. The LV2 build container needs `libboost-dev` because Faust's
`lv2.cpp` architecture uses boost/circular_buffer.

## Tracktion Engine was evaluated and REJECTED — do not re-open without new evidence

Disqualified by the threading/device model, not dependency weight: (1) two
independent ALSA devices with deliberately different buffering (blocking
instrument device + NONBLOCK best-effort OTG mirror) — JUCE's
`AudioDeviceManager` gives one device/rate/buffer/callback, the mirror is
not expressible; (2) manual per-core `pthread_setaffinity_np` pinning would
fight `tracktion_graph`'s own thread pool; (3) the 1.333ms block budget and
never-add-latency constraint make DAW-graph plugin-delay-compensation a
real regression risk unprovable without real hardware. Also: pulls in
`juce_gui_extra`/X11/freetype on a headless device, and a GPL/Commercial
license change from the current no-obligation state.

**Higher-leverage alternative already available**: exactly one LV2 bundle
ships (`guitar_lofi_fx.lv2`) from a Faust source this build already
compiles natively for the home stack — folding it into the Core-3 Faust
program the same way would let `lv2_host.{cpp,h}`/lilv/the crash-isolation
watchdog/`build-lv2.yml`'s cross-compile job all be retired, removing
moving parts with no new dependency/latency risk. Confirm `/effects/user`
(the swappable user-LV2 extension point) is genuinely unused before acting
on this, since retiring the host removes that surface too.

---

# Control surface (`src/control/apc_grid.cpp`)

## Every momentary Faust gate must be explicitly released

A one-shot gate driven from the control thread sticks at 1 forever unless
something writes it back to 0:

- **`looperN/erase`** — `dsp/loop.dsp`'s `wipe = max(clearAll, eraseN)`
  gates ring recirculation every block; a stuck `erase` silently wipes
  playback forever while recording still works. `pollHolds` records a
  ~50ms release deadline and clears it on a later tick.
- **`looperN/finishreq`** — same shape, ~50ms then release.
- **`cmd/clearall`** — a genuinely HELD value (note-on sets, note-off
  releases), no deadline needed.

## `rec` must be explicitly zeroed on FINISH

`rec` is a persistent `ParamStore` value; setting `rec=1`/`play=1` in the
same press with nothing resetting `rec` re-records live input over the
loop forever. `applyRecPlayCycle` sets `rec=0` on FINISH. Per-looper press
cycle: empty → ARM (`rec=1`) → FINISH (`rec=0`, `play=1`) → pause
(`play=0`) → resume (`play=1`) → ... **ARM and FINISH fire on PRESS**, not
release — precision instants; pause/resume stay on release.

## CLEAR_ALL must zero both `play` and `rec` in Faust, not just C++ shadow state

`onClearAll` explicitly writes both; `onStopImmediate` also zeros `rec` for
any mid-recording looper (a mid-recording stop is an abort, the looper
stays "empty").

## An emptied rig must reset the shared master phrase length, from ANY path

`m_masterLenSamples`/`cmd/master_len` (and `cmd/recorded_bpm`) reset to 0
whenever the LAST looper with content is erased, checked in `pollHolds`
after the per-looper erase loop.

## Master phrase length comes from `writeIdx` telemetry, never wall-clock

Loop 1 plays back at EXACTLY its raw recorded duration. `deriveTempoQuant`
is used ONLY to propose a BPM to Link — never to resize
`m_masterLenSamples`. Read `AudioThread::snapshotTelemetry().looperWriteIdx`
— the DSP's true elapsed sample count. Wall-clock is a defensive fallback
only.

## Successive-recording quantization: powers of 2 only, log-space midpoint

A subsequent recording's raw duration snaps to a power-of-2 subdivision/
multiple of the master phrase length M (M/16..8M). Decision between the two
bracketing candidates uses the LOG-SPACE geometric midpoint
`sqrt(lowerCand*upperCand)` — symmetric and scale-independent. Every
looper's `wrapLen` is therefore always a clean power-of-2 ratio of every
other, guaranteeing drift-free repeat alignment forever.

## Content phase-anchor: fixed-cycle lock (505-style), current architecture

Every loop, once a master phrase exists, plays back starting exactly at the
SAME shared downbeat (`masterPhase == 0`) — never an independently-computed
per-take offset. Recording start is DOWNBEAT-ONLY quantized (real RC-505
behavior, not a finer sub-beat grid): `armEdge` for any non-first looper
fires only when `pendPrev` (armed since the raw `armPulse` press) coincides
with `gridTickCrossed`, which is exactly `masterPhaseWrapped` — the next
`masterPhase == 0` downbeat, however far away that is. Because `armEdge`
therefore always coincides with `masterPhase == 0`, `recordStartMasterPhase`
(`rsmNext`) is a hardcoded `0.0` for every non-first looper — there is no
sub-beat offset left to store or correct for. (Loop 1 itself, before any
master phrase exists, is the one exception: `armEdge == armPulse`
immediately, no downbeat to wait for, and `rsmNext` captures the real
free-running `masterPhase` at that instant.) `cycleOffset` (accumulates
`+masterLen` on each `masterPhase` wrap, reset at `armEdge` only) restores
which repetition of a multi-`masterLen` take is being read.
`wrapLen = gridMultiple * anchorGridLenNow`, where `anchorGridLenNow` picks
the coarsest anchor-grid unit (1/2/4/8/16 beats) not exceeding the take's
raw recorded length, and `gridMultiple` is a CEILING (never round-to-nearest)
of how many of that unit the raw length needs — the grid-snap can only ever
round the loop length UP to contain everything actually recorded, never
truncate content out of the ring.

**Known, disclosed, unfixed edge case**: `winSamples`/`xfSamples` (the
window-freeze mechanism, separate from the phase-anchor above) can
permanently freeze at the floor value on a TRUE zero-context cold start —
gate rising at the very first sample of a DSP instance with zero prior
audio, no lead-in at all. Confirmed NOT to matter in realistic performance
(any real lead-in, even ~100ms, before the gate rises avoids it, and real
hardware's mic runs continuously) — realistically limited to the very
first note played after boot/silence. A fix attempt (gate the freeze on the
same `distrust` signal `shiftAmount`'s own holdGate uses) reproduced the
real-CLI compile-time wall (see `[[memory: faust-compile-time-cliff]]`) and
was reverted. Needs real local `faust` CLI/Docker access to bisect properly.

## Real APC Key25 hardware re-sends note-on for an already-held pad

Unlike synthetic MIDI-inject. Without a guard, each repeat resets the
hold-start timer and can re-enter ARM/FINISH mid-recording. `onPadPress`
tracks `m_looperHeld` per pad and treats a repeat note-on as a no-op. The
same retrigger bug independently hit `onLofiFxPress` (re-stamping
`m_granulatorPressAt`/`m_bankBeforeGranulatorHold` on every retrigger,
making a hold-duration threshold structurally unreachable) — same fix
pattern (guard on the true 0→1 edge only). This is why the LofiFx/Resonode
gesture below is now edge-triggered (SHIFT modifier) rather than
hold-duration timed.

## Guitar-fx held REDIRECTS looper pad presses entirely

While `m_guitarFxHeld` is true, a looper pad press is consumed by
`onSidechainLooperToggle` (toggles that looper's sidechain-source
designation) and never reaches ARM/FINISH — a one-shot toggle, not a hold
gesture. Auto-clears when that looper's content is wiped.

## LofiFx/granulator button: Shift disambiguates granulator-tap vs Resonode-tap

The LofiFx button (`kApcBtnLofiFx`, note 69) uses SHIFT to disambiguate its
two gestures, not a hold-duration timer (a prior 1000ms-hold design was
WITNESSED unreliable on real hardware — real button releases interrupted
the hold before the threshold, so Resonode never actually engaged). Both
gestures fire instantly on the PRESS edge:

- **Plain tap**: toggles `m_granulatorLatched` + `setGranulatorEnabled` —
  latches the grain engine on/off as a persistent, backgrounded texture.
- **Shift+tap**: `toggleResonodeEngage` — flips `m_resonodeLatched`/
  `m_resonodeEngaged`, writes `fx/resonode/engaged`, forces the granulator
  latch off (Resonode always wins). Disengaging releases every held
  Resonode voice.

Every press switches the active knob bank to LofiFx; the bank only reverts
on release if Resonode is NOT engaged (`m_bankBeforeGranulatorHold` is
captured only on the FIRST press while disengaged, never overwritten while
Resonode stays engaged — otherwise the disengage press would capture
`LofiFx` itself as "bank to restore" and strand it there). `onClearAll`'s
own Resonode-disengage path needs the identical bank-restore call.

While Resonode is engaged, the keybed drives 4 Resonode voices
(`allocateResonodeVoice`/`releaseResonodeVoice`, same oldest-steal shape as
transpose voices) via `Lv2Host::setControl` pushes to
`fx/resonodevoice{v}/{note,gate,vel}`. Knob slots 1-4 are the named-patch
blend weights (table above); slots 5-7 are the direct tone/level/couple
dials (`kResonodeDirectKnobRanges`/`applyResonodeDirectKnob`).
LED feedback: blinking red while Resonode engaged, solid green while
granulator latched, off otherwise.

Resonode's 4 voices are only computed when engaged (genuinely skipped at
the C++ call site) — unlike `multitranspose.dsp`'s 6 always-on voices.

## Granulator: 4 named patches + 3 direct dials (current architecture)

The granulator engine itself lives entirely in C++
(`src/dsp/sampler/sampler.h`'s `Sampler::_renderGranularVoice`/
`_spawnGrain`), not Faust — a real overlap-add grain engine with 7
underlying parameters (`grainMs`/`grainRateHz`/`pitchSprayCents`/
`posJitterMs`/`scanRate`/`reverseProb`/`envShape`), `MAX_GRAINS=48`
concurrent grain slots shared across all 16 voices, and a cubic-
interpolated grain reader. `scanRate=0` is a genuine freeze (the scan
position stops advancing while grains keep spawning from the same spot);
negative `rate`/`reverseProb` plays a grain backwards; `envShape` morphs
the per-grain window from Blackman (0.0) through Hann (0.5) to a
percussive attack-then-decay shape (1.0), LUT-cached and double-buffered
(`m_grainWinLutBuf[2]`) so a control-thread rebuild never races an RT
grain spawn.

**Fixed: the granulator previously had NO direct dial at all** — its whole
LofiFx knob bank (knobs 1-6) was 6 named-patch blend WEIGHTS
(`kGranPatches`/`applyGranulatorMorph`, a convex combination of all 7
underlying parameters at once) with knob7 sitting `Unused`, unlike every
other engine in this codebase (Resonode's tone/level/couple, Guitar/Dub's
direct per-effect sliders) which all pair named patches with at least one
direct performative dial. This meant every granulator parameter was only
reachable by figuring out which BLEND of fixed presets happened to land
near what you wanted — never a direct "turn this knob, hear that one
thing change" control, which is the concrete mechanism behind "not easy to
understand" and, since averaging 7 parameters across patches tends to wash
out any single patch's character, a real contributor to "boring". Now:
`kGranPatchCount = 4` (reduced from 6, dropping the two patches most
redundant with what the 3 new direct dials below already cover), freeing
knobs 5-7 for direct dials (`kGranDirectKnobRanges`/
`applyGranulatorDirectKnob`, the exact same per-instance touched-knob
pattern as `applyResonodeDirectKnob`) that override the corresponding
patch-blended field only once that knob has actually been touched
(`m_lofiFxKnobTouched[5..7]`, checked in `applyGranulatorMorph`) — before
that, the patch blend's own value applies unchanged, so this is purely
additive over the prior patch-only behavior:
- **Scan/Freeze** (knob5, linear 0.0-3.0): 0 = frozen (grains keep firing
  from one static position — the classic granular-freeze/"stuck" texture,
  reachable now with ANY patch, not just the one preset that happened to
  set `scanRate=0`), 1.0 = normal forward scan matching the source
  material's own pitch, up to 3x fast-forward scan.
- **Density** (knob6, log taper 2-200Hz): directly dials `grainRateHz`,
  the single highest-leverage "how granular does this sound" control in
  any granular engine, previously only reachable via patch-blend guessing.
- **Pitch Scatter** (knob7, linear 0-1200 cents): directly dials
  `pitchSprayCents`, a full octave of per-grain random pitch scatter at
  the extreme.

**Fixed: mechanically regular grain-spawn timing** (a second, independent
"boring" contributor) — `_renderGranularVoice` fired grains at an exactly
regular period derived from `grainRateHz`/velocity, with zero timing
variation between successive grains (only grain POSITION/pitch had
randomization, via `posJitterMs`/`pitchSprayCents`). A perfectly regular
grain clock reads as mechanical/synthetic regardless of how much position/
pitch jitter is layered on top. `Voice::grainNextPeriod` now applies a
fixed internal `kGrainTimingJitterAmt = 0.15` (+/-15%) random deviation to
each grain's own inter-onset interval, drawn fresh every time a grain
actually fires (not a user-facing knob — matches Resonode's own
`positionDriftAmt`/`stretchJitterAmt` internal-constant convention for
this exact class of fix). Verified via a standalone C++ harness linking
`sampler.h` directly (`Sampler::renderInto` on a synthetic tone,
freeze-mode and normal-scan-mode both produce finite, real, non-crashing
grain output; freeze-mode confirms grains keep sounding while the scan
position itself is provably static).

## `mode2`/`mode3`/`mode4`'s damping exponent is small-integer — strength-reduced from `pow()`

`pow(damping,1)` → `damping`, `pow(damping,2)` → `damping*damping`,
`pow(damping,3)` → `damping*damping*damping` — the exponents are literal
integers baked into the source (independent of any runtime hslider),
verified bit-exact (0.0 max abs diff) since squaring/cubing introduces no
more rounding than the `pow()` call it replaces.

## LofiFx bank must latch permanently on press, matching Dub/Guitar

`onLofiFxPress`/`onLofiFxRelease` latch `m_activeBank`/`m_lofiShiftMode`
permanently on press (matching Dub/Guitar's existing behavior), with NO
revert-on-release logic — `m_bankBeforeGranulatorHold` was removed once
bank selection stopped being tied to physical hold duration.
`m_lofiShiftMode` selects which of LofiFx's two knob pages is live: plain
press = granulator page (bitcrush + 4 named granulator patches + 3 direct
performative dials — Scan/Freeze, Density, Pitch Scatter, see the
granulator section below), SHIFT press = Resonode page (bitcrush + 4 named
Resonode patches + tone/level/couple).

## Three-page x regular/shift x 8-knob control surface (current architecture)

Every FX page (Dub, Guitar, LofiFx) has TWO independently-latching 8-knob
banks (regular and Shift), selected per-CC via `ApcGrid::onFxKnobCC`
branching on `m_activeBank`/`m_shift`. `kFxKnobCcNumbers = {48, 49, 50, 51,
54, 55, 57, 53}` (CC53 also double-duties as Formant on the Dub page only —
intercepted before the table lookup).

- **Dub regular**: `fx/reverb`, `fx/delay`, `fx/time`, `fx/hp`, `fx/lpres`,
  `fx/lp`, `fx/pitch`; CC53 = Formant (intercepted, never in the table).
- **Dub shift**: a dance-gate + LFO bank (`dubGateLfoStage`, appended to
  `mainOut` post-reverb) — `fx/dubgate/{amt,pattern}`, `fx/dublfo/{rate,
  depth,shape,target,phase}`. All bit-exact identity at compiled-in
  defaults. Tempo-synced via `fx/dubgate/clockphase`, pushed from the same
  shared 4-beat clock as the guitar gate and groove-shuffle (not
  `masterPhase` — keeps ticking with no loop recorded).
- **Guitar regular**: `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,
  DISTAMT}` (a single shared `BANKSPEED` LFO rate drives flanger/tremolo/
  phaser together), `fx2/{VINYLAMT,FLUTTERAMT}`; CC53 = `fx2/GATEAMT` (a
  fixed 4-on-the-floor rhythmic gate, `gateStage`, driven by the same
  shared clock).
- **Guitar shift**: an 8-dial dual-ADSR bank for the Sampler engine
  (`SamplerFilter{Attack,Decay,Sustain,Release}Ms` — filter-cutoff
  envelope, C++-side state machine, `_recomputeFilterEngaged` checks ALL
  FOUR stages before deciding to engage; `Sampler{Attack,AmpDecay,
  AmpSustain,Release}Ms` — amplitude envelope). No Faust/LV2 targets — all
  write straight into the C++ `Sampler` object.
- **LofiFx**: knob0 `fx2/BITCRUSHAMT`; knobs1-4 are 4 named-patch weights
  (granulator or Resonode per `m_lofiShiftMode`); knobs5-7 are 3 direct
  performative dials, own meaning per page (granulator: Scan/Freeze,
  Density, Pitch Scatter; Resonode: tone, level, couple — see the
  granulator section below for the granulator page's own layout).

`compressor.dsp` is kept in-tree unreferenced by the live chain, only
because `test/faust-flags/ab_fm_def.py` still uses it for an unrelated
fast-math-flag check — do not delete without updating that test.
`samplerate.dsp`, `mixbus.dsp`, and `gateStage`'s multi-pattern
select/`SRRAMT` stutter effect were removed as confirmed-dead (no reachable
control/consumer).

## Groove shuffle: the 4 metronome-flash pads are also shuffle buttons

`kBeatPadNotes` (notes 15/23/31/39, col 7 rows 1-4) are LED-flash pads that
are now ALSO pressable, routed via `ApcGrid::onShuffleButtonPress`/
`onShuffleButtonRelease` to a 4-bit held-state bitmask published as
`fx/shuffle/mask`. **True retrigger/reorder, not swing/groove-offset** — a
continuous-perturbation design (sine-sum, then hard-jump offset tables) was
tried and rejected (produced an audible "double-tap" from re-reading
already-played content). Current mechanism: one beat = one slice, 4-beat
cycle, `kShiftReorderTables[shuffleMaskNow]` (indexed directly by the raw
4-bit bitmask — 15 hand-verified-distinct sequences, not composed at
runtime) gives each combination its own 4-entry sequence of which beat's
content plays during which cycle position. The applied offset is always a
WHOLE beat, constant for the entire beat, recomputed only at beat
boundaries — structurally eliminates the double-tap failure mode. Runs on
its OWN free-running `shuffleClockSamples` accumulator (wrapped at a
nominal 4-beat length derived from `masterLen`/`recordedBeats` when a loop
exists, else a nominal half-second beat), added on top of the real
`masterPhaseSamples + i` ramp, never replacing it.

## `dsp/loop.dsp` varispeed must have NO deadzone

`varispeedActive = effSpeed != 1.0` — exact-equality check. A deadzone
would discard small-but-real tempo mismatches, causing steady (non-
sweeping) phasing between loopers of different lengths at a close-but-not-
identical Link tempo.

## Manual half/double-speed vs. soft-resync drift correction

The soft-resync term (`readPosStep`'s `wrapDelta(prev) * resyncCoeff`,
built for gently correcting small Link-drift mismatches) actively fought a
deliberate large manual speed-multiplier press, dragging `readPos` back
toward normal-speed position within a fraction of a second. Fixed by gating
`resyncCoeff` to `0.0` whenever `|effSpeed - 1.0| > 0.3` — manual
half/double-speed (0.5/2.0) is always far outside this band; genuine
Link-tempo-following mismatches realistically never approach it.

**Both beat-shuffle's hard clip and varispeed's instant speed jump are
INTENTIONAL** — a smoothing attempt (tanh saturation on shuffle offset, a
~50ms glide on `effSpeed`) was shipped then explicitly reverted on user
correction: the abrupt "punch in" character is the desired musical effect
for both gestures, not a bug. Do not re-smooth either without confirming
with the user first whether a report is about the transition being audible
at all (intentional) vs. some other defect (wrong timing/magnitude/a real
click distinct from the punch character).

## Glitch/microrepeat slice length

`microrepeat.dsp`'s `sliceBlocks = max(1, int(beatBlocks / divSafe)) * 2`
with `divSafe = max(1, DIV)` — multiplying the already-computed slice
length (never halving the divisor first, which would floor-collide `div=1`
and `div=2` at `int(1/2)=0`).

## Dead files

`mixbus.dsp` and `samplerate.dsp` were removed (zero consumers, confirmed
via full-repo grep). `chain.dsp` is NOT dead — `build-lv2.yml`'s
`home-fx-lv2` job builds it as a packaging-reproducibility check despite no
live-chain reference. `rawGlitchTap` was removed from
`effects_runtime.dsp`/`aloop.dsp`/`audio_thread.cpp` (`fouts[4]` →
`fouts[3]`) as confirmed-dead.

## CC53 formant constants

Deadzone 60-68, formula `((data2-64)/63.0)*1.0` — a flat ±1 range always
(a shift-dependent widening was tried and removed per direct user
direction: a bare SHIFT press must never change a knob's behavior — SHIFT
is reserved exclusively for the native fold/resample gesture).

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a
completely different USB role (peripheral/gadget mode vs. host mode on the
USB-A ports a flash drive plugs into).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring (5
seconds). `audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(),
N)` every block, next to `g_sampler->captureBlock(...)` — the same post-fx
tap point. The producer is a single-atomic-counter SPSC ring
(`std::atomic<uint64_t>` write/read counters, not raw indices) that NEVER
blocks or allocates: if the consumer has fallen behind, `pushBlock`
advances the read counter itself (dropping oldest samples) and increments
an overrun counter. Drop, never block.

**Control side**: all file I/O (mount detection, WAV chunk writing/
rotation) happens in `UsbRecorder::poll()`, called from `main.cpp`'s
existing 5 Hz control loop — deliberately NOT a dedicated pthread. Chunks
are fixed-size and cyclically `O_TRUNC`-reopened, so the ring bounds disk
usage by construction with no eviction pass.

**Mount detection is a `stat()` device-id comparison** (`isMounted()`: the
mount point's `st_dev` differs from its parent's exactly when something is
mounted there), not `/proc/mounts` parsing.

**Config**: `[storage]` in `config/aloop.conf` — `usb_record`,
`usb_mount_point` (default `/media/aloop-usb`), `usb_chunk_minutes` (10),
`usb_chunk_count` (6). `effectiveChunkCount()` shrinks the ring to fit
smaller drives via `statvfs`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`src/usb/usb-automount-setup.sh` (local.d bootstrap) — the setup script
APPENDS two rules to `/etc/mdev.conf` (never overwrites) and does its own
explicit coldplug pass over `/dev/sd[a-z][0-9]*` after installing the rule
(since `local.d` runs AFTER `mdev -s`'s sysinit coldplug scan, an
already-inserted drive would otherwise be missed).

Mount attempts: no `-t` first (kernel auto-detection), then explicit
`-t vfat`/`ext4`/`exfat`/`ntfs`. **exFAT/NTFS userspace tools are almost
certainly NOT in the minimal Alpine RPi tarball's repo** — only
kernel-native FAT32/ext4 is expected to work without further vendoring.
UNVERIFIED on real hardware, along with the mdev.conf rule syntax and real
USB-drive enumeration on the Pi 4's USB-A ports.

`./opt/aloop/usb-automount.sh` and `./etc/local.d/25-usb-automount.start`
are registered in BOTH `_exec_paths` and `_nb_exec_paths`.

---

# Faust Libraries reference

Faust Libraries is the standard DSP library collection for the Faust language.
Prefer the Markdown sources over the built HTML for LLM-friendly content.

### Core entrypoints
- [Libraries index](https://faustlibraries.grame.fr/libs/): Index of all library
  reference pages.
- [Standard functions](https://faustlibraries.grame.fr/standardFunctions/): Core
  standard functions used across the libraries.
- [Overview](https://faustlibraries.grame.fr/organization/): High-level
  organization and structure of the library.
- [Motion functions](https://faustlibraries.grame.fr/motion_functions/):
  Motion-related functions and reference.

### Library map
- Each library has a dedicated reference page under `doc/docs/libs/` (Markdown
  source) and `/libs/` (HTML site).

### Markdown sources (authoritative)
- [Libraries index (md)](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/libs/index.md)
- [Libraries example (md)](https://raw.githubusercontent.com/grame-cncm/faustlibraries/refs/heads/master/doc/docs/libs/basics.md)
- [Libraries folder (API)](https://api.github.com/repos/grame-cncm/faustlibraries/contents/doc/docs/libs)
- [Standard functions (md)](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/standardFunctions.md)
- [Overview (md)](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/organization.md)

### Scope
- This section documents the Faust **libraries** only. Compiler-flag guidance lives
  in the "Faust compiler flags" sections above; the reference for those is
  [faustdoc.grame.fr/manual/optimizing/](https://faustdoc.grame.fr/manual/optimizing/).

### Optional
- [Contributing](https://faustlibraries.grame.fr/contributing/)
- [Community](https://faustlibraries.grame.fr/community/)
- [About](https://faustlibraries.grame.fr/about/)

@.gm/next-step.md
