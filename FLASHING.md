# Flashing aloop to an SD card and testing from it

> **Testing before you commit to a card?** Pi boards can boot the served netboot
> root over the network (DHCP + TFTP + HTTP :8080) with zero reflashing — see
> **[docs/NETBOOT.md](NETBOOT.md)**. That's the fastest way to shake out boot
> issues on a Pi; come back here to burn a card. The served apkovl is PINNED to
> a build (`tools/netboot/refresh-apkovl.sh`, `NETBOOT_PIN`) and can be STALE —
> check its mtime/md5 against the latest CI build before trusting a boot.
> Orange Pi Prime has no netboot
> path (see `docs/BOOT.md`'s board matrix) — it's SD-card-flash-only.

This is the card-test procedure, worked through for the Pi 4 (the best-supported,
gadget-capable board) — the same steps apply to pi3/pi5/opi-prime with the board's
own image filename substituted; see `docs/BOOT.md`'s board matrix for what differs
per board (USB-audio gadget availability, WiFi chip). The CI `build-image` workflow matrix is `[pi3, pi4, pi5]` and uploads one
`aloop-<board>-image` artifact per board; the Orange Pi Prime image comes from
the separate `build-opi-armbian-source` workflow (artifact
`armbian-opi-prime-pre618-image`). Flash the one matching your hardware and it
comes up as the aloop appliance.

## 1. Get the image

- **From CI:** open the latest green `build-image` run on `AnEntrypoint/mc-420`
  and download the **`aloop-<board>-image`** artifact for your board (e.g.
  `aloop-pi4-image` → `aloop-pi4.img.gz`) — or grab it straight from the
  auto-updated `latest` GitHub Release, which carries the pi3/pi4/pi5 images
  (its body also names opi-prime, supplied by the separate workflow above).
- **Locally** (on a Linux/Alpine host with `mtools dosfstools fdisk curl`; Orange Pi
  Prime additionally needs `e2fsprogs xz-utils util-linux` and real root for
  `losetup`/`mount`):
  ```sh
  ALOOP_BIN=build/aloop LV2_DIR=effects/home BOARD=pi4 image/build-image.sh   # -> aloop-pi4.img
  BOARD=pi4 image/validate-image.sh aloop-pi4.img                            # structural check
  ```
  (`BOARD` defaults to `pi4` if omitted — set it explicitly for any other board.)

Verify the download:
```sh
gunzip aloop-pi4.img.gz
BOARD=pi4 image/validate-image.sh aloop-pi4.img     # must print "IMAGE VALID"
```

## 2. Flash it

Pick one:

- **Raspberry Pi Imager** → "Use custom image" → `aloop-pi4.img` → your SD card.
- **balenaEtcher** → select the image → the card → Flash.
- **`dd`** (double-check the device — this erases it):
  ```sh
  # find the card first (lsblk / diskutil list); then, replacing sdX:
  sudo dd if=aloop-pi4.img of=/dev/sdX bs=4M conv=fsync
  sync
  ```
  `status=progress` is GNU `dd`-only; macOS `dd` rejects it. The CI
  instructions use the portable `bs=4M conv=fsync` form.

## 3. Wire it up

- **SD card** → the board's SD slot.
- **USB audio to the host (pi4/CM4/Zero2 only — see `docs/BOOT.md`'s board
  matrix):** connect the Pi 4's **USB-C power/OTG port** to the computer you want
  it to be a soundcard for. The port is in peripheral mode
  (`dtoverlay=dwc2,dr_mode=peripheral`), so the host sees a **UAC2 mono 48 kHz
  soundcard** named `aloop`. (Power the Pi from the 5 V GPIO pins or a powered hub
  if the OTG port is busy being the gadget.) pi3/pi5/opi-prime have no working
  USB-audio gadget path — they run the full DSP/Link stack but do not present as
  a USB soundcard to a host computer.
- **MIDI controller** (optional): a class-compliant USB MIDI controller on a
  USB-A port drives the loopers/effects per `config/controls.conf` (remappable).
- **Serial console (recommended for the first boot):** a 3.3 V USB-UART on the
  GPIO header lets you watch boot without a display —
  - GND → pin 6, **Pi TX GPIO14 → adapter RX** (pin 8), **Pi RX GPIO15 → adapter TX**
    (pin 10), **115200 8N1** (`enable_uart=1` is set).
  - `screen /dev/ttyUSB0 115200` (or PuTTY) to watch it come up.

## 4. First boot — what to expect

- Alpine boots diskless into RAM and restores the `aloop.apkovl.tar.gz` overlay.
- `/etc/local.d/*.start` run in order: **10** RT-tune (isolcpus already applied via
  cmdline; sets IRQ affinity + rt limits), **20** brings up the `f_uac2` USB-audio
  gadget, **25** installs USB automount, then the **aloop** + **autoap** OpenRC
  services start (supervised — they respawn on crash; logs in
  `/var/log/aloop.log`).
- The host should enumerate the `aloop` USB soundcard within a few seconds of the
  OTG cable being connected.
- **WiFi / Ableton Link:** `autoap` elects one host for the single `ticker` SSID
  by lowest MAC (STA only when a lower-key peer AP is visible; AP otherwise,
  `ap_isolate=0`), and installs the `224.0.0.0/4 dev wlan0` route Link multicast
  needs. Put a Link-enabled app on the same network and it should sync tempo;
  transport is never shared.

## 5. Verify it's alive

Over the serial console or (if networked) from another machine:
```sh
# status file on the device:
cat /run/aloop/status.json
# or query the telemetry UDP responder (port 4445) from a peer:
echo status | nc -u -w1 <pi-ip> 4445
```
You get JSON: `core_busy` (per-core %), `xruns`, `link` (synced/bpm), `wifi`, and
`loopers` (rec/play bitmaps + vols) — the live device state.

## 6. Run the hardware measurements

The build is green; the numbers that need real silicon are the last step. On the
booted Pi:
```sh
/opt/aloop/test/hardware/run-all.sh     # or the individual test-*.sh
```
See **docs/HARDWARE-TESTS.md** for what each measures (RT jitter, f_uac2 round-trip
latency, Link no-glitch, AP multicast) and the pass criteria. If RT jitter misses
the target with the stock kernel, the OPTIONAL PREEMPT_RT build is the next
step (ADR-011); `kernel/build-rt-kernel.sh` writes only the config fragment
(`KVER` defaults to 6.12) — it does not build a kernel, and no CI job does.

## Dropping in a user effect

The single audio worker runs a swappable user LV2. Drop an `.lv2` bundle into
`/effects/user` (mount the card's boot FAT partition on any computer, or `lbu
add` on the device) and reboot — the in-process host loads it at startup and
processes it serially after `homeFx`, zero added latency. There is no live rescan.
