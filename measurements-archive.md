# Measurement archive

Numeric evidence relocated verbatim from AGENTS.md. Each section is one bullet; the one-line rule for it stays in AGENTS.md with a pointer back here.

## Clean ingress (Focusrite loopback)

- A clean ingress now exists via the Focusrite loopback (ADR-029); the bare AIR 192 reads silent (`in` 0.0001). #4 hiss WITNESSED absent (silent input -> `out` 0.0001). `snd-pcm-oss` 8000 Hz U8 no resampling (~150 xruns/s at 48k; 8k stalls aloop); `snd-aloop` jiffies-paced + TEARS -> ANY click/tear witness through it INVALID (17 glitches vs host 0; drift ±15 > effect); `period_size=64`+HZ=250 -> xruns 125/s, tears 0.25-7/s, only timer `G0` (4000 µs), unfixable.

## aarch64 vs host

- aarch64 vs host: characterization-identical, NOT bit-identical. 9 cells EXACT: vocal_female_vibrato 0/11/46, piano_mid_C4 1/4/5, marimba_mid_C5B5 2/5/4 at +0/+12/+24; sums -24/-12/0/+12/+19/+24 -> Pi 3/9/19/209/142/199 vs host 4/9/19/212/144/200 (±2). Codegen PINNED: CI compiles committed `dsp_generated.cpp`; `--solad` returns at `dsp_cli.cpp:1097`, before `AloopEffectDsp` at 1100 -> codegen link-only.

## Faust codegen cliff

- Faust codegen cliff: a NEW UI primitive in `resonode_synth.dsp`/`pitchtracker_ac.dsp`/`multitranspose.dsp`/`dsp/loop.dsp` risks unbounded compile; new controls go in `effects_runtime.dsp`. Measured: `pitchtracker_ac.dsp` arm 10.2-10.8 s, demote 12.6, promote 16.1, both >120 s rc=142; `ubuntu-24.04-arm` 53.3 s base: fixed-lag +8/+32/+148, +1 var-lag `@` 70.2 s, +4 120.1 s rc=142. Cost tracks what FEEDS an index, not tap count (13 rwtable taps 0.0 s). Read lag taps from a 4096-deep `rwtable` with a modulo-bounded counter, never variable-lag `@` or a float accumulator (not integer-exact past 2^24).

## Per-block fprintf

- NEVER per-block `fprintf` on the audio path: `[diag-pitchguard]` ~500 lines/s -> 475 MB `/var/log/aloop.log`; `[diag-gap]` 503 MB at 18.75 KB/s, loadavg 6.18, root tmpfs 547 MB/1.9 G. Rate tracks live audio -> silence reads +0 lines, hiding it.

## Two-device sync acceptance

- TWO-DEVICE LINK SYNC UP: `verify-two-device-sync.js <pi-ip> 600000` PASS at 118.500 bpm (peer retained 100%, 0 rejoins, 0 gaps, bpm spread 0.000, max |phase_err_beats| 0.0010, xruns 0). FAIL thresholds: peer <95% post-acquisition, bpm spread >0.05, |phase_err_beats| >0.03, eff_speed spread >0.005, gaps >10%.
- Joint runs with the esp-idf-link session (ESP32 D1 R32 as STA on `ticker`, 192.168.4.10, gw 192.168.4.1). Post-acquisition means t > +60 s from a cold boot, because opening the ESP's USB console resets the board, so ~43 s of boot-and-acquire is not a link failure. Window 07:20:52Z-07:30:52Z: 600 samples, retention 100%, bpm spread 0.0000, max |phase_err_beats| 0.0000, eff_speed spread 0.00000, zero drops; my independent 488-sample capture of the same window agreed on every term. Window 07:35:28Z-08:06:08Z: 1798 samples, retention 99.7%, one drop at 08:01:29Z recovering in 5387 ms - operator-induced, my tracker lane running `rc-service aloop restart` to install commit `dfd4871a80`. The ESP's `peerloss:` line at that transition read flag=1 ap=0 ap_sta=0 ip=192.168.4.10 rssi=-33 chan=6 igmp(ok=53 fail=0), so Wi-Fi and IP were healthy and only the Link session died.
- ~1% ICMP loss on the mesh is NOT a fault. Pi (192.168.4.1) to ESP (192.168.4.10) at 1 Hz: 17 losses of 1765 in one window, 5 of 563 in another, while Link retention stayed 100% and peers stayed 1. The Link session rides through brief loss, so the bar for "IP path down" is far worse than a few missed pings.
- Discriminator for any future peer drop: run ICMP and a poll from the Pi together (historical dated record: the ESP status responder was on 20812 then; its successor port is 20813, see AGENTS.md). A datagram of 1-64 bytes to 192.168.4.10:20812 (historical, now :20813) gets a JSON reply (link, peers, bpm, beat, phase, quantum, metro) and cannot perturb Link; its only side effect is holding the ESP's LCLK at 50 Hz and TTMP at 10 Hz for 15 s. ICMP alive with peers:0 means session state died on a healthy IP path; both dead means the IP path. In a frozen window the ESP beat counter was monotonic (0 decreases over 388 samples), which is how an unexplained ESP reboot would appear.
- **Failover is CERTIFIED** on ESP image compile 2026-10-23T13:28:17 (commit `4806b18729`) with aloop `0967bb7c`. One 100 s removal of `ticker`: my side showed hostapd 1 -> 0 -> 1, ssid ticker -> empty -> ticker, type AP -> managed -> AP, stations 1 -> 0 -> 1 at 13:38:11Z and still 1 at 13:38:52Z, telemetry peers=1 synced=true bpm=120 from 13:38:54Z. ESP log: peerloss flag=1 with IP and IGMP clean, `STA down past 30 tries -- re-hosting` at 13:37:17Z with AP and DHCP on 192.168.4.1, `Lost dual-host tie-break (lower BSSID seen)` at 13:37:59Z, `Link peer back after 113678 ms` at 13:38:07Z. Counts: `relay did not stop` = 0, `deferring the yield` = 0, `Guru Meditation` = 0, `SW_CPU_RESET` = 0. About 114 s end-to-end from peer loss through re-host, yield and rejoin.
- Do NOT read the earlier failover attempts as three failures: two failures were on the pre-fix images (12:37:12 and 12:56:37, the second with the panic), one run at 13:29:00Z is DISCARDED because the board was still on 12:56:37 and it tested nothing new, and the single run on the fixed image passed. Also: `LWIP_NETIF_LOOPBACK` is off by default in ESP-IDF, so a wake-up datagram to 127.0.0.1 cannot work - that invalidated the first wake attempt. Attribution rule for any future outage: name the fire second only after confirming the compile stamp on the board.
- LRST, the session-only bounce, is certified: three firings, each a peer absence of about 2-3 s, bpm 120 throughout, `beat_mark.beat` and `resample_chain.samples` strictly increasing so `counter_step_backs = 0` (a session bounce, not a restart). ESP-side `Link peer back after 4018 ms` on 54e3d17 against about 2540 ms on the older image.
- The Pi's clock is unset, about 926 days behind the host. Pi-side logs carry Pi epoch: align with that offset, and set the clock only in a gap between windows with an aloop restart after, since a ~926-day step on a running PREEMPT_RT audio process would itself perturb a run.

## Soaks and route flap

- Soaks (25 min `df18c36`, 30 min post-`df18c36`): peers=1 every poll, `synced=true`, bpm 118.600, phase_err_beats 0, eff_speed 1.00000. Route flap: 1->0 in ~4 s, unrestored within 45 s or a restart, self-heals ~1 h. ENOMEM at t=218.9 s UNREPRODUCED (pre-fix `0a8760c`: fail=1501 giveup=396 errno=12).

## Link phase trim

- Phase trim applies to `masterPhaseSamples` ONLY (`kLinkPhaseTrimPerSample=0.00005`, clamp `kLinkPhaseTrimMax=0.03`, ZEROED unless `linkVarispeedEngaged && !manualPunchActive`). `masterPhaseBuf` ramps per-sample (never `std::fill()`) at `masterPhaseSlope=linkSpeedRatio+linkPhaseTrim`; `effSpeed = g_manualSpeedMul*linkSpeedRatio` carries TEMPO alone; `masterPhaseSamples` advances at `linkSpeedRatio` ALONE; `resyncCoeff` closes ~42 ms. Tempo must hold `kTempoStableBlocksThreshold = sr/N` blocks.

## Link tempo authority

- `setTempo` rewrites EVERY peer; `imposeTempo(bpm)` unconditioned, only writer of `weOwnTempo`; never gate `linkSpeedRatio` on it. Match tempo by read RATE (`linkSpeedRatio=linkBpm/recordedBpm` > `effSpeed`); `imposeTempo()` republishes in the same call or the finish edge doubles the take. Latches `g_ownedBpm`, re-imposed by `controlTick()` after `kPeerSettleTicks=2` (~400 ms) on join/leave; else a joiner merges its own 120.000 session and `eff_speed` settles 1.0067. `resetTempoAuthority()` clears it.

## Two quantums

- Two quantums: 16 transport (PAIRED: transport anchor, `beatNow()`, 24-PPQN clock), 128 phase CAPTURE (`controlTick()` at `kLinkPhaseQuantumBeats=128.0`; consumers fold `(quantumMicroBeats/1e6)`, never `16.0`). Phase is ABSOLUTE-beat (`phaseAtTime(t,q) == beatAtTime(t) mod q`): folding a 128-beat capture at `rb` is WRONG unless `rb|128`. Capture at loop quantum (`setLoopPhaseQuantumBeats(cmd/recorded_beats)` > `loopPhaseMicroBeats`); fall back to 128 only when absent or != recorded beats.

## Anchors before timeline re-base

- Any anchor taken BEFORE a timeline re-base (`forceBeatAtTime`; creation `audio_thread.cpp:866`, join `:915`) is off by `(-dBeat) mod rb`: invisible for `rb in {1,2,4,8,16}` at `dBeat=-16`, a whole beat off otherwise, ±0.03 trim over ~16 s to recover. FIXED+DEPLOYED `d316e22`: `rebaseSeq` (`link_bridge.cpp`, bumped per applied `forceBeatAtTime`) + `resnapAfterRebasePending` force ONE resnap past the idle-only gate.

## Resnap witness rb=3

- `.gm/resnap-rb3.js 900000`, `recorded_beats=3` (`128 mod 3 = 2` -> a mis-fold reads ~2 beats): shipped `d316e22` max 0.0010 mean 0.0002 (n=483) vs pre-resnap `aloop.fixed` max 0.9880 mean 0.1473 (n=569). Judge the NEXT 1.5 s after the impose (both <=0.011 at first); needs 0->1 WHILE audible (2 of 4 windows caught none). Restore only from CI md5 `e624728ac1aa50ecfad4db4a1b0d3087`.

## Sim mirrors device Link

- Sim mirrors device Link (fixed `75d8b4a`, 17/17 PASS: `requestPhaseImpose` off-thread + `rebaseSeq` bump; pre-500 ms ~1.4 beats by design). Fold coverage `loop-quantum-fold.js` (rb 3/6/30): ~0.48 16-quantum residual is rb-INDEPENDENT trim-chase, not fold error.

## diag-gap limiter

- `[diag-gap]`: 1 s `diagGapAllow()` limiter (was 503 MB at 18.75 KB/s); FIXED + WITNESSED gap_lines=1, fatals=0. `kExpectedPeriodMs` = 1.333 ms, threshold 1.5x = 2.0 ms. Device 113/569 hits at 2.0-3.0 ms, xruns=0, worst 4.4 ms vs 5.33 ms -> no underrun; USB iso jitter (`xhci_hcd` IRQ 29 pinned CPU0).

## Per-partial decay and impact

- Per-partial `modeDecayScale(i)`/`modeAmpBase(i)` (blended like `modeRatio(i)`) give each material its own decay+gain curve. `highFreqDampExponent` stays `1.0*(1-damping)`, NOT `1.934264*(-log(damping))/log(2)` (8.35 collapsed Dance Bass to one partial). `impactSig` (0.6-14 ms by `hardness`) sits OUTSIDE `excEnv`, scaled by `(1-inputAmt)` so `input=1` stays bit-exact.

## collisionDrive normalisation

- `collisionDrive` normalises by `1/driveAmt`, never `1/tanh(driveAmt)` (a +17 dB make-up gain at collision=1, why patches differed ~13 dB). Scaled by `drivePreGain = outLevel*decayLoudnessNorm` and divided back out: the pre-gain signal is ~25x smaller and tanh there is linear. Collision is a compressor: raising it LOWERS peak, crest and first-diff RMS; `verify_musical_controls.py`'s collision=0 identity check strips `collisionDrive(` by paren matching, not a literal signature.

## Waveguide Object stage

- Each voice drives a waveguide Object stage (tuned feedback comb; `body` mix, `polarity` sign, `g = 0.001^(1/(T60*f0))`, peak normalised by `1-g`, 25 Hz highpass kills DC). Positive polarity is bassier (0.8194 vs 0.7996 low-band, note 36).

## Netbooted address and dsp shippability

- The netbooted client's address drifts: the firmware-stage lease was 192.168.137.132 while `cmdline.txt` pins .100, and .100 answered nothing. `/var/lib/misc/dnsmasq.leases` is the authority, not the pinned address. SSH is root/aloop; no `ssh2` in this checkout, so use `SSH_ASKPASS` + `setsid ssh`. A `.dsp` edit is NOT shippable from this host: `build-binary.yml` regenerates only `aloop_pre`/`aloop_post`, `dsp_generated.cpp` is committed and compiled as-is, the pinned faust is 2.85.9 and this host has 2.81.10, which also hits faust's own 120 s SIGALRM (exit 142) on `pitchtracker_ac.dsp`. So the multitranspose-side lead (`lastConvergedNote` carrying the previous note's decision across a note-on, seeded from `targetNote` only at `ba.time == 0`) is UNTESTED, not disproven.

## Upward-shift fold-back refuted

- Upward-shift clicks are NOT fold-back aliasing. `tools/upshift-fold-map/fold_map.py` measured it: over 16 sources x 5 shifts, Pearson r(glitches, out-of-band energy above fs/(2s)) is -0.04 pooled, and every per-column r is negative. It fails both ways: `marimba_low_C2B2` has the least out-of-band energy in the corpus and glitches at every setting; `violin_high_sulE_C7E7` has the most and sits mid-pack. Two facts settle it regardless of r: 7 of 16 sources glitch at +0 where s=1 so folding is impossible by construction, and the count is not monotone in stride (clarinet 35/13/7/2, trumpet_high 30/4/3/2). What the count does track is `peakStep` (r up to +0.45): splice step size, i.e. source transient content and splice placement. Treat "fold-back" as a retired explanation. Both old fixes stay REJECTED: stride-adaptive kernel (+24 32>27); write-side anti-alias (~3 smp at `s=4`, FORBIDDEN).

## Tremolo/AM subharmonic lock

- Tremolo/AM subharmonic lock is NOT an anti-jitter clamp: a bad lock lands on the FIRST completed detection. YIN-style cumulative-mean normalized difference (`kDiffAccept` 0.15/`kDiffStrict` 0.05/`kDiffFallback` 0.50) + parabolic refinement `(c-a)/(2(2b-a-c))`; AM grid (`--am-probe grid=1`, 108 cases): worst 3371.9>425.7 c, mean-of-means 227.44>6.18.

## 8df2e2c above 1000 Hz

- `SnacPeriodTracker` above 1000 Hz: FIXED `8df2e2c`. `MIN_PERIOD` 48 -> 16 (was the only way to see a 45.9-sample period) plus a stricter CMNDF accept below lag 48 (`kDiffAccept` 0.15 instead of `kDiffFallback` 0.50) so the shorter floor cannot read an octave UP. Measured `--trk` mean cents: trumpet_high_C6 1192.3 -> 3.8, flute_high_C7 1900.2 -> 390.4, clarinet 1634.4 -> 745.3, and 1046.5/1318.5/1568/2093 all land within a few cents. Frames within +-60 c of the true note: trumpet_high_C6 and violin_high 0.0 -> 100%, clarinet 0.0 -> 78.3%, piano_high_C7 0.0 -> 20.6%. The 9 EXACT glitch cells are unchanged (0/21/52, 1/3/2, 4/5/5 on the post-`d271dd0` tree; 0/18/47, 1/3/1, 4/6/5 while `fd0e3f04` was present). Low/mid MEDIAN periods are identical; two files move on the frames-within-+-60 c count: oboe_mid_C5B5 96.7 -> 91.9 and marimba_mid_C5B5 98.8 -> 96.0, and oboe's octave-flip rate is the one that moves, 3.3% -> 8.1%. Oboe octave-UP stays 0.0%, which is the point of the gate: bare 16 put 13.7% of its frames an octave UP. Cost, measured over the 34-file corpus: +56 glitches total (1089 -> 1145), concentrated entirely in the 18 high-register/AM/inharmonic files added in `50cdfef5` where the tracker now attempts detection it used to clamp. Do NOT lower `MIN_PERIOD` without the short-lag gate: bare 16/24/12 measured 455/464/464 against 418 on the old corpus. Above 1000 Hz prefer `--pitch` for a quick read, never `--trk`, only because `--trk` needs a known `hz=`.

## Pitch-lock witness and void figures

- Pitch-lock live witness: `tools/loopback-witness/loopback-witness.js --lock <hz|wav> <midiNote> [secs]` plays out of host ch6, injects the keybed note on ch1 at +500 ms (`0x91`, `apc_grid.cpp:786-793` sets `fx/xposeN/note`), captures host ch1 and reports measured f0, cents vs the MIDI note and the 100 ms f0 trajectory for the first 2 s. `shiftTarget = targetNote - heldDetNote` (`effects/home/faust/multitranspose.dsp:88`) means a detection octave error becomes an output octave error one-for-one. ALWAYS `rc-service aloop restart` between lock cases: run back-to-back they contaminate each other (440/45 read -1204.5 cents unrestarted, -6.5 restarted). The figures recorded here earlier (220/45 +1201.4 -> -2.5, 440/45 +2401.4 -> -6.5, 440/57 -> -1202.5, piano C4/45 +1495.0 -> -6.5, piano C4/60 6 -> 10 jumps and 3/21 -> 7/21) were measured with an `estimateF0At` that returned the smallest-NSD lag: on a periodic tone the NSD at 2T/3T/4T is also ~0, so a correct sustained output read at 1/2, 1/3 or 1/4 of the target at random and was scored as an octave error. It now returns the smallest lag that is a LOCAL MINIMUM within 0.02 NSD of the best (verified exact on synthetic 55/110/262 Hz tones with and without harmonics), so those figures are void. Re-measured A/B, `a9509f8f` (bf09be8b) vs `fe3583bd`, restart between every case: 220/45 -2.5 -> -2.5, 440/45 -6.5 -> -2.5, both 0 jumps and 0/21; piano C4/57 three reps hops-octave-off 3,2,3 -> 1,1,3 with real octave excursions 3 -> 0; piano C4/45 two reps 8,7 -> 6,1; piano C4/60 two reps 2,3 -> 2,4. Real octave excursions summed over the 7 paired piano runs: 7 -> 2.

## Pitch-lock lead-in

- Pitch-lock residual is the LEAD-IN, not an octave error: `piano_mid_C4.wav` has a silent ~500 ms pre-roll (rms 6e-4) and its note attack lands exactly where the witness injects the note at +500 ms, and the AC tracker's `energyReady` floor (`env > 1e-6`) keeps it unready through the pre-roll, so no pitch is published until ~35 ms after the attack and the harmony is unpitched for the first 100-300 ms. Most remaining "an octave off" hops are that unpitched lead-in read as the 2000 Hz `minLag` floor.

## extFreqGuardAnchor corroboration

- The `extFreqGuardAnchor` corroboration, at `audio_thread.cpp:1239`: a move past `kJumpMaxRatio` needs 60 blocks (80 ms) of the tracker holding ONE candidate, 120 blocks (160 ms) when it sits within 5 percent of an exact octave, and a reading at the tracker's 60 Hz floor is never latched. The old rule accepted any non-octave jump after 9 blocks (12 ms) and then chased it at 15 percent per block, so a 2x or 3x reading carried the anchor the whole way within ~30 ms. Two variants were REJECTED by measurement: holding the anchor while the tracker reports no pitch makes a wrong value STICKY (piano C4/57 gained 1-2 octave-down excursions per run, because the drop-out that used to clear it no longer does), and `kFreshOnsetConfirmBlocks` 3 -> 30 only bought a longer unpitched lead-in at every note. The tracker already gates its own onset (35 ms hold + a 512-sample stability run), so 4 ms of agreement is not the onset problem.

- The fresh-onset latch (`audio_thread.cpp:1281-1299` in `31173d61`) was the hole: the guard compares a candidate only against `extFreqGuardAnchor`, which the silence reset has just zeroed, so a candidate was adopted after 3 blocks (4 ms) with no octave test at all. On `marimba_mid_C5B5` the tracker's onset reading is the AC subharmonic (device trace, pre-fix: `raw=586.55 anchor=294.18`), the anchor took it in 4 ms, and the true value was then held off for 120 blocks by the octave rule - which never completed because the tracker reports no pitch for most of the take (13 non-zero trace samples in a whole run; the archived trace records `zero_raw=30` of 32 s). Fixed by remembering the pre-silence value (`extFreqGuardPrevAnchor`) and requiring the 120-block count for a fresh-onset candidate more than half an octave from it. Post-fix trace: `raw=560.09 anchor=558.63`, `raw=528.46 anchor=528.46`, `raw=529.65 anchor=528.35` - anchor == raw on every non-zero sample.
- That count is destroyed on every no-pitch block (`audio_thread.cpp:1261-1262`), so it re-arms per onset: a 20-note octave-jumping figure paid 3017 ms of adoption delay (26% of an 11.6 s passage), growing linearly with the note count (10 notes 1431 ms, 40 notes 6191 ms, 80 notes 12537 ms). An already-corroborated pitch is now held in an 8-slot known-pitch ring (`kKnownPitchSlots`, filled by `rememberPitch` on every adoption) and is exempt, so the cost is once per distinct pitch: the same passage pays 209 ms, and 80 notes pay 369 ms. Worst single delay is 158.7 ms either way. A passage cycling more than 8 distinct octave-separated pitches evicts from the ring and re-pays one acquisition each time an evicted pitch returns - the stated ring limit, not a defect. (numbers: `.gm/witness/anchor-guard-stacking.txt`)
- Device witness, three consecutive 6 s lock runs of `marimba_mid_C5B5 -> 72` over the Focusrite loop: 548.43 / 548.21 / 545.96 Hz, octaves off 0 (before: 1095.44 Hz, +1279.1 c, octaves off 1). That is -32.9 / -33.6 / -40.7 c against the file's measured 558.94 Hz peak and +81.4 / +80.7 / +73.6 c against the 523.25 filename label, which sits 116 c below the measured peak. Six-file A/B (BASE `9917831613` = `dfd4871a80` vs FIX `0967bb7c`): sax C6 +2.4 -> +2.3 c, clarinet C6B6 +2.5 -> +2.5 c, trumpet C6 +3.8 -> +0.6 c, cello A2 +0.1 -> +0.2 c, trumpet A3 -6.6 -> -6.8 c, marimba C2B2 -41.8 -> -41.0 / +3.2 c; octaves off 0 o

## Peer-present ALSA roundtrip and derived end-to-end, 2026-11-06 (archive#peer-present-alsa-rise)

Window 4a: read-only, no deploy, no restart, no flash. Pre-registration 8ac272b2 + 50d781d8; raw .gm/witness-out/window4a-peer-present-latency-20261106.txt and .jsonl; verdict .gm/witness-out/window4a-end-to-end-verdict-20261106.txt. Device build 6abaacee, link.synced=true peers=1 in all 29 samples, xruns flat at 1, phase_err ~0.

- esp AFTER series (15 s spacing, /config/workspace/esp-idf-link/.gm/witness-out/window3-adr034-witness-20261106.txt): t+00s peers=0 bias 185.4 rt 121.4; t+15s peers=1 bias 237.3 rt 173.3; t+30s 237.4/173.4; t+45s 237.1/173.1. Both bias and rt rose +51.9 samples = 1.081 ms at peer re-acquisition and stayed elevated to t+45s.
- Window 4a 1 Hz medians: BEFORE bias 237.6 rt 173.6 idleMs 4.950 derived engaged 364.6 smp / 7.596 ms (over7ms 12/12); DURING 238.6 / 174.6 / 4.971 / 365.6 / 7.617 (5/5); AFTER 238.1 / 174.1 / 4.960 / 365.1 / 7.606 (12/12). 29/29 samples over 7 ms on the derived engaged figure; peerViolations 0.
- Pre-deploy peer-present LOW baselines: window 2 BEFORE 196.7/132.7; window 3 BEFORE 190.3/126.3; window 3 AFTER peers=0 184.7/120.7. Restart + peer re-acquisition happened twice (after window 2 and after window 3); only the second elevated the roundtrip.
- Identity: bias = N 64 + alsa_roundtrip_samples + trim 0 (src/dsp/audio_thread.cpp:1503); rt is a 4 s average of capDelay + playDelay from snd_pcm_delay (:648, :1472, :1485-1495), never a fast EMA. The rise is entirely in rt.
- Derived engaged = bias + 127 samples (engaged free-transpose stage above); 7 ms = 336 samples. Using low baseline 190.3: 317.3 smp / 6.610 ms -> 364.6 smp / 7.596 ms, delta 47.3 smp / 0.985 ms. Using esp t+00 185.4 -> t+15 237.3: 51.9 smp / 1.081 ms. Both baselines stated. This is a DERIVED figure from live telemetry plus a shipped constant, NOT a live USB loopback capture; no live round-trip is claimed.
- Parent pre-registered ALSA investigation: prereg 02c64a78a0beecc9a3bd55d94789a239edae7f30, verdict 25f46b9278e21e40273ea904569198a435917799. H1 exact ALSA period/buffer quantum REFUTED (0.8109 periods, 0.4055 buffers); H2 direct Link phase-trim -> snd_pcm_delay path REFUTED; H3 restart/ALSA state effect SUPPORTED; H4 additive to derived engaged SUPPORTED. Conclusive proof needs a device restart control: NOT_MEASURABLE_OFFLINE, not executed.
- Pre-registered source diff 71adb371 -> 69e47f66: 77bd050c..6abaacee is telemetry-only (src/dsp/audio_thread.cpp:920 and :949; requestPhaseImpose :916 byte-identical), so REVERT_TO_77bd050c_CANNOT_CLEAR_ON_SOURCE_EVIDENCE; the fold patch is present in both shas.
- AGENTS.md exempts engaged wet-effect latency; the non-exempt idle bias is 4.950..4.971 ms, under 7 ms. The ~7 ms invariant call belongs to the owner. All device work is frozen; no revert, no flash, no restart since window 4a.
