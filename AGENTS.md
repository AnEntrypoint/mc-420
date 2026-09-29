# aloop — technical constraints reference

Durable constraints for this codebase and its build/deploy pipeline.
Real Pi 4 device `192.168.137.100`, root/aloop. Real Pi 3B+ debug
device reaches the host via netboot (`.netboot-serve-pi3/`, `[[memory:
project-pi3-netboot]]`). Read before touching device/DSP/netboot.

Lean, current-state-only reference: hardware facts, build/deploy
procedures, shipped architecture, working rules, open/disclosed bugs.
Long-form investigation history lives in auto-memory
(`~/.claude/projects/<project>/memory/`); `[[memory: ...]]` pointers
carry the "why". Re-compacted at ~30KB.

## Contents

- Boards, images, boot trees
- Device runtime environment
- Deploy, netboot, SSH
- Mesh networking
- Audio thread and ALSA
- Faust DSP
- LV2 hosting
- Control surface
- Storage
- Working rules

---

# Working rules

**No comments in code, ever.** No inline, block, or doc comments
anywhere (C++, Faust `.dsp`, JS, shell, YAML, config) — a name/
function-boundary/extracted-variable/small-type IS the explanation.
Design rationale belongs in THIS file or memory, never inline (SSOT).
A comment found anywhere is converted to self-explanatory code the
same turn (root-cause it, delete it); one sighting spawns a full sweep
of that file. `[[memory: no-comments-rule]]`.

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
| pi4 (+CM4, Zero2) | BCM2711, quad A72 aarch64 | Pi firmware, FAT | dwc2 — real UAC2 gadget | brcmfmac |
| pi3 | BCM2837, quad A53 aarch64 | Pi firmware, FAT | none — no OTG controller | brcmfmac |
| pi5 | BCM2712, quad A76 aarch64 | Pi firmware, FAT | none — RP1 USB host-only | brcmfmac |
| opi-prime | Allwinner H5, quad A53 aarch64 | Armbian U-Boot (raw sectors) + ext4 + extlinux.conf | unproven | RTL8723BS |

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
root. No netboot path; skipped in `build-image.yml`.
`console=ttyS0,115200` verified. U-Boot load addresses and full
boot-chain rationale: `[[memory: opi-prime-boot-history]]`.

## apkovl assembly constraints

- `boot_tree_apkovl` stamps `.default_boot_services` — Alpine's
  `rc_add modloop sysinit` gate needs it or `/lib/modules`/
  `/proc/asound`/`usb_gadget/` never appear.
- `aloop`'s OpenRC needs `rc_ulimit="-l unlimited -r 95"`, not
  `local.d ulimit`; `depend()` needs `after local autoap`.
- Vendor alsa-lib + lilv as real `.so`s; never `apk add` at boot
  (needs `vendor/share-alsa/` or `snd_pcm_open` segfaults). `hostapd`/
  `dnsmasq` vendored aarch64 too; needs `libnl-3.so.200`.
- `cmdline.txt`/`extlinux.conf` APPEND stays one line; collapsed via
  `tr '\n' ' '` + `tr -s ' '`.
- New vendored files need both `tar --mode='+x'` lists (NTFS has no
  exec bit); `find` calls building those lists must run inside the
  overlay dir. `[[memory: windows-host-constraints]]`.
- `core.autocrlf=true` corrupts scripts here — fix via `rm` + `git
  checkout --`.

---

# Device runtime environment

**Alpine/musl/aarch64 — glibc/x86_64 artifacts silently fail to load**
(a `.so` built with host g++ dlopens fine, then fails at load). Pattern:
split `faust2lv2`'s stages — `faust -i -a lv2.cpp` emits `.cpp`;
`$HOST_CXX` compile+run emits `.ttl` (host-only); only the final
`-shared .so` link targets the device, cross-compiled in a real Alpine
aarch64 container. Verify: `objdump -p foo.so | grep NEEDED` →
`libc.musl-aarch64.so.1`, never `libc.so.6`. `[[memory:
windows-host-constraints]]` covers the nested-`docker run` `CPPFLAGS`
quoting gotcha.

**`upload-artifact@v4` `path:` wildcard-vs-literal.** Wildcard
preserves the matched dir's basename; literal flattens its CONTENTS at
the zip root, dropping the `.lv2/` wrapper. Always use wildcard for LV2
bundle artifacts.

**`disable_core3_lv2` in `/etc/aloop.conf`.** Uncommented `= 1` makes
the worker skip `homeFx.process()`/`userFx.process()` entirely — fully
silent, survives `rc-service aloop restart`. Always `grep -n
disable_core3_lv2 /etc/aloop.conf` before debugging "effects don't do
anything" as a code bug.

---

# Deploy, netboot, SSH

**SSH: use a JS `ssh2` client, never Windows ssh.exe or sshpass**
(`[[memory: windows-host-constraints]]`) — a fresh netboot generates a
new host key every boot, breaking raw `ssh`/known_hosts but not `ssh2`.

**The `REBOOT:<token>` UDP listener lives INSIDE the aloop process**
(`config/aloop.conf`'s `[remote] token=`, `udp/4446`,
`remote_control.cpp`). If `aloop` crashed, nothing listens — use `node
ssh-exec.js 192.168.137.100 "reboot"`. Verify before trusting device
state: `/proc/uptime` and `md5sum /opt/aloop/aloop` vs deployed, BEFORE
reading logs. Full REBOOT-listener/self-update mechanics: `[[memory:
deploy-two-paths-lv2]]`.

## Netboot self-update: two rebuild paths

**Automatic**: `image/serve-netboot-win.js` polls
`build-binary.yml`/`build-lv2.yml`'s green `main` every 30s; blind to
`image/**` packaging changes. **Manual**: `ALOOP_BIN=<path>
LV2_DIR=<path> RESONODE_LV2_DIR=<path> PITCHTRACKER_LV2_DIR=<path>
DELAYVERB_LV2_DIR=<path> OUT=.netboot-serve
NETBOOT_SERVER=192.168.137.1 bash image/build-netboot.sh` — all three
`*_LV2_DIR` vars **mandatory**; verify via `tar -tzf
.netboot-serve/aloop.apkovl.tar.gz | grep -oE
'effects/[a-z]+/[a-z_]+[.]lv2' | sort -u` → delayverb, guitar_lofi_fx,
pitchtracker, resonode. New bundle needs wiring into BOTH
`build-image.yml` AND `serve-netboot-win.js`.

`build-netboot.sh` publish is a staged-directory atomic `mv`. Netboot
silently outranks the SD card — confirm which path booted. Netboot
DHCP: three failure signatures — dead option-66/zero TFTP reads,
DISCOVERs never becoming REQUESTs, stale baked-in server IP post-TFTP;
`ensureCorrectSubnetMask()` self-heals every startup. `[[memory:
netboot-dhcp-diagnosis-history]]`. Fast DSP iteration: `node
image/dsp-hotdeploy.js --target home|guitar|both` — stops service
BEFORE overwriting `/opt/aloop/aloop` (`fastPut` fails musl ETXTBSY).

## CI runner, docker-step, artifact discipline

Native `ubuntu-24.04-arm` runners (no QEMU); Docker steps split with
per-command `timeout`+`set -x`. `build-image.yml` downloads BOTH
`home-fx-lv2` AND `guitar-lofi-fx-lv2` from the same green run; rolling
`latest` hard-gates on a real bundled binary (`payload_check`),
stricter than `validate-image.sh` (WARNS only). `[[memory:
ci-build-pipeline-history]]`.

---

# Mesh networking

## aloop ↔ esp-idf-link paired invariants (change BOTH or the mesh splits)

aloop (Pi 4) and `../esp-idf-link` (ESP32, "ticker") form ONE ad-hoc
single-AP mesh for Link's multicast peer discovery.

| Invariant | aloop | esp-idf-link |
|---|---|---|
| Mesh SSID | `hostapd.conf`/`wpa_supplicant.conf` `ssid=ticker` | `wifi_scan_best_bssid`/`wifi_start_link_ap("ticker")` |
| Auth | open (`key_mgmt=NONE`) | `wifi_connect_sta("ticker", "")` |
| AP/DHCP | `192.168.4.1/24`, dnsmasq `.2-.20` | `esp_netif_set_ip_info` same |
| Channel | `hostapd.conf` `channel=6` | SoftAP ch6 |
| Link quantum | `link_bridge.cpp` `quantum=16.0` | `LINK_QUANTUM 16.0` |
| Host election | lowest MAC/BSSID wins | same |

Host election is MAC-ordered (never "host if scan found nothing" —
splits the mesh). `src/net/autoap.sh`: hosts `ticker` never `aloop`;
`start_ap()` clears previous hostapd not just wpa_supplicant (stale →
`Could not set channel`, red herring — ch6 is paired). `[[memory:
mesh-link-midi-history]]`.

## Ableton Link checklist and varispeed/transport-anchor

`commitAppSessionState()` off-audio-thread, `commitAudioSessionState()`
audio-thread only — hands the audio thread a lock-free double-buffered
`LinkSnapshot` (ADR-005, ≤1 tick stale). `setTempo` rewrites EVERY
peer; `proposeTempo` refuses when peers present. Playback matches
tempo by scaling read RATE (`linkSpeedRatio=linkBpm/recordedBpm`→
`effSpeed`), never a position jump; residual phase error is a bounded
speed trim (`kLinkPhaseTrimPerSample=0.00005`, clamp
`kLinkPhaseTrimMax=0.03`=51 cents) on `effSpeed` only, never
`masterPhaseSamples`. `setTransportPlaying(true)` anchors beat 0 via
`setIsPlayingAndRequestBeatAtTime(true,now,0.0,kLinkQuantum)`, never
bare `setIsPlaying`. Live check: `eff_speed` reads exactly `1.0000`
with nothing recorded. `[[memory: link-varispeed-trim-history]]`.

## MIDI clock fan-out and other mesh facts

`midi_clock.cpp`: 24 PPQN `0xF8`+`0xFA`/`0xFC` to every MIDI output
except the control surface. No `/dev/snd/seq` — walks
`/proc/asound/card*/midi*`, rescans every 2s, ticks off
`LinkBridge::beatNow()`. Control surface excluded by the card actually
opened, not config parsing. `[[memory: mesh-link-midi-history]]`.
`pinLinkThreadsToControlCore` pins Link's threads to `kControlCore=2`
— prevents peer-discovery contending with isolated audio cores.
`[link] enabled = true` parses as a word, not `%d`.

---

# Audio thread and ALSA

`audio_thread.cpp`'s `worker()` opens two PCM devices — never conflate:
**instrument** (default `hw:0,0`) tight-latency capture+playback,
blocking, retried 30x/1s; **OTG gadget** (`f_uac2`) best-effort MIRROR,
NONBLOCK (`-EAGAIN` expected). Instrument **S32_LE only** —
class-compliant USB has no S16_LE fallback, requesting it "succeeds"
while negotiating S32_LE anyway (loud static); buffer `int32_t`,
divisor `2147483648.0f`. OTG mirror separate S16_LE.

Playback needs `start_threshold` lowered to one period (default =
`buffer_size` — stays `PREPARED` forever otherwise). **4 periods min**
— 2 (ALSA min) produces hundreds of xruns/sec. `f_uac2-gadget.sh`:
`req_number` must be **4**, not default 2. Gadget is STEREO — L/R
averaged to mono for Faust, DSP stays mono internally. `main.cpp`
declares `AudioThread` BEFORE `audio.start()` — safe only because
`snapshotTelemetry()` returns all-zero pre-`start()`. Flush-to-zero set
explicitly — denormals in decaying IIR are 10-100x slower.
`AloopLoopDsp`/`Sampler` must be `std::make_unique`'d at thread
startup, never stack-local, never in the RT hot path.

**Resolve string-keyed lookups ONCE, never per block** — control WRITE
and telemetry READ paths cache resolved `(ParamStore slot, Faust zone
float*)` pairs at startup; per-block resolution makes `readi()` take
2.2-2.7ms against a 1.333ms budget. `FaustUI`'s bargraph adders must do
`zones[full(l)]=z` or `hbargraph()` falls through to an O(n) scan.
`targetToZone()` needs a case for every control target — a missing
case returns `""`, silent. `masterPhaseBuf` must ramp per-sample, never
`std::fill()` with a block-constant value (audible bitcrushing).
Recording taps `loop.dsp`'s `prevFiltIn` fed from `prevFiltOut`;
Sampler `captureBlock` reads the same `prevFiltOut`, never `fin` (would
let a sample record itself).

**SHIFT (`fx/monitorfold`) fold**: `fin[i] += prevLoopSum[i]*
combinedFold` when engaged, ramping `foldGain` at `kFoldStep`
(1/16/block) — adds one block of recording lag,
`kShiftFoldBlockLatencySamples` (64) written at FINISH if
`m_looperShiftHeldDuringTake[looper]` was ever set, else 0.

---

# Faust DSP

## Language gotchas

`par()`-replicated UI controls silently duplicate — `button()`/
`hslider()` inside a `par()`-instantiated function RE-ELABORATES per
call site even hoisted (verify via generated C++, `grep -c '"name"'`
must be 1); fix by threading as a plain signal input. No runtime
branching — `select2`/`ba.if` choose among ALREADY-COMPUTED signals
(why Guitar/LofiFx are a permanent Core-3 LV2 bundle and
Resonode/delayverb are conditionally-called). Direct function-call
syntax substitutes whole expressions, not buses — `f(loop(...), a, b)`
binds the ENTIRE `loop(...)` output to the FIRST parameter, build the
bus with `,` then pipe with `:`. `ef.transpose` has a HARDCODED
`maxDelay=65536` independent of its window argument; Faust already
CSEs `par()`-replicated pure-signal subexpressions, only
`button()`/`hslider()` boxes are exempt.

## Compiler flags — currently shipped

`-vec -fun -dfs -vs 32 -nvi -ct 0` at every real `faust` invocation
(`-ct 0` safe, every `rwtable` index software-bounded); `-mcpu=cortex-a72`
at target-compile steps only; `-O3`, no `-Ofast`/`-march=native`/fast-math.
**Not shipped**: `-mapp` (real-aarch64 SIGSEGV), `-fm def` (unresolvable
`fast_*` calls), `ba.tabulate`, per-effect LV2 splitting, `-omp`/`-sch`,
`-mcd`/`-dlt`, `-clang`/`-mem`, `-vs 16` (SIGALRMs ~2min into
`dsp/aloop_pre.dsp` codegen) — full per-flag reasoning: `[[memory:
faust-compile-time-cliff]]`.
`guitar_lofi_fx.dsp` has no exploitable CPU waste at the source level.
`[[memory: guitar-lofifx-cpu-audit-history]]`.

## Buffer sizing constants

Bit-exact via DawDreamer JIT: `delay.dsp` `MAXD=52000` (~999.6ms cap);
`microrepeat.dsp` `MR_MAX=36000` (real ceiling 32768); `bitcrush.dsp`
`BITS_MAX=24` not 16 (S32_LE device never round-trips int16). `SLEW=
0.0001` slew must carry NO additive drift term. `effects_runtime.dsp`'s
filter/delay/reverb/pitch stages deliberately have NO parameter
smoothing upstream of `pow()`/`exp()`.

## `multitranspose.dsp` — polyphonic pitch-LOCK, 6 voices

`effects/home/faust/multitranspose.dsp`: NVOICES=6 absolute-pitch-lock
(not an interval harmonizer), additive with the mono SNAC engine below;
each voice owns its own `EngineSoladSnac`, the only splice/PSOLA
implementation in the codebase. `freqDet` prefers `pitchtracker.lv2`;
`trackingAllowed = trustedTracker > 0.5` only (not OR'd with warmup);
`heldDetNote` reseeds every attack until `everTrusted` latches. Formant
(CC53, deadzone 60-68) via `LpcFormantShifter`, `[[memory:
lpc-formant-shifter-history]]`. **Disclosed, unfixed**: upward shifts
≥+18 semitones click (clean -24..+17 up, -24..-12 down);
`pitchtracker.lv2` unreliable ≥500Hz; `verify_highoctave_transient.py`
is a broken gate on `main`. Voice mechanics/splice detail: `[[memory:
multitranspose-investigation-history]]`, `[[memory:
faust-compile-time-cliff]]`.

## Free-transpose engine (`soladSnacOctaver.h`/`EngineSoladSnac`)

The `-12` live pitch engine (`pitch_ffi.h`/`pitch.dsp`'s
`dubfx_pitch_tick` `ffunction`, ADR-004): SNAC tracker + solad
delay-line PSOLA shifter + formant grain stage — 0.99-1.00 THD to
5000Hz. `DL=32768` (131072 corrupts the Pi's 32-bit-pointer build),
`MIN_PERIOD=48`, `DUBFX_BS=64`/`DUBFX_POLY_BS=16`, a permanent
~1.333ms latency while engaged (working-rule carve-out). **Open bug**:
SNAC tracker drift on tremolo/AM content. `[[memory:
free-transpose-engine-history]]`, `[[memory: cold-start-self-trap]]`.

## `pitchtracker.lv2`/DawDreamer/`tools/dsp-cli`

`effects/pitchtracker-src/pitchtracker_ac.dsp` — separate compilation
unit, own LV2 bundle, `Lv2Host pitchTrackerFx` (`/effects/
pitchtracker`); normalized autocorrelation with local-maximum peak
selection and a `holdLastGood`/`energyReady` onset gate; must deploy to
`/effects/pitchtracker/pitchtracker.lv2/`. DawDreamer's
`FaustProcessor` refuses `ffunction` externs; `faust2bench` is the CPU
A/B counterpart, manual only. `tools/dsp-cli/build.bat <repo_root>
<dsp_file> [-I flags]` compiles ANY `.dsp` with real local
`faust.exe`+MSVC in ~1-2s — compiles files DawDreamer categorically
cannot. `[[memory: ci-build-pipeline-history]]`, `[[memory:
faust-compile-time-cliff]]`.

---

# LV2 hosting

`Lv2Host::instantiate()` needs a NULL-terminated `LV2_Feature* const*`,
never bare `nullptr` — Faust's `lv2.cpp` loops `features[i]` unchecked.
Wrap `instantiate()`/`activate()` in the sigsetjmp crash watchdog
`runOne()` uses (ADR-002). `readTtl()` must strip trailing slashes from
the bundle path (lilv's resolved path has one, `bundlePath` never does
— else prefix compare fails silently, falls back to no-port-wiring
`.so`-only, watchdog off). `setControl` matches Faust's MANGLED port
symbol (`mangleFaustLabel(rawLabel)+"_"+"<portIndex>"`, e.g.
`fx2/FLANGEAMT`→`fx2_FLANGEAMT_3`) — verify via `grep lv2:symbol *.ttl`
on the deployed bundle. `Lv2Plugin::descriptor` caches at
`instantiate()`, never re-resolved on the RT path. `aloop.lv2` excluded
from apkovl by name (`home-fx-lv2` compiles `dsp/aloop.dsp` only as a
CI packaging-reproducibility check, ADR-003).

## Resonode: separate, conditionally-called LV2 bundle

`resonode_synth.dsp` pulled off the always-on Faust graph (avoids a
real ~2ms idle `readi` gap) into `resonode.lv2` (`Lv2Host resonodeFx`,
`/effects/resonode`); called only when `fx/resonode/engaged`. Per-voice
`note`/`gate`/`vel` are LV2 ports from `ApcGrid`'s MIDI handlers.
`resonodeIn` is ZEROED when engaged with no plugins loaded; output
re-enters the crossfade BEFORE
`microStage:filterStage:delayStage:reverbStage`, REPLACING never
layering the original. `RESONODE_ENGAGED` is written directly via
`fui.set()` in the worker loop, bypassing `targetToZone` — two
consumers, audit both on change. `ApcGrid::bindAll` must `ps.bind()`
every internal flag a C++ path `setByName`s.

6 modes/voice, 4 voices, physically-modeled, excited ONLY by live mic
(silent input, held key = silence); shared broadband exciter, each
mode's own filter does frequency selection. `couple` (knob7):
nearest-neighbor `letrec` coupling, clamped ±8. 16-of-24 modes shipped
(24 hits a compile-time SIGALRM ceiling); 5 ratio tables x5 hsliders.
Shipped: zero gaps idle, worst case 80% peak/3 gaps, zero xruns.
`[[memory: resonode-exciter-coupling-cpu-history]]`.

Named sweetspot patches (knobs1-4, DawDreamer grid search):

| Patch | position | decay | damping | stretch | collision | character |
|---|---|---|---|---|---|---|
| Percussive | 0.08 | 0.15 | 0.80 | -0.10 | 0.55 | ~60ms decay, sharp |
| Metal/Glass | 0.08 | 7.00 | 0.97 | 1.20 | 0.15 | ~2.5s, bright/inharmonic |
| Strings | 0.08 | 7.00 | 0.97 | -0.10 | 0.00 | ~2.5s, harmonic |
| Dance Bass | 0.42 | 7.00 | 0.15 | -0.10 | 0.30 | long ring, sub-bass |

Knobs 5-7: tone brightness, level, `couple`. Per-voice modulation
(fixed constants, no knob slot): position/stretch drift envelopes,
`bassBoost`, `aliasGuard`, `collision` waveshaper, pitch-mod onset
bump, morph-snap-at-boot. `[[memory:
resonode-exciter-coupling-cpu-history]]`. Disclosed: mono in/out only.
Defense-in-depth: NaN/Inf guard at the C++ call site after
`resonodeFx.process()` — zeroes the block, rate-limited
`[diag-resonode]` log.

## `config/controls.conf` regression guardrails

`cmd/halfspeed`/`cmd/doublespeed` stay `note70`/`note71`, never
`cc70`/`cc71` (real APC Key25 sends NOTES 70/71 ch0). `note91` must
never bind to `cmd/clearall` — races `ApcGrid`'s shadow-state reset;
`midi.cpp`'s note-91 intercept is unconditional on shift.

## delayverb: separate, conditionally-called LV2 bundle

`delayverb.dsp` extracted into `delayverb.lv2`, compiled in two halves
(`aloop_pre.dsp`/`aloop_post.dsp`, both previously unconditional, ran
TWICE regardless of amount) — `audio_thread.cpp` now calls `.process()`
only on the instance with nonzero DELAYAMT/REVAMT. Build needs
`libboost-dev`.

## Tracktion Engine — evaluated and REJECTED, do not re-open without new evidence

`[[memory: tracktion-engine-rejection]]` has the full reasoning.
Higher-leverage alternative: fold `guitar_lofi_fx.lv2` into Core-3
Faust natively — confirm `/effects/user` is genuinely unused first.

---

# Control surface (`src/control/apc_grid.cpp`)

Every momentary Faust gate must be explicitly released or it sticks at 1
forever: `looperN/erase` (`pollHolds` releases after ~50ms),
`looperN/finishreq` (same shape), `cmd/clearall` (genuinely HELD —
note-on sets, note-off releases). `rec` is persistent `ParamStore`
state — `applyRecPlayCycle` sets `rec=0` on FINISH or it re-records
forever. Per-looper cycle: empty → ARM(`rec=1`) → FINISH(`rec=0`,
`play=1`) → pause(`play=0`) → resume(`play=1`); ARM/FINISH fire on
PRESS, pause/resume on release. CLEAR_ALL zeroes `play`/`rec` in Faust,
not just C++ shadow; `onStopImmediate` also zeroes `rec` on a
mid-recording abort. `m_masterLenSamples`/`cmd/master_len`/
`cmd/recorded_bpm` reset to 0 when the last looper with content is
erased — `anyHasContent` cross-checks `Telemetry::looperWrapLen` and
self-heals the shadow, skipping loopers with
`m_looperWrapLenStaleAfterWipe` (wipe never resets DSP `wraplen`, only
FINISH writes it; ignoring that resurrected cleared loopers as
paused). Master phrase
length is `writeIdx` telemetry, never wall-clock. Quantization is
powers-of-2, always the CEILING (`kMaxLoopSamples` top, M/16 bottom via
`lowerExp` floor -4.0); every `wrapLen` is a power-of-2 ratio of every
other. `[[memory: control-surface-quantization-history]]`.

**Content phase-anchor**: playback anchors to a shared `masterPhase`
grid, never a per-take offset. Non-first-looper `armEdge` fires on
`fineGridWrapped` (masterPhase crossing any 1/8-beat boundary — hoisted
once in `loopEngine`, same pattern as `masterPhaseWrapped`, zero new
per-looper state) — every looper waits at most ~30-60ms instead of up
to a full phrase. `rsmNext` captures real `masterPhase` at armEdge.
Real backward content recovery (audio from before the press, not just
relabeling the anchor) is a deliberately deferred gap — two richer
designs hit this file's compile-time-cliff; needs a C++ `ffunction`.
FINISH length is near-cut/far-extend
(`pickAnchorGridBeats` in `apc_grid.cpp`, same ladder Faust's own snap
uses): overshoot past the most recently passed grid node <=1 beat cuts
to it immediately, else extends to the next node (old ceiling, now only
for genuinely longer takes) — closes the double-quantization-mismatch
class for good. **Disclosed**: `winSamples`/`xfSamples` can freeze at
floor on a cold start (unfixed). History + two dropped compile-cliff
attempts + three missing-cancel-pulse bugs fixed along the way:
`[[memory: control-surface-quantization-history]]`. Fuzzed in
`tools/loop-quantization-sim/` (16000+ trials); not hardware-verified.

First (master-establishing) recording's tempo/beats comes from a real
synced Link tempo when present — `recorded_beats` snapped to the
nearest power-of-2 in {1,2,4,8,16,32,64,128} (`snapBeatsToPow2`, fixed
from a raw `round()` that could pick any integer, breaking the
power-of-2-ratio invariant against a Link-established master), real
`recorded_bpm` directly when `link->audioRead().synced && bpm>1.0` at
FINISH; `deriveTempoQuant` is fallback-only (already power-of-2-only).
Real APC Key25 re-sends note-on for an already-held pad
— `onPadPress`/`m_looperHeld` treats a repeat as no-op. Guitar-fx held
REDIRECTS looper pad presses to `onSidechainLooperToggle` (one-shot,
not ARM/FINISH) while `m_guitarFxHeld`.

## LofiFx/granulator button — SHIFT disambiguates the two gestures (note 69)

Both fire on PRESS: plain tap toggles `m_granulatorLatched`; SHIFT+tap
toggles Resonode engage (always wins, forces granulator off; disengage
releases every held voice). Every press switches active knob bank to
LofiFx, reverting on release only if Resonode not engaged.
Resonode-engaged keybed drives 4 voices via `Lv2Host::setControl` to
`fx/resonodevoice{v}/{note,gate,vel}` (skipped when disengaged, unlike
`multitranspose.dsp`'s 6 always-on voices). LED: blinking red=Resonode,
solid green=granulator. `m_lofiShiftMode`: plain=granulator page,
SHIFT=Resonode page.

## Granulator (`src/dsp/sampler/sampler.h`) — 4 named patches + 3 direct dials

C++ (not Faust): 7 params (`grainMs`/`grainRateHz`/`pitchSprayCents`/
`posJitterMs`/`scanRate`/`reverseProb`/`envShape`), `MAX_GRAINS=48`
shared across 16 voices; `scanRate=0` freezes, negative
`rate`/`reverseProb` reverses, `envShape` morphs
Blackman→Hann→percussive. Direct dials (knobs 5-7) override the
patch-blended field once touched: Scan/Freeze, Density, Pitch Scatter.
Grain pool budgeted PER VOICE, never exhaustible; gain compensation
tracks the budgeted spawn period (flat ±0.5dB across voice count).
Pitch quantizes to musical intervals (Octaves/Fifths/Minor
Triad/Pentatonic, beside continuous spray) at zero CPU. `[[memory:
granulator-investigation-history]]`.

## Three-page × regular/shift × 8-knob control surface

Every FX page (Dub, Guitar, LofiFx) has two independently-latching
8-knob banks via `ApcGrid::onFxKnobCC` on `m_activeBank`/`m_shift`.
`kFxKnobCcNumbers={48,49,50,51,54,55,57,53}` (CC53 double-duties as
Formant on Dub only):

| Page | Regular (knobs 1-7) | Shift |
|---|---|---|
| Dub | `fx/reverb,delay,time,hp,lpres,lp,pitch`, CC53=Formant | dance-gate+LFO: `fx/dubgate/*`, `fx/dublfo/*`, tempo-synced via `fx/dubgate/clockphase` off the shared 4-beat clock |
| Guitar | `fx2/{FLANGEAMT,TREMOLOAMT,BANKSPEED,PHASERAMT,DISTAMT,VINYLAMT,FLUTTERAMT}` (shared `BANKSPEED` LFO), CC53=`fx2/GATEAMT` | 8-dial dual-ADSR to C++ `Sampler` directly, no Faust/LV2 targets |
| LofiFx | knob0 `fx2/BITCRUSHAMT`, knobs1-4 patch weights | knobs5-7 direct dials |

`compressor.dsp` stays unreferenced (`ab_fm_def.py`'s fast-math test
uses it); `samplerate.dsp`/`mixbus.dsp`/`gateStage`'s multi-pattern
select removed as dead; `chain.dsp` is NOT dead (`home-fx-lv2` builds
it as a packaging check). Groove shuffle: notes 15/23/31/39 double as
shuffle buttons, `fx/shuffle/mask` (4-bit) — true retrigger/reorder,
block-boundary only, own `shuffleClockSamples` atop the real
`masterPhaseSamples+i` ramp; `kShiftReorderTables[mask]` (15 distinct
sequences) eliminates double-tap. `dsp/loop.dsp` varispeed has NO
deadzone (`varispeedActive=effSpeed!=1.0` exact); `resyncCoeff` gates
to `0.0` when `|effSpeed-1.0|>0.3`; both varispeed's instant jump and
beat-shuffle's hard clip are INTENTIONAL. `microrepeat.dsp`'s
`sliceBlocks=max(1,int(beatBlocks/divSafe))*2`, `divSafe=max(1,DIV)`
(never halves the divisor first). CC53 formant: deadzone 60-68,
`((data2-64)/63.0)*1.5` — SHIFT never changes a knob's own behavior.

---

# Storage: continuous USB-drive ring recording

`src/storage/usb_recorder.{h,cpp}`. `src/usb/f_uac2-gadget.sh` is a
different USB role (peripheral/gadget vs. host mode on the USB-A ports
a flash drive plugs into).

**RT side**: `UsbRecorder` owns a fixed, heap-allocated `int16_t` ring
(5s); `audio_thread.cpp`'s worker calls `pushBlock(prevFiltOut.data(),
N)` every block, next to `g_sampler->captureBlock(...)` — same post-fx
tap point. Single-atomic-counter SPSC ring, never blocks/allocates — a
lagging consumer has `pushBlock` advance the read counter itself (drops
oldest samples, increments an overrun counter).

**Control side**: file I/O happens in `UsbRecorder::poll()`, called
from `main.cpp`'s 5 Hz control loop, not a dedicated pthread. Chunks
are fixed-size, cyclically `O_TRUNC`-reopened, bounding disk usage by
construction; mount detection is a `stat()` device-id comparison, not
`/proc/mounts` parsing. Config: `[storage]` in `config/aloop.conf` —
`usb_record`, `usb_mount_point` (default `/media/aloop-usb`),
`usb_chunk_minutes` (10), `usb_chunk_count` (6);
`effectiveChunkCount()` shrinks the ring for smaller drives.

**Automount**: `src/usb/usb-automount.sh` (mdev hotplug) +
`usb-automount-setup.sh` (local.d bootstrap, APPENDS to
`/etc/mdev.conf`, own coldplug pass since `local.d` runs AFTER `mdev
-s`'s sysinit scan). Mount attempts: no `-t` first, then explicit
`vfat`/`ext4`/`exfat`/`ntfs` — exFAT/NTFS tools almost certainly NOT in
the minimal Alpine RPi tarball. UNVERIFIED on real hardware.

---

# Faust Libraries reference

Documents the Faust standard DSP libraries only, not compiler flags
(see Faust DSP above; flags at
[faustdoc.grame.fr/manual/optimizing](https://faustdoc.grame.fr/manual/optimizing/)).
Prefer Markdown sources: [libs index](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/libs/index.md),
[standard functions](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/standardFunctions.md),
[overview](https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/doc/docs/organization.md).
HTML equivalents at [faustlibraries.grame.fr](https://faustlibraries.grame.fr/).
