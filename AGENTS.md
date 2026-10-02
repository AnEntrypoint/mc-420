# aloop — technical constraints reference

Real Pi 4 `192.168.137.100`, root/aloop; real Pi 3B+ debug device reaches the
host via netboot (`.netboot-serve-pi3/`). Lean, current-state-only.
Investigation history lives in auto-memory
(`~/.claude/projects/<project>/memory/`); `[[memory: ...]]` pointers carry
the "why". Re-compacted at ~30KB.

---

# Working rules

**No comments in code, ever** (C++, `.dsp`, JS, shell, YAML, config). A
name/function-boundary IS the explanation; rationale belongs in THIS file or
memory; a comment found anywhere becomes self-explanatory code the same turn
(one sighting spawns a sweep of that file). Never trust an in-repo comment as
ground truth — they have been confidently wrong. `[[memory: no-comments-rule]]`.

**Never add audio-path latency.** The ~7ms block latency must never grow, even
temporarily — stop and ask first. A wet effect's own engaged-only algorithmic
latency (`ef.transpose`, SNAC) is exempt.

**Real hardware over asking the user to reproduce input**: byte-level MIDI
injection (`tcp/9401`, `src/control/midi.cpp`) or SSH state inspection.

**Compiling clean proves nothing about runtime safety** — x86_64 A/B passed
while real aarch64 codegen SIGSEGV'd (`-mapp`); a JIT `compile()` succeeded
and crashed at `render()`. `[[memory: faust-verification-discipline]]`.

**Diagnostic logs carry wall-clock timestamps** — `CLOCK_MONOTONIC` as
`t=<sec>.<ms>`, or periodic-vs-bursty is indistinguishable.

**WebSearch hardware mechanics before irreversible real steps** (OTP burn,
firmware write).

---

# Boards, images, boot trees

`image/lib-boot-tree.sh` is BOARD-parameterized (`BOARD`:
`pi3`/`pi4`/`pi5`/`opi-prime`, default `pi4`). `boot_tree_apkovl` (binary,
LV2, services, vendored libs) is shared; only `boot_tree_fetch`
(firmware/kernel/DTB) and `boot_tree_config` (cmdline/USB-gadget) dispatch
per board. `board_supports_usb_gadget`/`board_wifi_irq_name`/
`board_firmware_names` are authoritative, not this table:

| Board | SoC | Boot chain | USB-audio gadget |
|---|---|---|---|
| pi4 (+CM4, Zero2) | BCM2711 A72 | Pi firmware, FAT | dwc2 UAC2 |
| pi3 | BCM2837 A53 | Pi firmware, FAT | none — no OTG |
| pi5 | BCM2712 A76 | Pi firmware, FAT | none — RP1 host-only |
| opi-prime | Allwinner H5 A53 | Armbian U-Boot (raw sectors) + ext4 | unproven |

All aarch64; WiFi is brcmfmac on every Pi, RTL8723BS on opi-prime. Pi 3B+/
CM3+ ship netboot enabled from factory — no OTP burn (only plain 3B/CM3/3A+
need the irreversible one). ROM order SD → USB → Network, so "prep for
netboot" = wipe the card so no `bootcode.bin` remains. pi3 firmware names:
`start.elf fixup.dat bcm2837-rpi-3-b-plus.dtb`.

opi-prime: USB-audio-gadget **UNPROVEN** (MUSB micro-USB OTG only; the 3
USB-A ports are host-only) — fallback is the 3.5mm codec as ALSA HOST. BootROM
reads a raw SPL/U-Boot image pre-partition-table, so the blob is everything
before partition 1's real start (`sfdisk`; offset NOT constant).
`boot_tree_fetch_opi` must use Armbian's stable redirect
`dl.armbian.com/orangepiprime/Trixie_current_minimal` (a resolved github asset
URL 404s within days).

## apkovl assembly constraints

- `boot_tree_apkovl` stamps `.default_boot_services` — Alpine's `rc_add
  modloop sysinit` gate needs it or `/lib/modules`/`/proc/asound`/
  `usb_gadget/` never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"` in the service
  file, not `local.d`; `depend()` needs `after local autoap` (Link binds its
  multicast socket at startup).
- Vendor alsa-lib + lilv as real `.so`s under `vendor/lib-aarch64/`; never
  `apk add` at boot. alsa-lib also needs `vendor/share-alsa/` or
  `snd_pcm_open` segfaults. `hostapd`/`dnsmasq` need `libnl-3.so.200` **and**
  `libnl-genl-3.so.200`; `dnsmasq.conf` needs `user=root`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line (`tr '\n' ' '` +
  `tr -s ' '`); `core.autocrlf=true` corrupts scripts — fix via `rm` +
  `git checkout --`.
- New vendored files need both `tar --mode='+x'` lists (NTFS has no exec
  bit); `find` building them must `cd` into the overlay dir first. Verify
  modes via `tar -tvzf` (LAST match per path). `[[memory:
  windows-host-constraints]]`.

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load** (a
`.so` built with host g++ dlopens fine, then fails at load). Split
`faust2lv2`'s stages: `faust -i -a lv2.cpp` emits `.cpp`; `$HOST_CXX`
compile+run emits `.ttl`; only the final `-shared .so` link targets the
device, cross-compiled in a real Alpine aarch64 container. Verify:
`objdump -p foo.so | grep NEEDED` → `libc.musl-aarch64.so.1`, never
`libc.so.6`. Nested `docker run ... sh -c` needs `-e VAR="$VAR"`, never
interpolation. `[[memory: windows-host-constraints]]`.

**`upload-artifact@v4` `path:`**: a literal path flattens the dir's CONTENTS
at the zip root, dropping the `.lv2/` wrapper — always use a wildcard.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes the
worker skip `homeFx.process()`/`userFx.process()` entirely — fully silent,
survives `rc-service aloop restart`. Grep it before debugging "effects don't
do anything" as a code bug.

---

# Deploy, netboot, SSH

**SSH: use a JS `ssh2` client, never Windows `ssh.exe`/`sshpass`** — a fresh
netboot generates a new host key every boot, which breaks `known_hosts`
tooling but not `ssh2`. The only committed Node ssh2 client is
`image/dsp-hotdeploy.js` (binary + LV2 payload over SFTP only — it does NOT
cover boot tree / kernel / OpenRC service changes); ad-hoc device SSH
otherwise goes through a throwaway ssh2 script. `[[memory:
windows-host-constraints]]`.

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process**
(`config/aloop.conf`'s `[remote] token=`, `udp/4446`, `remote_control.cpp`;
client `image/aloop-reboot.js`). If `aloop` crashed, nothing listens —
OpenRC's `respawn_max=0` means it will not come back alone. Verify before
trusting device state: `/proc/uptime` and `md5sum /opt/aloop/aloop` vs
deployed, BEFORE reading logs. `[[memory: deploy-two-paths-lv2]]`.

## Netboot self-update: two rebuild paths

**Automatic**: `image/serve-netboot-win.js` polls `build-binary.yml`/
`build-lv2.yml`'s green `main` every 30s; blind to `image/**` packaging
changes; needs an elevated shell (ports 67/69). **Manual**: `ALOOP_BIN=<path>
LV2_DIR=<path> RESONODE_LV2_DIR=<path> PITCHTRACKER_LV2_DIR=<path>
DELAYVERB_LV2_DIR=<path> OUT=.netboot-serve NETBOOT_SERVER=192.168.137.1 bash
image/build-netboot.sh` — all four `*_LV2_DIR` vars **mandatory**; verify via
`tar -tzf .netboot-serve/aloop.apkovl.tar.gz | grep -oE
'effects/[a-z]+/[a-z_]+[.]lv2' | sort -u` → delayverb, guitar_lofi_fx,
pitchtracker, resonode. A new bundle needs wiring into BOTH `build-image.yml`
AND `serve-netboot-win.js` — neither reads the other's list.

Netboot silently outranks the SD card — confirm which path booted. Publish is
a staged-directory atomic `mv` (staging dir must be a SIBLING of the live
serve dir). `SERVER_IP` is baked into the netboot root's `cmdline.txt` ONCE —
restarting the server does not rewrite it; rebuild with `NETBOOT_SERVER` and
power-cycle. Replies go to `192.168.137.255`, so a /16 mask hides them. A
Windows Firewall rule for "Node.js JavaScript Runtime" can sit DISABLED while
sockets report "listening". `[[memory: netboot-dhcp-diagnosis-history]]`.

Fast DSP iteration: `node image/dsp-hotdeploy.js --target home|guitar|both`
— stops the service BEFORE overwriting `/opt/aloop/aloop` (`fastPut` fails
musl ETXTBSY).

## CI runner, docker-step, artifact discipline

Native `ubuntu-24.04-arm` runners (no QEMU — the emulated LINK step alone
measured ~14min vs ~1min); Docker steps split with per-command `timeout`+
`set -x`. `build-image.yml` downloads BOTH `home-fx-lv2` AND
`guitar-lofi-fx-lv2` from the SAME green run; `home-fx-lv2`'s bundle is
`aloop.lv2`, which `lib-boot-tree.sh` filters back out. Rolling `latest`
hard-gates on a real bundled binary (`payload_check`), stricter than
`validate-image.sh` (WARNS only). Artifacts need `retention-days: 3` — the
90-day default hit the storage quota and blocked uploads. `faust2bench` was
removed from CI (3 of 4 attempts hung); run it manually, 20 runs, `-bs 64`.
`test-loop-sim.yml` gates the looper sim — `smoketest.js`,
`two-device-sync.js`, `fuzz.js --trials=3000 --events=50`, all three before
touching `tools/loop-quantization-sim/`. `[[memory:
ci-build-pipeline-history]]`.

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc
single-AP mesh for Link's multicast peer discovery (`224.76.78.75:20808`,
hardcoded in the Link library).

| Invariant | aloop | esp-idf-link |
|---|---|---|
| Mesh SSID | `hostapd.conf`/`wpa_supplicant.conf` `ssid=ticker` | `wifi_scan_best_bssid`/`wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `hostapd.conf` `channel=6` | SoftAP ch6 |
| quantum | `kLinkQuantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |

Host election is MAC-ordered (never "host if scan found nothing" — splits the
mesh). `src/net/autoap.sh`: hosts `ticker` never `aloop`; needs at least one
active `network={}` block before `start_ap()` does anything. `start_ap()`
clears previous hostapd not just wpa_supplicant (stale → `Could not set
channel`, a red herring — ch6 is paired). `[[memory:
mesh-link-midi-history]]`.

## Ableton Link checklist and varispeed/transport-anchor

`commitAppSessionState()` off-audio-thread, `commitAudioSessionState()`
audio-thread only — hands the audio thread a lock-free double-buffered
`LinkSnapshot` (ADR-005, ≤1 tick stale). `setTempo` rewrites EVERY peer;
`proposeTempo` refuses when peers present and is the ONLY user of
`weOwnTempo` — never gate `linkSpeedRatio` on it. Playback matches tempo by
scaling read RATE (`linkSpeedRatio=linkBpm/recordedBpm` → `effSpeed`), never
a position jump.

Residual phase error is a bounded speed trim on `effSpeed` only, never on
`masterPhaseSamples` (the TARGET timeline) —
`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03` (51 cents),
suspended while `abs(g_manualSpeedMul-1.0)>0.3`. Trim runs only while
`linkVarispeedEngaged` — before any take `recorded_bpm` is 0, the ratio is
legitimately 1.0, and the trim saturates into a permanent 51-cent detune.
`setTransportPlaying(true)` anchors beat 0 via
`setIsPlayingAndRequestBeatAtTime(true,now,0.0,kLinkQuantum)`, never bare
`setIsPlaying`. `[[memory: link-varispeed-trim-history]]`.

### Two quantums — 16 for transport, 128 for phase CAPTURE

`kLinkQuantum=16.0` is the PAIRED value (transport anchor, `beatNow()`,
24-PPQN clock). `controlTick()` captures phase at
`kLinkPhaseQuantumBeats=128.0` and publishes `quantumMicroBeats` — a phase
read at quantum 16 aliases any loop longer than 16 beats onto the wrong half
of the phrase. Consumers must fold with `(quantumMicroBeats/1e6)`, never
`16.0` — `linkTargetSamples`/`gridBeatIndex` and `applyRemoteTransport`
(keeps the 16-beat grid so a quantized launch is never delayed up to 64s).

The idle/creation snap (`!anyAudible || masterJustCreated`) fires IMMEDIATELY
at creation — deferring it lands a whole-snapshot jump into playback.
Recording a master snaps `masterLenSamples` to whole beats and routes through
`finishTargetPending` like every sub-loop finish. `[[memory:
control-surface-quantization-history]]`.

`masterPhaseBuf` ramps at `masterPhaseSlope` = `linkSpeedRatio+linkPhaseTrim`
— the rate `rpos` integrates. A fixed 1.0 slope desyncs the anchor from the
read head inside every block whenever the take's tempo differs from Link's.

## MIDI clock fan-out and other mesh facts

`midi_clock.cpp`: 24 PPQN `0xF8`+`0xFA`/`0xFC` to every MIDI output except
the control surface. No `/dev/snd/seq` — walks `/proc/asound/card*/midi*`,
rescans every 2s, ticks off `LinkBridge::beatNow()`, catch-up bounded to
`kMaxCatchUpPulses=4.0`. Surface excluded by the card actually opened
(`controlSurfaceCard()`), not config parsing — `midi_device` is normally
`auto`, which excludes nothing; the clock waits `kSurfaceGraceSeconds=15.0`
and releases a port later found to be the surface. `[[memory:
mesh-link-midi-history]]`. `pinLinkThreadsToControlCore` pins Link's threads
to `kControlCore=2`; `[link] enabled = true` parses as a word, not `%d`.

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate:
**instrument** (default `hw:0,0`) tight-latency capture+playback, blocking,
retried 30x/1s; **OTG gadget** (`f_uac2`) best-effort MIRROR, NONBLOCK
(`-EAGAIN` expected). Instrument **S32_LE only** — class-compliant USB has no
S16_LE fallback, requesting it "succeeds" while negotiating S32_LE anyway
(loud static); buffer `int32_t`, divisor `2147483648.0f`.

Playback needs `start_threshold` lowered to one period (default =
`buffer_size` — stays `PREPARED` forever otherwise). **4 periods min** — 2
(ALSA min) produces hundreds of xruns/sec. `f_uac2-gadget.sh`: `req_number`
must be **4**, not default 2. Gadget is STEREO — L/R averaged to mono for
Faust, DSP stays mono internally. `main.cpp` declares `AudioThread` BEFORE
`audio.start()` — safe only because `snapshotTelemetry()` returns all-zero
pre-`start()`. Flush-to-zero set explicitly — denormals in decaying IIR are
10-100x slower. `AloopLoopDsp`/`Sampler` must be `std::make_unique`'d at
thread startup, never stack-local.

**Resolve string-keyed lookups ONCE, never per block** — control WRITE and
telemetry READ paths cache resolved `(ParamStore slot, Faust zone float*)`
pairs at startup; per-block resolution blows the 1.333ms budget (block_size 64
@ 48kHz). `FaustUI`'s bargraph adders must do
`zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan.
`targetToZone()` needs a case for every control target — a missing case
returns `""`, silent. `masterPhaseBuf` must ramp per-sample, never
`std::fill()` with a block-constant value (audible bitcrushing). Recording
taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`; Sampler
`captureBlock` reads the same `prevFiltOut`, never `fin` (would let a sample
record itself).

**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*combinedFold`
when engaged, ramping `foldGain` at `kFoldStepPerSample` = `(1/16)/N` — adds
one block of recording lag, `kShiftFoldBlockLatencySamples` (64) written at
FINISH if `m_looperShiftHeldDuringTake[looper]` was ever set, else 0.

---

# Faust DSP

## Language gotchas

`par()`-replicated UI controls silently duplicate — `button()`/`hslider()`
inside a `par()`-instantiated function RE-ELABORATES per call site even
hoisted (verify via generated C++, `grep -c '"name"'` must be 1); fix by
threading as a plain signal input. No runtime branching — `select2`/`ba.if`
choose among ALREADY-COMPUTED signals (why Guitar/LofiFx are a permanent
Core-3 LV2 bundle, Resonode/delayverb are conditionally-called). Direct
function-call syntax substitutes whole expressions, not buses —
`f(loop(...), a, b)` binds the ENTIRE `loop(...)` output to the FIRST
parameter. `ef.transpose` has a HARDCODED `maxDelay=65536`. Faust CSEs
`par()`-replicated pure-signal subexpressions even across `component()` files
sharing a control (one `pow()` + one oscillator for all three effects).

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation (`-ct 0`
safe, every `rwtable` index software-bounded); `-mcpu=cortex-a72` at
target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/fast-math.
**Not shipped**: `-mapp` (real-aarch64 SIGSEGV), `-fm def` (unresolvable
`fast_*` calls), `ba.tabulate` (not bit-exact), per-effect LV2 splitting,
`-omp`/`-sch` (fights `pthread_setaffinity_np` pinning), `-mcd`/`-dlt`,
`-clang`, `-mem`, `-vs 16` (SIGALRMs ~2min into `dsp/aloop_pre.dsp`).
`[[memory: faust-compile-time-cliff]]`.

**Compile-time cliff**: a NEW UI primitive in `resonode_synth.dsp`/
`pitchtracker_ac.dsp`/`multitranspose.dsp` risks unbounded real compile time
(`modeCount=24` dies by SIGALRM ~2min into `-i -a lv2.cpp`). A DawDreamer JIT
success proves nothing. Declare new controls in `effects_runtime.dsp` and
thread them in as plain signal arguments. Before accepting any `.dsp`
optimization, regenerate real C++ and diff byte-for-byte — identical output
means the change is a no-op. `flanger.dsp` `MAXD=4096`/`flutter.dsp`
`MAXD=1024` are at their real ceiling. `[[memory:
guitar-lofifx-cpu-audit-history]]`.

`effects/home/faust/chain.dsp` looks dead but is not — `build-lv2.yml` copies
it into the homestack, so deleting it breaks the LV2 build; `compressor.dsp`
is live only via `ab_fm_def.py`'s fast-math test.

**Buffer sizes, bit-exact via DawDreamer JIT**: `delay.dsp`/`delayverb.dsp`
`MAXD=52000`; `microrepeat.dsp` `MR_MAX=36000`; `bitcrush.dsp` `BITS_MAX=24`
not 16 (S32_LE never round-trips int16). `SLEW=0.0001` slew must carry NO
additive drift term. `effects_runtime.dsp`'s filter/delay/reverb/pitch stages
have NO parameter smoothing upstream of `pow()`/`exp()`.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices

NVOICES=6 absolute-pitch-lock (not an interval harmonizer), additive with the
mono SNAC engine below; each voice owns its own `EngineSoladSnac`.
`minTrackHz=60.0` floors `freqDet`, which prefers `pitchtracker.lv2`;
`trackingAllowed = trustedTracker > 0.5` only; `heldDetNote` reseeds every
attack until `everTrusted` latches. `engaged` is held by a linear release
counter `engageReleaseHoldS=0.06` — never gate on `gate>0.5` or `voiceEnv>0`
(an asymptotic envelope may never cross a threshold).

Formant (CC53, deadzone 60-68) via `LpcFormantShifter` (`vowelFormant.h`,
`kOrder=44` at 48kHz — order 10-12 measured a complete no-op;
`kHpPole=0.5925`). **The grain formant path is INERT on the poly path** —
`pitch_poly_ffi.h` never calls `setFormantDepth()`; live on MONO via
`pitch_ffi.h`. `[[memory: lpc-formant-shifter-history]]`.

**Disclosed, unfixed**: upward shifts ≥+18 semitones click (clean -24..+17
up, -24..-12 down) — start from `soladSnacOctaver.h`'s `m_scale`
crossfade-length division and resplice-trigger threshold. A signal-path guard
must derive from the same quantity the audio path uses, not the raw control
that nominally sets it (the `freeXpose`/`foldGain` bug class). `[[memory:
multitranspose-investigation-history]]`.

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s `dubfx_pitch_tick`
`ffunction`, ADR-004): SNAC tracker + solad delay-line PSOLA shifter +
formant grain stage. `DL=32768` (131072 corrupts the Pi's 32-bit-pointer
build), `MIN_PERIOD=48`, `DUBFX_BS=64`, a permanent ~1.333ms latency while
engaged. `m_xfadeLen` is DIVIDED by the pitch ratio (clamped ≥1.0) —
undivided, readers drift `(scale-1)` periods apart during the fade. **Open
bug**: SNAC drift on tremolo/AM content — `detectPitchStep()`'s anti-jitter
clamp walks toward a wrong subharmonic instead of rejecting it. `[[memory:
free-transpose-engine-history]]`, `[[memory: cold-start-self-trap]]`.

## `pitchtracker.lv2`/DawDreamer

`effects/pitchtracker-src/pitchtracker_ac.dsp` — separate compilation unit,
own LV2 bundle, `Lv2Host pitchTrackerFx` (`/effects/pitchtracker`); normalized
autocorrelation with local-maximum peak selection and a
`holdLastGood`/`energyReady` onset gate; must deploy to
`/effects/pitchtracker/pitchtracker.lv2/`. Accurate below 500Hz.
`minTrackHz=60` is a deliberate floor — a 60Hz reading means "no lock".
DawDreamer's `FaustProcessor` refuses `ffunction` externs, so
`verify_highoctave_transient.py` can NEVER pass — unconditionally red, not a
gate to triage. `tools/dsp-cli/build.bat` compiles ANY `.dsp` with real
`faust.exe`+MSVC in ~1-2s. `[[memory: ci-build-pipeline-history]]`.

---

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*`, never
bare `nullptr` — Faust's `lv2.cpp` loops `features[i]` unchecked. Wrap
`instantiate()`/`activate()` in the sigsetjmp crash watchdog `runOne()` uses
(ADR-002). `readTtl()` must strip trailing slashes from the bundle path
(lilv's resolved path has one, `bundlePath` never does — else prefix compare
fails silently, falls back to no-port-wiring `.so`-only, watchdog off).
`setControl` matches Faust's MANGLED port symbol
(`mangleFaustLabel(rawLabel)+"_"+"<portIndex>"`, e.g.
`fx2/FLANGEAMT`→`fx2_FLANGEAMT_3`) — verify via `grep lv2:symbol *.ttl`.
`Lv2Plugin::descriptor` caches at `instantiate()`, never re-resolved on the RT
path. `aloop.lv2` excluded from apkovl by name (ADR-003).

## Resonode: separate, conditionally-called LV2 bundle

`resonode_synth.dsp` pulled off the always-on Faust graph (avoids a real ~2ms
idle `readi` gap) into `resonode.lv2` (`Lv2Host resonodeFx`,
`/effects/resonode`); called only when `fx/resonode/engaged`. Per-voice
`note`/`gate`/`vel` are LV2 ports from `ApcGrid`'s MIDI handlers.
`resonodeIn` is ZEROED when engaged with no plugins loaded; output re-enters
the crossfade BEFORE `microStage:filterStage:delayStage:reverbStage`,
REPLACING never layering the original. `RESONODE_ENGAGED` is written directly
via `fui.set()` in the worker loop, bypassing `targetToZone` — two consumers,
audit both. `ApcGrid::bindAll` must `ps.bind()` every internal flag a C++ path
`setByName`s. NaN/Inf guard after `resonodeFx.process()` zeroes the block,
rate-limited `[diag-resonode]` log.

`modeCount=16` (16-of-24 — 24 hits a real `faust` compile-time SIGALRM
ceiling), 4 voices, physically-modeled, excited ONLY by live mic (silent
input, held key = silence); shared broadband exciter, each mode's own filter
does frequency selection. `couple` (knob7) is nearest-neighbor `letrec`
skew-symmetric energy exchange, `coupleSmallGainMax=0.45`, clamp
`coupleGuardCeil=8.0` (tanh rejected — never exactly identity). 5 ratio
tables x5 shape hsliders. Shipped: zero gaps idle. Disclosed: mono only.
`[[memory: resonode-exciter-coupling-cpu-history]]`.

Sweetspot patches (`kResonodePatches`, knobs1-4); knobs 5-7:
`fx/resonode/{tone,level,couple}`:

| Patch | position | decay | damping | stretch | collision | character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s, harmonic |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass |

## delayverb: separate, conditionally-called LV2 bundle

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves
(`aloop_pre.dsp`/`aloop_post.dsp`, both previously unconditional, ran TWICE
regardless of amount) — `.process()` is called only when `delayVerbActive`.
**Two separate instances** (`delayVerbFxCue` + `delayVerbFxMaster`) — sharing
one corrupted its feedback state; `delayVerbActive` requires BOTH
`hasPlugins()`. Build needs `libboost-dev`.

`cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never `cc70`/
`cc71` (real APC Key25 sends NOTES 70/71 ch0). `note91` (`0x5B`) must never
bind to `cmd/clearall` — races `ApcGrid`'s shadow-state reset.

**Tracktion Engine is REJECTED** — do not re-open without new evidence
(`[[memory: tracktion-engine-rejection]]`).

---

# Control surface (`src/control/apc_grid.cpp`)

MIDI routing (`src/control/midi.cpp`): APC Key25 pads/buttons are **channel
0**; the keybed is **channel 1** — injecting keybed notes on ch0 produces no
response. SHIFT is `kApcBtnShift=0x62` (note 98) ch0. Sustain is CC64
(`d2>=64`) on any channel, latching `m_sustainLatched`. **A live playthrough
capture is not representative until SHIFT and latch-sustain are both sent
first** (`raw 90 62 7f` then `raw B0 40 7F`) — without the latch,
monitored/captured output is ~10x quieter. `[[memory:
live-playthrough-cue-requires-shift-sustain]]`.

Every momentary Faust gate must be explicitly released or it sticks at 1
forever: `looperN/erase` (`pollHolds` releases after ~50ms),
`looperN/finishreq`, `cmd/clearall` (genuinely HELD). Every abandon path
(`applyRecPlayCycle`'s `rawSamples<=0` abort, `pollHolds`'s hold-erase loop,
`onClearAll`) must ALSO pulse `finishreq=1` with `finishtarget` set to the
real telemetry `widx`, or Faust's `pend` stays latched and fires a phantom
arm→finish blip at the next phrase-top. `rec` is persistent `ParamStore`
state — `applyRecPlayCycle` sets `rec=0` on FINISH or it re-records forever.
Per-looper cycle: empty → ARM(`rec=1`) → FINISH(`rec=0`, `play=1`) →
pause(`play=0`) → resume(`play=1`); ARM/FINISH on PRESS, pause/resume on
release. `kLooperCount=20`; `looperN/hascontent` is the real content slot —
Faust's `wrapLen` is clamped to a minimum of 1.

`m_masterLenSamples`/`cmd/master_len`/`cmd/recorded_bpm` reset to 0 when the
last looper with content is erased — `anyHasContent` cross-checks
`Telemetry::looperWrapLen` and self-heals the shadow, skipping loopers with
`m_looperWrapLenStaleAfterWipe` (wipe never resets DSP `wraplen`, only FINISH
writes it). Master phrase length is `writeIdx` telemetry, never wall-clock.

**Content phase-anchor**: playback anchors to a shared `masterPhase` grid,
never a per-take offset. Non-first-looper `armEdge` fires on
`fineGridWrapped` (masterPhase crossing any 1/8-beat boundary — hoisted once
in `loopEngine`, same pattern as `masterPhaseWrapped`) — every looper waits at
most ~30-60ms instead of up to a full phrase. `rsmNext` captures real
`masterPhase` at armEdge. Real backward content recovery is a deferred gap —
needs a C++ `ffunction`. FINISH length is near-cut/far-extend
(`pickAnchorGridBeats`, the same ladder Faust's own snap uses — it REPLACED
the old `lowerExp`/`lowerCand`/`upperCand` powers-of-masterLen scheme):
overshoot past the most recently passed grid node ≤1 beat cuts to it
immediately, else extends to the next node. Ceiling is `kMaxLoopSamples`
(48000*60). **Disclosed**: `winSamples`/`xfSamples` freeze at floor on a cold
start. `[[memory: control-surface-quantization-history]]`.

First (master-establishing) recording's tempo/beats comes from a real synced
Link tempo when present — `recorded_beats` snapped to the nearest power-of-2
in {1,2,4,8,16,32,64,128} (`snapBeatsToPow2`, fixed from a raw `round()` that
could pick any integer, breaking the power-of-2-ratio invariant);
`deriveTempoQuant` is fallback-only. Real APC Key25 re-sends note-on for an
already-held pad — `onPadPress`/`m_looperHeld` treats a repeat as no-op.
Guitar-fx held REDIRECTS looper pad presses to `onSidechainLooperToggle`
while `m_guitarFxHeld`.

## LofiFx/granulator button — SHIFT disambiguates (note 69)

Both fire on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap toggles
Resonode engage (always wins, forces granulator off; disengage releases every
held voice). Resonode-engaged keybed drives 4 voices via
`Lv2Host::setControl` to `fx/resonodevoice{v}/{note,gate,vel}` (skipped when
disengaged, unlike `multitranspose.dsp`'s 6 always-on voices). LEDs: blinking
red=Resonode, solid green=granulator.

## Granulator (`src/dsp/sampler/sampler.h`)

C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/
`posJitterMs`/`scanRate`/`reverseProb`/`envShape`), `MAX_GRAINS=48` shared
across 16 voices; `scanRate=0` freezes, negative `rate`/`reverseProb`
reverses. Direct dials (knobs 5-7) override the
patch-blended field once touched. Grain pool budgeted PER VOICE
(`MAX_GRAINS/voices`), never exhaustible. `[[memory:
granulator-investigation-history]]`.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching 8-knob
banks via `ApcGrid::onFxKnobCC` on `m_activeBank`/`m_shift`.
`kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 double-duties as Formant
on Dub only):

| Page | Regular (knobs 1-7) | Shift |
|---|---|---|
| Dub | `fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant | dance-gate+LFO: `fx/dubgate/*`/`fx/dublfo/*`, off the shared 4-beat clock |
| Guitar | `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}`, CC53=`fx2/GATEAMT` | 8-dial dual-ADSR straight to C++ `Sampler` |
| LofiFx | knob0 `fx2/BITCRUSHAMT`, knobs1-4 patch weights | knobs5-7 direct dials |

Groove shuffle: `kBeatPadNotes={15,23,31,39}` double as shuffle buttons,
`fx/shuffle/mask` (4-bit) — true retrigger/reorder, block-boundary only, own
`shuffleClockSamples` atop the real `masterPhaseSamples+i` ramp;
`kShiftReorderTables[mask]` eliminates double-tap. `dsp/loop.dsp` varispeed
has NO deadzone (`varispeedActive=effSpeed!=1.0` exact); `resyncCoeff` gates
to `0.0` when `manualPunchActive`; both varispeed's instant jump and
beat-shuffle's hard clip are INTENTIONAL. `microrepeat.dsp`'s
`sliceBlocks=max(1,int(beatBlocks/divSafe))*2`, `divSafe=max(1,DIV)` (never
halve the divisor first). CC53 formant: `((data2-64)/63.0)*1.5`, deadzone
60-68 — SHIFT never changes a knob's own behavior.

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a different
USB role (peripheral/gadget vs. host mode on the USB-A ports).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring (5s);
`audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(), N)` every
block, next to `g_sampler->captureBlock(...)`. Single-atomic-counter SPSC
ring, never blocks/allocates — a lagging consumer has `pushBlock` advance the
read counter itself (drops oldest samples).

**Control side**: file I/O happens in `UsbRecorder::poll()`, called from
`main.cpp`'s 5 Hz control loop, not a dedicated pthread. Chunks fixed-size,
cyclically `O_TRUNC`-reopened (bounds disk by construction); mount detection
is a `stat()` device-id compare. Config:
`[storage]` in `config/aloop.conf` — `usb_record`, `usb_mount_point`,
`usb_chunk_minutes` (10), `usb_chunk_count` (6). Clip export (note 93,
`src/storage/clip_exporter.cpp`) keys off `m_looperHasContent`, not `wrapLen`.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`usb-automount-setup.sh` (APPENDS to `/etc/mdev.conf`, own coldplug pass since
`local.d` runs AFTER `mdev -s`). Mount attempts: no `-t` first, then `ntfs3`
(real read-write NTFS — BEFORE the legacy read-only `ntfs`), then
vfat/ext4/exfat; `ntfs3` needs `force` or a dirty drive is rejected.
UNVERIFIED on real hardware.

Faust libs: faustlibraries `doc/docs/libs/index.md`, `standardFunctions.md`, `faustdoc.grame.fr/manual/optimizing/`.
