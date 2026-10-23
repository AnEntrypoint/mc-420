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
- Discriminator for any future peer drop: run ICMP and a 20812 poll from the Pi together. A datagram of 1-64 bytes to 192.168.4.10:20812 gets a JSON reply (link, peers, bpm, beat, phase, quantum, metro) and cannot perturb Link; its only side effect is holding the ESP's LCLK at 50 Hz and TTMP at 10 Hz for 15 s. ICMP alive with peers:0 means session state died on a healthy IP path; both dead means the IP path. In a frozen window the ESP beat counter was monotonic (0 decreases over 388 samples), which is how an unexplained ESP reboot would appear.
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
- Device witness, three consecutive 6 s lock runs of `marimba_mid_C5B5 -> 72` over the Focusrite loop: 548.43 / 548.21 / 545.96 Hz, octaves off 0 (before: 1095.44 Hz, +1279.1 c, octaves off 1). That is -32.9 / -33.6 / -40.7 c against the file's measured 558.94 Hz peak and +81.4 / +80.7 / +73.6 c against the 523.25 filename label, which sits 116 c below the measured peak. Six-file A/B (BASE `9917831613` = `dfd4871a80` vs FIX `0967bb7c`): sax C6 +2.4 -> +2.3 c, clarinet C6B6 +2.5 -> +2.5 c, trumpet C6 +3.8 -> +0.6 c, cello A2 +0.1 -> +0.2 c, trumpet A3 -6.6 -> -6.8 c, marimba C2B2 -41.8 -> -41.0 / +3.2 c; octaves off 0 on all twelve. (numbers: `.gm/witness/anchor-marimba-c5-20261023T1114Z.txt`)

## Free-transpose pitch independent of tracker

- Free-transpose pitch does NOT depend on the tracked period: `semis` sets the ratio outright, so a tracker octave error corrupts splice alignment, not the output pitch. Proven by a synthetic sweep 55 Hz to 2637 Hz at +12: `achievedSemis` +12.00 +/- 0.03, worst 8 c. An octave JUMP in the audible output can therefore only come from the pitch-LOCK path (`shiftTarget = targetNote - heldDetNote`), never from the free-transpose knob - chase octave complaints there.

## extfreqdet written, four estimates

- `fx/extfreqdet` is now written (`bf09be8b`, `audio_thread.cpp` publishes `extFreqGuardAnchor`, clamped to 1500); the corroboration rule it applies is in the pitch-lock bullet above. Before that it was resolved and never written, so `multitranspose.dsp:141-143` always took its internal branch and the harmony lock ran off the ZERO-CROSSING-RATE estimator `trackPitchHzAndHp` (`multitranspose.dsp:33-44`) while the real AC tracker (`pitchtracker.lv2`, loaded on core 1) was computed, octave-guarded and discarded. Four independent pitch estimates exist (mono SNAC, poly SNAC, LV2 AC, ZCR); the mux at `multitranspose.dsp:141` is the place they can disagree.

## Measurement gates the claim

- Measurement gates the claim, and a small corpus lies. A period-hysteresis gate in `soladSnacOctaver.h` measured 436 -> 418 glitches on the old 16-file corpus and was shipped as `fd0e3f04`; on the 34-file corpus it is 1089 -> 1094 with 25 cells worse against 15 better, and no retune beat it. Reverted as `d271dd0`. Measure on the full corpus before believing a delta.

## AC-tracker timbre shift

- AC-tracker timbre shift (2nd harmonic overtaking f0) is OCTAVE FLICKER, not a lasting swap: coarse pick flip-flops f0/2f0 ~300 ms while `demoteNow` ramps, `confident` stays 1 -> `holdLastGood` never masks it. Fix = `takeNew` also requires `stableRun >= confirmSamples` (512), counting samples where `coarseFreq` moved <6%; worst window 278 c > 4.4 c. Counter MUST read `coarseFreq`, never `refinedNow` (drags the refine tree into `~` recursion).

## SUSTAINGATE and snapGate

- SUSTAINGATE is at the END of the master chain, so master and record are the SAME process: `effects_runtime_pre.dsp:39` is `masterIn = preFilterOut` (no SUSTAINGATE; the hslider moved to `effects_runtime_post.dsp`), which has `audienceGate = SUSTAINGATE : si.smoo : snapGate` and `inputFxOut = (masterWet : dubGateLfoStage)*audienceGate + loopHarmonyWet`. `snapGate` is REQUIRED: float32 `si.smoo` never settles (error amplified 1/(1-0.999)=1000, bounded 9e-5), so bare `si.smoo` left master 2.8e-5 off -> `inputfx_vs_cue`/`record_vs_inputfx` residuals -91 dB, failing the le -120 dB parity rows. Snap thresholds have ~11x margin. Record = `preFilterOut -> delayVerbFxCue -> dubGateLfoStage + loopHarmonyWet`; master = the same through `delayVerbFxMaster * audienceGate`: identical but for the gate. `loopHarmonyWet` is harmonized LOOP audio (`multitranspose.dsp` 2nd out), not harmonized input, so reaching master while the dry record path is muted is NOT a leak. `si.smoo` is a ~21 ms fade, not a hard cut, so chopping a reverb tail does not click. Mixer/passthrough channels are UNGATED: `mixOnlyBuf` (`:1118`) sums into `masterSample`/`cueSample` (`:1343`/`:1344`) OUTSIDE every gate and never enters `fin` -> never reaches `recordTap`. Cue (`filtOut`) carries the record path unconditionally, so shift+sustain is the master/audience gate only. `audio_peak.out` IS cue; `audio_peak.master` IS the gated audience bus.

## ARM anchor

- ARM anchors a take at the master phase it was armed at, NOT a grid node: `rsmNext = ba.if(armEdge, masterPhase, rsmPrev)` (`dsp/loop.dsp:31`); `kFineGridBeats`/`rsmNearestNode` gone (nearest-node anchoring displaced takes ~31 ms). `verify-arm-lineup.js 192.168.137.100 2000 20000 6` (`readpos` vs `master_phase_beats*beatLen`, one reply, despiked, tol 16): off MATERIAL before max 1242.7 mean 783.3 -> after max 3.4 mean 2.7 (stalled floor max 29.1 mean 18.3); off GRID now max 1395.4 mean 1049.8 = INTENDED. Per-loop beat scale `s`: `1/ratioClamped` at `finishEdge`, `1.0` at `armEdge`; read-head rate `s*masterPhaseSlope` -> drift off grid IFF `s != 1`.

## FINISH length

- FINISH length near-cut/far-extend (`pickAnchorGridBeats`: 16/8/4/2/1/0.5/0.25/0.125), CAPPED at 1 phrase: `min(pickAnchorGridBeats(takeLenBeats), max(1, cmd/recorded_beats))`. Overshoot within `cutTolerance = anchor*kAnchorMidpointFrac` (`sqrt(2)-1`) cuts now, else next tier. After: 5.9290->8, 5.7804->8, 1.4233->2, 2.9710->4, 3.9841->4, 1.9921->2. Bounds 64 .. `kMaxLoopSamples` 48000*60. `snappedWrapLen = ceil(finishTakeLen/anchorGridLenNow)*anchorGridLenNow`, `anchorGridLenNow = max(1.0, min(anchorGridBeats*beatLenNow, masterLen))`. `cmd/master_len` fallback must run whenever Link is not the length driver: nested in `if (g_link)` it never ran with NULL Link.

## First take owns tempo

- First (master-establishing) take OWNS tempo: `master_len` stays the raw write index; `deriveTempoQuant(seconds, anchor)` picks the INTEGER beat count 1..128 log-closest to `anchor` in `anchor/2..anchor*2`; the master-establishing branch passes `120.0` LITERALLY, never inherited Link session tempo (session-tempo anchoring: 0.817 s at mesh 73.80 -> 1/73.41 vs 2/146.8). Power-of-2-only errs 1.414x; integer counts land ON ~120 (<=1.09x at >=5 beats): 3.015s->6/119.42, 6.016s->12/119.68. Link-driven length must not pin `looperLen`/`MLB`/`recorded_beats` over an existing take: an 8-beat take folds against a 4-beat grid. Measure grid against `master_len_samples / recorded_beats`, never rounded `link.bpm`.

## Live recorded-beats pin

- Only `MLB` of the 3 recorded-beats pins is live (`dsp/effects_runtime_pre.dsp:20`): `block_size=64` gives `sliceLen` 12544 vs 24960 -> micro-repeat an octave too fast; `looperN/len` + `RECORDEDBEATS` INERT (nothing declares `looperN/len`, `audio_thread.cpp:785`; `beatsSafe` stays 16).

## Varispeed ratio

- `cmd/halfspeed`/`cmd/doublespeed` are APC NOTES 70/71 ch0 (never cc70/cc71) > `g_manualSpeedMul` (0.5/1/2) > `effSpeed`; `loop.dsp` in9 `manualSpeed`, in10 `foldNow` (raw SHIFT `freeXpose`): `manualSafe = max(0.1, abs(manualSpeed))`, `ratioClamped = clamp(effSpeed/manualSafe, 0.1, 8.0)`. Beat lengths use `ratioClamped`, never `speedClamped`: else `finishtarget` stops matching `snappedWrapLen` and the take doubles. `eff_speed` holds 0.5000/2.0000 punched, returns to 1.0000; release returns to the UN-PUNCHED playhead (fixed `2995660`).

## Dry vs SHIFT-resample take punch

- Dry take (`foldNext == 0`) latches `v = manualSafe` at `finishEdge` (1.0 at `armEdge`): `vBaked = v != 1.0`, `speedForTake = v / manualSafe`. SHIFT-resample take (`foldNext == 1`, sticky from `armEdge`) has the punch IN the captured audio (fold tap post-varispeed), read at LIVE punch alone (`vNext` forced 1.0 at `finishEdge`, `vBaked` false); never divide it back out (neutral 440 Hz; `kRateDecim=64` removal flickered `resyncCoeff`).

## Passthrough hiss #4

- Passthrough hiss (#4) is UPSTREAM of `fin`: offline null test (`tools/chain-render/`, `chain-null-test.yml`; float32 floor ≈ -152 dB) nulls piano/marimba/vocal/cello at -151.9 dB, ZERO added delay, master + cue identical; `pitchStage` removal bit-exact; microrepeat/filters/guitar-lofi true bypass; bitcrush.dsp NO true bypass (-113 dB, inaudible). ONLY inharmonic residue: ENGAGED=1 + FORMANT>0. WITNESSED offline (CI `38119023175`, 29 cases / 0 fail; `parity.sh` `engage_*`, `step=ENGAGED:0.0:96000` + `start=192000`): engaged tail -9.75 dB vs never-engaged at lag -129; released tail EXACT on record/inputfx/cue.

## SNAC cap 900 below 60 Hz

commit 8ed5946 body, verbatim

pitch: SNAC tracker sees below 60 Hz, gated

MAX_PERIOD 800 caps f0 at 60 Hz at 48 kHz. piano_low_A1 is A1 at
55.69 Hz, true period 861.9, outside the range, so the tracker
never sees it: dsp_cli --trk reports mean 1116.1 cents, worst
1667.3, and the trace wanders 450-780 with peakTau often 16.

Ceiling raised to 900 (f0 53.3 Hz). A period of 862 leaves 162 of
the 1024-sample window, 1.19 periods; that is enough, the file
locks at 59.7 cents mean, 824.6 worst.

LAGS_PER_STEP goes 48 -> 53 in the same commit. The sweep advances
one step per 64-sample block and must still finish in 17 of them:
1+17*48 = 817 > 800 and 1+17*53 = 902 > 900, so detection lands on
the same sample as before. Without it the sweep takes 19 blocks,
every detection window shifts 128 samples, and 11 of 19 files move
for timing reasons alone, which hides what the range change does.
With it, 14 of 19 are identical.

The new lags are gated, mirroring SHORT_LAG_STRICT_PERIOD:
LONG_LAG_STRICT_PERIOD = 800 is the characterized ceiling, and
everything that sets a threshold from the curve (rPeak, the global
CMNDF minimum, the raw-correlation peak) is computed over that
range only. A lag at or above 800 is reachable only when that range
shows no periodicity at all (refMin > kDiffAccept) and only through
a CMNDF minimum below kDiffStrict, never through a raw correlation
peak. cello_low_sulC_A2 (112.01 Hz, 2x period 857, the one file
whose octave-down lands inside the new range) is byte-identical:
no octave-down adoption.

Bare 900 without the gates is a large regression: oboe_mid_C5B5
376.5 -> 1760.8, vibraphone_mid_C5B5 165.3 -> 1441.0,
soprano_sax_high_C6 2.8 -> 1233.7, violin_high_sulE_C7E7
126.3 -> 1799.7.

piano_low_A1 renders at normrms=0.21, cents vs measured input f0:
  ncc     0.3832 -> 0.5655 (+12), 0.2831 -> 0.5109 (+19),
          0.2766 -> 0.5136 (+24)
  splices 294 -> 192, 575 -> 374, 859 -> 564
  cents   -0.9 / -2.7 / -1.7, was +1.1 / -1.7 / -1.2

Honest counter-number: glitch count on this one file moves the
other way, 24 -> 27 at +12 and 27 -> 28 at +19, 31 -> 29 at +24.
Every hit on it is a 0.25-0.31 first difference after normrms=0.21
scales a peak-0.0757 source about 30x, clustered at t=0.48-0.70 s
in the base render too, so the count sits on the threshold and a
large coherence win moves it either way. violin_high_sulE_C7E7
reads 7 -> 10 and 10 -> 14 glitches the same way, deltas 0.25-0.32.

9 EXACT cells unchanged: vocal_female_vibrato 0/21/52,
piano_mid_C4 1/3/2, marimba_mid_C5B5 4/5/5.

Zero added latency: still 17 sweep blocks, no buffer, and the gate
is a comparison over the already-computed CMNDF curve. Cost is 900
lags per detection instead of 800, +12.5% SNAC work spread over
the same 17 blocks.

## Energy gate falling edge

- Device trace (`docs/witness/transient-sweep/hf/device_extfreq_marimba72.txt`, binary `9917831613b209c3fc26a5ada919b40c`, `diag_extfreq_trace=1` for this run only): marimba_mid_C5B5 held note 72, `seconds=32 zero_raw=30`, so published pitch was zero in 30 of 32 s. Sample lines: `t=6479.700 raw=526.87 anchor=527.17 zone=527.17`, `t=6481.701 raw=562.39 anchor=279.52 zone=279.52` (anchor at half the raw reading). Commit `9465b917`.
- Model (`docs/witness/transient-sweep/hf/energy_gate_model.txt`, 3 ms one-pole of x squared, 35 ms hold above env > 1e-6, Python reproduction). Ready fraction per second, 0 to 9 s: full level `0.70 0.58 0.53 0.80 0.16 0.19 0.67 0.18 0.42 0.54`; device return level `0.05 0.00 0.00 0.10 0.00 0.00 0.00 0.00 0.03 0.00`.
- Floor sweep at device return level (ready 0.5 to 6 s): floor 1e-6 2%, 1e-7 8%, 1e-8 14%; silence (rms 3e-5) 0% at every floor. A lower floor is not sufficient alone: the marimba tail falls below any floor quickly.
- Mechanism: `holdLastGood` `fallingEdge > 0.5 -> 0.0` (`fd1e0f2e`). A1 excerpt, `docs/witness/a1-dropout/hv_base_marimba_m43.txt` vs `hv_hv_marimba_m43.txt` (time, published Hz): BASE `0.5000 526.4991`, `0.6000 0.0000`, `1.2000 0.0000`; HV `0.5000 526.4991`, `0.6000 526.1238`, `1.2000 526.1238`.

## Hold variant HV

- Candidate: `heldStep(prev) = ba.if(accept, freqHz, prev);` with `accept = ready & confident` unchanged. Not in the shipped tree.
- Device-return marimba, published pitch per block (`61cf7155` BASE, `cb2c02c3` HV): 56/56 blocks periodic for HV vs 2/56 for BASE.
- Corpus outputs, one DawDreamer HV process (one compile, then 34 corpus files, then 5 sines): 39 BASE and 39 HV outputs, all non-empty, `hv.done` rc=0. Manifest `docs/witness/hv-corpus/sha256.txt` (91 lines): full sha256 of the 5 sine wavs, `base.dsp` (`3f0184ab...`), `hv.dsp` (`b48d7282...`), the fr5 harness source and binary, `run_gated.sh`, and all 78 outputs. Marimba sanity: `base__marimba_mid_C5B5.txt` = `c68512d4...`, same as the earlier run.
- Gate run and NOT valid for HV: see #hold-variant-gate-run. The 168b38c rule (absolute 55.69 Hz accuracy) is the wrong test.

## 168b38c revert

- Gate (`docs/witness/pitch-lowhz-168b38c2/gate.txt`, first 30 lines): G1 sine 440/1000 lock d 0.249%/0.076% PASS; G2 sine 55.69 trk base 60.000 cand 55.691 (err 0.002%) PASS; G3 crotale 0.65 c (4212.67 to 4214.26), marimba_mid -7.03 c (530.75 to 528.60) FAIL.
- Cells that moved (trk base to cand, lock d cents): flute_high_C7 691.70 to 698.91, -16.32; marimba_mid_C5B5 578.31 to 590.83, -7.03; cymbal_inharmonic 61.22 to 1000.00, -0.63; piano_low_A1 0.00 to 55.28, 0.00; tamtam_inharmonic 82.62 to 83.53, 0.00.
- Split (`docs/witness/pitch-lowhz-split/gate_va.txt`, `gate_vs.txt`): both halves FAIL (`87d84970`). Reverted in `87ea7898`.

## 2093 root stage

- Tracker publishes 719 Hz for a 2093 Hz input (`docs/witness/stage-hunt-719/`). Offline, the lock output follows `dry*f(target)/ext` (`fb38a93d`).
- Candidate 934258b passes the sine and fails the crotale/marimba 5-cent gate: NOT admitted (`1f70fb25`, `b8c03682`; sources `docs/witness/pitch-2093-raw/lock-sub30/`).
- Its flute trill regression came from the wrong held note (nearest MIDI to the tracker, not the true 96): an octave-error fix. Corrected A/B in `docs/witness/pitch-934258b-flute-trill/` (`f30be9b5`).

## A1 window

- SNAC via `dsp_cli --trk` reads 59.7 cents mean on piano_low_A1 (55 Hz) after the MAX_PERIOD 900 change. The 59.7 figure is SNAC, not AC.
- AC tracker silent on A1 at baseline (`docs/witness/a1-dropout/old_a1.txt`, `af81b224`).
- Low-grid half (VA, `docs/witness/a1-dropout/va_a1.txt`, `3ffcf5ec`): energy gate open from 0.6 s, confidence stays closed until 6.2 s.

## Lock periodicity

- Offline (`docs/witness/transient-sweep/hf/offline_lock_periodicity.txt`, `9658a504`): 98-100% of blocks periodic with a constant ext pitch.
- Device sweep captures (`7a9ee998`, per-block spread `b53d14f8`): 18-27% periodic.

## Transient sweep

- 52 cases, 12 controls, octave-error rule (`docs/witness/transient-sweep/results.txt`, `3b4b0a0c`, `ff18b70d`).
- HF band check (`hf_check.py`, `result-corrected.txt`, `445f4bf3`, `69af8d7b`). The first pass used an attack-including baseline; its 25 dB below baseline claim is RETRACTED. Corrected: pre-attack silence 0-0.3 s, note window 0.5-5.5 s. Example, `t_marimba_mid_C5B5_n72_r1.wav`: 3500-8000 Hz pre -96.5 note -97.8 dB; 1000-3500 Hz pre -99.0 note -79.4 dB.
- Capture timing: source onset 0.00-0.02 s in the source appears at 0.38-0.44 s in the capture.

## MIDI 96 witness

- `docs/witness/midi96/` (`6e052c1b`): the shifter saturates above +16 st; 149.55 Hz not reproduced at +18.5 st.
- Device shift still unread: needs `shiftamountdiag` and `helddetnotediag` reads.

## Witness validity

- A capture counts only when its segment RMS is >=10 dB over a same-run silent control (`tools/loopback-witness/loopback-witness.js`). Unmeasurable captures are INVALID (`4e5a2e1e`). Search ceiling 8 kHz (`b1bebcdc`). Floor relative to silence (`09381015`). `--selftest` 7/7 (`docs/witness/loopback-witness-selftest.txt`).

## Live witness channels

- Host card 0 (Scarlett 18i8): 8ch playback, 20ch capture, 48k S32_LE. Play channel index 6 (`Line Out 07` = Headphones 2 L, the only one reaching the client AIR 192 ch-2 in). Capture index 1 (`PCM 02` = `Analogue 2`). `--scan` re-locates both.
- Return level ~-43 dB against the played level. f0 locks: piano C4 reads 263.7 Hz, +12 semis reads 527.5 Hz.
- DawDreamer offline gain for the same return level: 10^(-43/20) = 0.00707945784384138.

## Compile memory and CI

- VP10/VP15/VP20 (per-call tau variants) compiles ran 4.4 GB and restarted the host; killed by pid. VQ3 (`docs/witness/pitch-lowhz-period/vq3.dsp`) proposed, not compiled.
- `pitchtracker_ac.dsp` CI faust compile: ~7-16 min per run. Local faust 2.81.10 vs CI pinned 2.85.9. `tools/faust-pinned/` (`e1e51513`) holds `noalarm.c`, a local-only shim for the 120 s SIGALRM.
- x64 `home-fx-lv2-x64` target added in `bad5ecb`. Open CI plans: faust compile cache keyed by .dsp hash (`plan-ci-faust-cache`), docs-only build skip (`plan-ci-docs-only-skip`).

## Device binaries

- Stock binary md5 `2af0406bf6acd3a0f93edc94df7c3e40`. Last pitch witnesses: CI `9917831613b209c3fc26a5ada919b40c` hot-deployed to `/opt/aloop/aloop`.
- Netboot root is tmpfs: a power cycle restores the stock binary and drops every deploy, including the rollback copy (`d2b58671`). Persistence deferred until the HV gate picks a build (PRD `decision-reboot-persistence`).

## Hold-erase self-heal

- `kHoldEraseMs = 1000` (`apc_grid.h:19`): hold-erase clears `m_looperHasContent`. `!anyHasContent && m_masterLenSamples != 0` self-heal zeroes `cmd/master_len`, `cmd/recorded_bpm`, `cmd/recorded_beats` and runs `resetTempoAuthority()`.
- `loop.dsp` writes `wlenNext` only at FINISH, so `wraplen>1` is NOT proof of content (`m_looperWrapLenStaleAfterWipe`).

## dsp-cli usage

- Clean-tree before/after: `git archive HEAD effects/home/faust | tar -x -C /tmp/basesrc --strip-components=3`, then build with `-I /tmp/basesrc`.
- `--solad freq=` is REPORT-ONLY: output is byte-identical across values; it sets only `expect`. Pass the true source f0 or `cents`/`achievedSemis` mean nothing.
- `--pitch` latched onto 3844 Hz for a 132 Hz PSOLA render: pass `minhz`/`maxhz` around the expected value.

## Diag extfreq trace

- `diag_extfreq_trace=1` (`0ca2d8e`) prints `[diag-extfreq] t raw anchor zone` at 1 line/s. Off by default: set it for one run, then restore the config.
## Hold variant gate run

- Scratch run (`lowhz/lk`, the 168b38c `run.mjs` and `gate.mjs` on a BASE vs HV table, medians of nonzero blocks after 1 s, from `docs/witness/hv-corpus/`). The 168b38c table and results are kept as `table_168b38c.tsv`, `lock_results_168b38c.tsv`, `gate_168b38c.txt`.
- Sines 440 and 1000: identical BASE vs HV (0.000%). sine_55.69: BASE and HV both read 60.000 Hz (the sub-60 Hz floor), so G2 fails for both and measures the 168b38c gap, not HV.
- G3: crotale_high_C7 has no nonzero block after 1 s in BASE (NaN); marimba_mid_C5B5 moves 0.36 c. G4: 2 files moved (clarinet_high_C6B6, vocal_male_baritone_scale), none worse than 5 c. DECISION FAIL is not a verdict on HV.
- Files with no nonzero block after 1 s: BASE 23 of 34, HV 21 of 34. HV newly publishes vocal_melody_twinkle_CC0 (median 203.01 Hz) and vocal_tenor_operatic_PD (median 115.38 Hz).
- The median of nonzero blocks ignores zero blocks, so it cannot show dropouts. A valid HV gate needs per-file zero fraction and periodic fraction, plus full-level HV renders (none exist yet; the BASE full-level table is in `lowhz/out`).
- Admission rule for HV: no sine, crotale or marimba change above 5 cents; no moved file worse than 5 cents; zero fraction not higher than BASE on any file; device-return marimba stays periodic. The 168b38c rule (absolute 55.69 Hz accuracy) does not apply.
## Energy floor root cause

- Offline energy gate at device-return level (`docs/witness/hv-corpus/energy_ready_device_return.txt`; corpus wav times 0.00707945784384138, env = 3 ms one-pole of x squared, ready after 35 ms above the floor, window 1-6 s). Ready fraction at floor 1e-6 is 0.000 for 22 files: balloon_pop_transient, bassoon_low_C2B2, bells_glock_run_C6B6, crotale_high_C7, cymbal_inharmonic, glockenspiel_high_C7, guitar_pluck_C4B4, marimba_low_C2B2, oboe_mid_C5B5, piano_high_C7, piano_low_A1, piano_mid_C4, tamtam_inharmonic, trumpet_high_C6, trumpet_low_A3, tuba_run_C2B2, vibraphone_mid_C5B5, violin_high_sulE_C7E7, violin_low_sulG_G3B3, vocal_melody_twinkle_CC0, xylophone_roll_AM_C6B6, xylophone_run_C7B7.
- Their envelope p99 is below the floor: piano_low_A1 2.66e-8, balloon_pop_transient 2.52e-9, trumpet_low_A3 1.48e-7, vibraphone_mid_C5B5 2.49e-7, violin_high 2.01e-7, xylophone_run 3.43e-7, marimba_low 2.92e-7. Peak at return level -49 to -65 dBFS (piano_low_A1 -65.4).
- Idle AIR 192 input: telemetry `audio_peak.in` 0.0001 (about -80 dBFS). Floor 1e-8 leaves about 10 dB margin above idle, 1e-7 about 20 dB. Of the 21 files still silent under HV, floor 1e-8 gives 16 some ready time; balloon_pop_transient, crotale_high_C7, piano_high_C7, piano_low_A1 and violin_low_sulG_G3B3 stay at zero even at 1e-8. Idle noise has not been measured at the device by envelope, so the floor choice is unvalidated.
- Model caveat: vocal_melody_twinkle_CC0 is the one file the offline model gets wrong: ready 0.000 at floor 1e-6, yet its hold-variant render publishes (zero fraction 0.000). The render is the witness.
- Clarinet hold-variant stable fraction is 0.987 vs BASE 1.000 (`docs/witness/hv-corpus/zero_fraction.txt`): the one stability regression in the corpus.
- Variants for the floor sweep: `docs/witness/hv-floor/` (hv.dsp, hv_floor1e-7.dsp, hv_floor1e-8.dsp). Renders requested from the DawDreamer session; results not yet in.
- Device SSH: the netboot root is tmpfs, so the host key changes on every boot; ssh needs `-o UserKnownHostsFile=/dev/null` for the aloop device, not an edit of known_hosts.
## Energy floor sweep

- Renders (`docs/witness/hv-floor/`, DawDreamer fr6, one compile per variant, device-return gain 0.00707945784384138; sines and noise unscaled). Variants: hv (hold only), hv_floor1e-7 and hv_floor1e-8 (the aboveFloor line changed only). Sha256 manifest `sha256.txt`.
- Block-weighted, t >= 1.0 s, 1828 corpus blocks: zero fraction hv 67.29%, floor 1e-7 28.28%, floor 1e-8 10.78%. Stable fraction (nonzero, within 5 c of previous block): 28.28%, 59.90%, 74.18%.
- Noise controls (rms 3e-5 and 1e-4, 91 blocks each): published-pitch fraction 0.00% for all three variants. The lower floor does not trigger on idle-level noise.
- Sines: zero fraction 0.00% everywhere. Medians 55.69 Hz gives 60.0000 Hz in all variants (the 60 Hz tracker floor); 110, 220, 440, 1000 Hz read 108.83, 218.78, 438.85, 999.24 Hz unchanged.
- Per file against hv, frames both publish, within 5 c (`analysis_frames.txt`): marimba_mid 68% (f7 and f8), vocal_male 5%, vocal_melody 0%, vocal_female 37%, cello 24%, clarinet 59% (f7) and 49% (f8), vocal_tenor_operatic 68%, flute_high 100%, soprano_sax 96%, tenor_range 100%.
- Median pitch moves over 5 c with stability loss (`analysis_f8_vs_hv.txt`, `analysis_f7_vs_hv.txt`): vocal_male -920 c at f8 (-631 c at f7), vocal_melody -286 c (-272 c), vocal_tenor_operatic +303 c, vocal_female -6.8 c, flute_trill +37 c (+30 c), cello stability 0.973 to 0.703 at f8.
- Mechanism, marimba_mid_C5B5: all variants hold one value per note. At 3.4 s HV holds 560.21 Hz to the end of the file. Floor 1e-7 re-acquires 589.81 Hz at 6.0 s where HV keeps 560.21 Hz. The lower floor changes which pitch is acquired at each onset; which value is right is not established without ground truth, so the 5 c frame check cannot decide it.
- Defect class from this: a hold that never releases on a note change (HV at 6.0 s on marimba_mid). Needs a note-change witness with ground-truth note sequences, not medians.
- Not admitted. Next: per-note scoring against ground truth for the marimba and voice files, then a note-change release rule as a separate variant.
## Note-change synthetic test

- Input `docs/witness/note-change/note_change.wav`: 12 s, plucked sines at 440, 523.25, 659.26, 392 and 440 Hz, 1 s decay, source amplitude 0.5, device-return gain 0.00707945784384138. Ground truth in `note_change.truth.json`; scorer `score.mjs <variant>`.
- HV and floor 1e-8, both: 120 frames (0.1 s each), zero fraction 0.000, within 10 c on every note, release 0.1 s after each change, no stale frames.
- Clean tones do not reproduce the marimba stale hold (560.21 Hz kept at 6.0 s, `docs/witness/hv-floor/`). The stale hold needs the real marimba timbre or decay, so this test is a floor for correctness, not a discriminator between variants.
## Harmonic note-change test

- Input `docs/witness/note-change/note_change_harm.wav`: 12 s, four harmonic partials (1, 0.35, 0.15, 0.08; decay tau 1.2, 0.8, 0.5, 0.3 s), C5, D5 entering during the C5 decay, F5, then C5 after 0.3 s silence. Truth in `note_change_harm.truth.json`.
- HV and floor 1e-8, identical on this input: within 10 c C5 0.909, D5 1.000, F5 1.000, C5b 0.952; zero fraction 0.000; release 0.1 s; no stale frames.
- Neither the clean nor the harmonic synthetic reproduces the stale hold seen on real marimba_mid. The next discriminating input needs the real marimba partial ratios (inharmonic bars) and its amplitude envelope, not more harmonic tones.
## Inharmonic note-change test

- Inputs `docs/witness/note-change/note_change_inharm_freeFreeBeam.wav` (partial ratios 1, 2.756, 5.404, 8.933: uniform free-free beam modes, derived, not measured on a marimba) and `note_change_inharm_quoted1x4x10.wav` (1, 4, 10: commonly quoted marimba set, unverified). Same C5, D5, F5, C5 sequence as the harmonic test. Scores and medians in `inharm_scores.txt`.
- Free-free set, HV: C5 median 519.69 Hz (-11.8 c), D5 +5.1 c, F5 686.50 Hz (-29.9 c), F5 never within 25 c, so no release. Frames within 10 c: C5 4.5%, F5 0%.
- Free-free set, floor 1e-8: C5 -8.1 c, D5 +3.7 c, F5 +6.5 c, release 0.7 s, frames within 10 c: C5 77.3%, F5 59.1%.
- 1-4-10 set, HV: C5 516.22 Hz (-23.4 c), frames within 10 c 0%. Floor 1e-8: C5 -10.4 c, frames within 10 c 45.5%.
- The D5 and F5 medians stay within 7 c on the 1-4-10 set in both variants, so the bias is partial-dependent, not floor-dependent. The C5 bias is systematic and negative across both sets.
- Defect, measured: the pitch tracker biases inharmonic spectra by 8 to 30 cents. The floor 1e-8 variant reduces the F5 error and fixes its release on the free-free set but does not remove the C5 bias. Next: find which estimator stage (AC lag pick or refinement) produces the bias, offline, before any DSP change.
## Refinement start sensitivity

- Offline models of the tracker stages on the synthetic inputs (`docs/witness/note-change/refine_sim.mjs`, `refine_from_grid.mjs`, `refine_two_pass.mjs`, `cmndf_check.mjs`). Models use the DSP's one-pole correlation (10 ms) and three-point refinement; the coarse stage is replaced by a fixed start.
- Plain CMNDF, clean input, per segment: 0.1 c on the harmonic and 1-4-10 inputs, -16 c on the free-free input. The -16 c is the period-method limit for non-integer partial ratios; the 1-4-10 input has an exact period, so the DSP's -23 c there (HV) is not that limit.
- Refinement with an ideal start (true lag): K=1 gives -0.2 c, K=16 gives -2.4 c on 1-4-10. The refinement spread alone is not the cause.
- Start sensitivity, 1-4-10 input, C5: from 508.21 Hz (-50 c, the grid point below C5) K=16 gives -10.5 c; from 587.0 Hz (+199 c) K=16 gives -40.7 c and K=4 gives +132 c. The grid near C5 has no point at 523.25 Hz and steps of 1.5 to 2.5 semitones, so the coarse start is off by up to 200 c.
- Two-pass (K=16, then K=1): helps some starts (C5 from 508.21: -10.8 to -2.8 c) and not others (C5 from 587.0: -42.4 to -23.7 c). From 440.0 Hz the wide pass locks a sub-multiple on D5: -735.7 c one-pass and -721.8 c two-pass. A second pass is not a fix.
- Conclusion: the refinement's accuracy depends on the coarse start, and the wide window can lock a wrong peak. The fix is in the coarse-to-refine path (grid density, octave check, or a refinement that cannot lock a sub-multiple), not a second refinement pass. Any change needs DSP renders against all four inputs before admission.
## Per-block hill-climb refinement

- Model `docs/witness/note-change/hill_climb_sim.mjs`: streaming, one lag step per 64-sample block toward the 3-point correlation vertex, using the same three taps (L-1, L, L+1) and 10 ms smoothing as the DSP. No wide window.
- Starts within about 1 semitone of the true pitch (523, 508, 587 Hz for C5): harmonic and 1-4-10 within 0.3 c, free-free -20.6 c (the period limit, as in the CMNDF check).
- Starts 3 or more semitones away fail: 440 Hz (-300 c) gives -702 c (a sub-multiple lock), 641 Hz (+351 c) gives +1202 c on the harmonic input. The climb follows a correlation ridge into the wrong peak.
- Consequence: the coarse grid near C5 (steps of 1.5 to 2.5 semitones, no point at 523.25 Hz) is the binding limit. A climb fixes the bias only if the grid is denser. A denser grid adds coarse taps, which is the codegen-cliff risk in the Faust notes; compile time must be measured in CI before any change.
## Combined refinement decision

- Decision (delegated, 2026-10-18): no pitch-tracker change is pushed. A candidate must pass the offline model before any DSP edit, and none does.
- Model `docs/witness/note-change/combined_sim.mjs`: wide K=16 pass for the start, then per-block one-sample hill-climb on the three taps. Harmonic and 1-4-10 inputs sit at -5 to -7 cents from starts within 1.5 semitones and from most farther starts. Some starts still lock a sub-multiple: -700 to -717 cents on F5 and D5, from 440, 508 and 587 Hz starts.
- The sub-multiple lock is the failure that matters. The plain CMNDF avoids it because it takes the first minimum below threshold, not the largest correlation. A YIN-style first-minimum search would need about a dozen variable-lag taps, which is the Faust codegen-cliff risk recorded in AGENTS.md.
- Next step, not started: a dedicated tracker design with a first-minimum search, costed in taps and CI compile time, rendered on all four synthetic inputs and the corpus before any push.
## Live ground truth on the Focusrite loop

- Path: play a corpus wav out of host ch6 into the device's AIR 192 ch-2 input, shift+sustain latched, capture the device output on ch1. Raw outputs in `docs/witness/live-ground-truth/`. Witness `--lock <wav> <target> 6 --gain 1`.
- Gain matters. At the default 0.5, piano_mid_C4 captured at 2.4 dB over silence (INVALID). At 1.0 the same file gives 5.9 dB and stable hops.
- Trumpet A3 (source 220 Hz, target 59 = 246.94 Hz): measured 246.03 Hz, -6.4 c, 0 octave errors, valid at 15.1 dB.
- Soprano sax C6 (target 86 = 1174.66 Hz): measured 1198.74 Hz, +35.1 c, 0 octave errors, valid at 29.7 dB. Offline the tracker reads about 1029 Hz on this file, 30 c below its C6, and the lock shift follows that reading. The live error is the tracker bias carried to the output.
- Piano C4 (target 62 = 293.66 Hz): 19 valid hops at 294 to 298 Hz, about +6 c median. Whole-segment validity INVALID (5.9 dB), but the trajectory is consistent.
- Flute C7 (source 2093 Hz, target 98 = 2349.32 Hz): measured 718 Hz, -2051 c, OCTAVE ERROR. This is the 2093 Hz root defect on real sound: the tracker lands near a third of the true pitch.
- Piano C7 (2093 Hz): no stable detection, 3 valid hops, INVALID. Same region as the flute.
- Piano A1 (55 Hz): 1 valid hop, INVALID. Matches the A1 dropout.
- Use: the lock path is the product metric. Output error = tracker bias + lock residual, so a live run checks a tracker change end to end, without renders.
- Shipped-build validation over this loop (commit `9edb2e06`, pitchtracker `.so` md5 `5b97057`, aloop `9917831`): self-test 8/8 first. Round trip 259-266 samples (5.40-5.55 ms), inside the ~7 ms ceiling. Shifted targets prove the device is in the path, not a host self-loop: marimba C2 -> target 48 (130.81 Hz) read 130.76 Hz (-0.7 c) and trumpet A3 -> target 59 (246.94 Hz) read 246.07 Hz (-6.1 c, matching the -6.4 c archived above). Piano C4 level-matched to the marimba file's RMS (gain 1.59) -> target 60 read 262.25 Hz (+4.1 c) valid at 11.7 dB; at the file's own level it is INVALID at 8 dB, under the 10 dB rule.
- Run-to-run spread is the honest residual: marimba C2 -> target 36 (unshifted) read +18.4, +12.4, -20.8, -33.9, -18.8 c over five 4 s runs, and -52.1 c on one 6 s run, so the whole-segment verdict crosses the 50 c gate intermittently. Hop-level analysis of three kept captures says the sustained pitch is much better than that single number: median +5.0, +2.4, -0.3 c with 86-89% of voiced hops within 50 c. The whole-segment estimate picks one loud window and drifts; the witness now prints the hop-level median alongside it and the verdict semantics are unchanged.
- Corpus sweep on the same loop and build (13 single-note files, 6 s, gain 1, logs in `.gm/witness/sweep-shipped/`): cello A2 -> 45 read 110.00 Hz (+0.0 c), marimba C2 -> 36 read 65.70 Hz (+7.8 c), trumpet A3 -> 57 read 219.17 Hz (-6.6 c) - the low and low-mid single notes are the accurate region. Bassoon C2 -> 36 read +71.7 c on the whole-segment estimate but +1.3 c on hop median, the drift above in one number. Mid-high carries a real bias: soprano sax C6 -> 84 read 1067.91 Hz (+35.1 c), clarinet C6 +37.5 c, trumpet C6 +73.7 c; marimba C5 -> 72 read 1093.07 Hz (+1275 c, an octave error) and tuba C2 +101.9 c. INVALID (below the 10 dB rule at this level): oboe C5, piano C4 at its own level, violin G3, vibraphone C5.
- Reproducibility check: soprano sax C6 -> 84 read +35.1 c here against the +35.1 c recorded above, and trumpet A3 -> 59 read -6.1 c against the archived -6.4 c. Two archived ground-truth figures reproduced on the shipped build, so the loop and the metric are stable even where the absolute error is not.
- Attribution of the mid-high error, corrected - the measurements stand but the reading does not (see the REFUTED bullet below): offline tracker median against the target note: sax C6 -26.3 c, clarinet C6B6 -32.6 c, trumpet C6 -69.0 c, cello A2 +25.5 c, trumpet A3 +0.1 c. Live raw detector on the sax (`diag-extfreq`) read 1028.3-1031.5 Hz against a 1046.50 Hz target, so -30.1 c, and the live output on that same run read 1067.59 Hz (+34.5 c, hop median +31.2 c). Applying the correcting shift once would land on the target; instead the live error tracks the MAGNITUDE of the tracker error - sax +34.5 vs 30.1, clarinet +37.5 vs 32.6, trumpet C6 +73.7 vs 69.0 - a steady extra of about +4.5 to +4.9 c. Output error tracking the MAGNITUDE of the tracker error is exactly what ONE application looks like when the detector is biased - the lock trusts the biased reading and shifts by that bias, so output error = tracker error, one for one. The extra ~5 c is source detuning, not a second shift: the witness pre-note-on f0 puts sax C6 at 1056.56 Hz (+16.6 c) and trumpet C6 at 1053.50 Hz (+11.5 c) against the 1046.50 Hz label. So the fix belongs in the tracker, and rows `tracker-mid-high-bias-shipped` and `tracker-marimba-c5-octave-error` carry it.
- REFUTED (row `lock-shift-applied-twice`, closed stale, witness `.gm/witness/lock-shift-twice.txt`, sha256 `11333775efb9ff8eab1df9f28d0a5c8cbb6eda5d78e209823efc11c7f259f1d7`): the shift is applied ONCE. Two sine controls kill the doubling - 440.00 Hz locked to note 84 (1046.50 Hz, +15 semitones) reads 1046.55 Hz, +0.1 c, and 440.00 Hz to note 82 reads 932.55 Hz, +0.4 c; a doubled shift would read +1500 c and +1200 c. Offline, the committed multitranspose codegen with extFreqDet pinned to 1028.30 Hz on a 1046.50 Hz source outputs 1065.05 Hz, +30.41 c, exactly (target - detected). The "+4.5 to +4.9 c extra" is source detuning the attribution assumed away: the witness's own pre-note-on f0 gives soprano_sax_high_C6 1056.56 Hz (+16.6 c) and trumpet_high_C6 1053.50 Hz (+11.5 c) against a 1046.50 Hz target, and a pure 1046.50 Hz sine locked to 84 reads +33.2 c, so the live detector reads -33.2 c at C6 and the lock carries that single tracker bias to the output. The mid-high error is tracker bias, one for one; the fix belongs to `tracker-mid-high-bias-shipped`, not to the shift path.
- Cross-check by an independent renderer (DawDreamer libfaust 2.85.9 JIT, gain 0.00707945784384138, 4800-sample blocks, median of nonzero block-end Hz from t >= 1.0 s) against the offline figures above (gain 1.0, per-100 ms tracker output): soprano sax C6 agrees, -26.7 c against my -26.3 c, and it also agrees with the live detector at 1028.3-1031.5 Hz, so the sax line is confirmed by three routes. Clarinet C6B6 does NOT agree (+101.2 c against my -32.6 c) and trumpet C6 gave no nonzero block at their gain, matching the archived hv-corpus zero fraction of 1.000 for that file. Both differences are protocol, not tracker: gain, which frames count as voiced, and the fact that C6B6 is a run rather than a held note. Only the sax line is cross-confirmed, and it is the one the doubled-shift reading rests on.
- Reference check on the corpus labels (rows `tracker-marimba-c5-octave-error` and `tracker-mid-high-bias-shipped`): the labels are not equally trustworthy. Power-averaged FFT with a harmonic test puts soprano sax C6 at 1051.51 Hz (+8.3 c vs C6), clarinet C6B6 at 1047.71 (+2.0 c) and trumpet C6 at 1048.33 (+3.0 c), so the C6 references are sound and the mid-high bias is real tracker error, not reference error. By contrast marimba C5 peaks at 558.92 Hz, +114.2 c above its C5 label of 523.25 (my independent per-window median gave 567.31, +140 c), so C5 numbers must cite their reference - against the file's own peak the shipped tracker is within about 6 c and never jumps an octave, which is why the live 1093 Hz is downstream of the detector rather than a detector octave error. My per-window median over the same files: sax 1052.13 (+9.3 c), trumpet C6 1048.63 (+3.5 c), clarinet C6B6 1049.63 (+5.2 c), cello A2 111.50 (+23.4 c), vibraphone C5 590.81 (+210 c), oboe C5 1114.81 (a partial, unusable) - the two methods agree on the C6 files to within a few cents. Cello matters: its apparent +25.5 c offline tracker error is almost entirely label error, since against its true 111.50 Hz the tracker is within about 2 c. So judge every no-regression file against its measured pitch, not its label.
- Arithmetic of the lock, worth keeping: output error against the target equals source/detected. Sax: source 1051.51, detected 1030.46 -> 1067.9 Hz, +35.1 c against the 1046.50 target, matching the +34.5 c measured live. So the shifter is exact given the detector and every cent of the live error is detector bias - the fix is to make the detector read the true pitch, not to touch the shift path.
## 2093 Hz root: the tracker ceiling

- Cause: the coarse grid in `pickFundamental` tops out at 1581.12 Hz (lag 30), and `kExtFreqDetMaxHz` clamps at 1500 Hz. Any input above that can only be read at a sub-multiple.
- Offline (`docs/witness/live-ground-truth/ceiling_sim.mjs`, normalized correlation, first local maximum above 0.85, same frames): with the DSP's lag floor (30), flute C7 reads 1072.9 Hz (-1157 c) and piano C7 reads 1057.9 Hz (-1181 c), both within 25 c on 0 frames. Trumpet A3, soprano sax C6 and piano C4 are unchanged.
- Lifting the floor to lag 11 (about 4364 Hz): flute C7 reads 2146.1 Hz (+43 c) and piano C7 reads 2112.8 Hz (+16 c, 35% of frames within 25 c). Others unchanged.
- Live (lock witness, flute C7 target 98): 718 Hz, a third of the true pitch, the same ceiling effect through the coarse grid.
- Threshold is not the cause: thresholds 0.5 to 0.85 give the same picks (`threshold_sim.mjs`). First-minimum (CMNDF, all lags) gives 2147.6 Hz on the flute, so the true pitch of this corpus file may be about 2147 Hz, sharp of the C7 label.
- Fix needs more than a constant. Raising the grid also needs the refinement window (`refineFreq`, K=16) scaled to the lag: at lag 11 to 30 a fixed K=16 clamps to L0 = 18 and refines the wrong peak. The clamp in `kExtFreqDetMaxHz` (1500 Hz) would also need lifting, and that clamp was deliberate (`defect-lock-above-1500hz-clamp`).
- Next: a candidate with the grid extended and a lag-scaled refinement window, rendered on the high-register corpus files (flute_high_C7, piano_high_C7, crotale_high_C7, glockenspiel_high_C7, xylophone_run_C7B7) before any push.
## Ceiling candidate (staged, not admitted)

- `docs/witness/pitch-ceiling/pitchtracker_ac_ceiling.dsp`: grid extended from 1581 Hz to about 4.3 kHz with 19 new candidates (ratio 1.0545, the grid's existing spacing), each high candidate read through `corrAtLagVarTau` (rwtable taps, tau 0.02), the rawFreq clamp raised to `maxRawHz` = 4200 Hz. Promotion (`reachable2/3`) still uses `maxTrackHz` = 1500 Hz. Parentheses balance; not compiled here.
- Renders requested from DawDreamer: candidate on the 34 corpus files, the 5 sines and the four synthetic inputs; base on the four synthetic inputs (corpus base is `hv-corpus/base__*.txt`). Admission rule: no moved file worse than 5 cents, no zero-fraction increase, high-register files gain pitch.
## Ceiling candidate result (not admitted)

- Renders (`docs/witness/pitch-ceiling/`, comparison `compare_vs_base.txt`): candidate against base on the 34 corpus files, device-return gain.
- Flute C7: median 691.7 Hz to 2236.1 Hz. The first-minimum estimate gave 2148 Hz, so this is a large improvement but about +70 cents off it. Flute trill: 1074.8 Hz to 1995.5 Hz.
- Runaway: cello_low_sulC_A2 (111.8 Hz to 4200.0 Hz, +6277 c) and vocal_male_baritone_scale (172.8 Hz to 4200.0 Hz, +5524 c). The new raw clamp lets low-confidence high candidates settle at the clamp.
- No gain on piano C7, crotale, glockenspiel or xylophone run: zero pitch at device return, as in base.
- Not admitted. The candidate needs a confidence gate for candidates above 1500 Hz, so that a high candidate cannot win on voice and cello material. That gate is the next design step.
## Runaway probe: normalization is not the cause (offline)

- `docs/witness/live-ground-truth/runaway_probe.mjs` and `norm_probe.mjs`: first local maximum above 0.85 over lags 11 to 900, plain 1024-sample window. High-pick fraction (lag under 30): cello 0.5%, vocal_male 4.6%, flute 88.7%, piano C7 77.3%, sax 0%, trumpet 0%, piano C4 1.3%.
- Geometric normalization (divide by sqrt of both energies): cello 0.9%, vocal_male 5.3%, flute 88.7%, piano C7 80.2%. No change in the runaway picks, so the DSP's one-sided normalization is not the cause.
- The offline model does not reproduce the DSP runaway. The DSP smooths the correlation with a 0.02 s one-pole (candidates at or above 700 Hz) and checks only the coarse grid, not every lag. Next, model that smoother and grid exactly before any candidate change.
- The candidate (`pitch-ceiling`) stays unadmitted: cello and vocal_male still run away to the 4200 Hz clamp in the DSP renders.
## Latency ledger (partial, means-transpose-latency-floor)

- Lock path: `lockDelayMs = 80.0` (`effects/home/faust/multitranspose.dsp:70`), `lockDelaySamples = 3840` (`:71`), consumed by `inLockWarmup = sinceAttack < lockDelaySamples` (`:80`). This gates the lock voice during its first 80 ms after an attack. It is the largest fixed term on the lock path, and it is the lead-in that the lock witnesses measure (about 0.3 s of unpitched output on piano C4).
- Release hold: `engageReleaseHoldS = 0.06` (`multitranspose.dsp:68`, used at `:106`). A counter for the engaged state, not a signal delay.
- Block: `block_size = 64` (`config/aloop.conf`); ALSA period 64, buffer 256, start threshold 64 (AGENTS, Audio thread and ALSA).
- Telemetry: `latency_bias_samples` read 323.3 at idle (device status, 2026-10-18), `alsa_roundtrip_samples` 259.3, `latency_trim_samples` 0.0.
- Engaged free-transpose stage: 128 samples = 64 from `DUBFX_BS` block buffering (`effects/home/faust/pitch_ffi.h:24`; `dubfx_pitch_tick` emits `outBuf` one 64-sample block late, `pitch_ffi.h:35-43`) plus 64 of SOLA read lag (`INITIAL_READ_OFFSET_DEFAULT`, `effects/home/faust/soladSnacOctaver.h:251`; the read head sits at `m_wr - offset`, `:145-146` and `:487`). Derived form: engaged latency = 63 + gap, so 127 at gap 64. Raw data: `docs/witness/solad-read-lag/`.
- Offline proxy for gap is `--solad gapMean` (`tools/dsp-cli/dsp_cli.cpp:894`), 34 corpus files x semis {0, +7, -5}, `normrms=0.21`: semis=0 gapMean 64.00 with 0 splices, 0 emergency, 0 clamped; semis=+7 gapMean 301.82 with clamped 9317254; semis=-5 gapMean 3351.66. 667 glitches total at `threshold=0.25 minGapMs=5`.
- Three latency candidates measured and REJECTED (offline, device unavailable). `INITIAL_READ_OFFSET_DEFAULT` 64->48: gapMean 48.00, but 5 files gain a glitch once the `m_warmup = SNAC_WIN = 1024` boundary step is excluded (`flute_trill_high_C7|+7 6->7`, `glockenspiel_high_C7|-5 1->2`, `marimba_low_C2B2|-5 0->1`, `marimba_mid_C5B5|-5 0->1`, `violin_high_sulE_C7E7|+7 12->13`) and clamped rises on 33 files. 64->32: 4 files regress (`flute_trill_high_C7|+7`, `bells_glock_run_C6B6|+7`, `tuba_run_C2B2|-5`, `xylophone_roll_AM_C6B6|-5 16->19`). `kUpshiftLagPeriods` 1.5->1.0 (`soladSnacOctaver.h:256`) cuts semis=+7 gapMean 301.82->22.81 but doubles clamped to 17564843 and collapses achieved pitch on 27 files (`bassoon_low_C2B2` 729.57->487.44 Hz, the unshifted value), so the cut is bought by destroying the shift.
- `DUBFX_BS` is not a knob: the SNAC sweep steps on `BLOCK=64` (`snacPeriodTracker.h:14`, `:68-69`) and `soladSnacOctaver.h:116` calls `stepSchedule(n)` once per `processBlock`, so a 32-sample chunk double-steps the sweep.
- Still open and NOT shipped: ALSA `buffer_size` `period*4` -> `period*2` (`src/dsp/audio_thread.cpp:553`). Worth up to about 128 samples of `roundTripEst` if `playDelay` tracks buffer minus period, but the failure mode is xruns and it needs the Pi. Unwitnessable offline.
## Runaway root cause: duplicate integer lags at the top of the grid

- Model `docs/witness/pitch-ceiling/dsp_grid_model.mjs`: streams the DSP's grid taps sample by sample (one-pole 0.01 s or 0.02 s smoothing per candidate, lag = int(SR / f), first local maximum above 0.85 in descending-frequency order, 20 Hz highpass). Reproduces the runaway on the shipped candidate: top candidate 4109.64 Hz picked in 67% of cello blocks and 72% of vocal_male blocks.
- Cause: at 48 kHz the top grid points collapse onto the same integer lag. 4333.61 and 4109.64 Hz both give lag 11, 3897.24 and 3695.81 Hz both give lag 12, and 2834.51 Hz duplicates its neighbour. The local-maximum test uses >=, so two candidates on one lag tie and pass.
- Dedup model (`dsp_grid_model_dedup.mjs`, drops the three duplicate-lag candidates): cello high picks 0.000, vocal_male 0.037, flute 0.947 unchanged, piano C7 0.079 unchanged, trumpet and sax 0.000.
- Candidate `docs/witness/pitch-ceiling/pitchtracker_ac_ceiling_dedup.dsp`, generated by `gen_ceiling_dedup.mjs` from the shipped tracker: 54 candidates, parentheses balanced, not compiled here. Renders are the next step before any admission.
## Live transient sweep, three more sources (2026-10-19)

- Raw outputs: docs/witness/live-ground-truth/sweep/. Full gain, target two semitones above source.
- Guitar pluck C4 (target 62, 293.66 Hz): settled at 292.37 Hz, -7.6 cents, 0 octave errors, valid at 23.4 dB. The first second publishes 4 to 7 kHz junk after the attack (4404 to 7049 Hz), so the onset octave error is present on guitar too.
- Vibraphone C5 (target 74, 587.33 Hz): INVALID at 9.9 dB over silence. It publishes 530 Hz, then 6.1 to 7.1 kHz junk after the attack.
- Violin C7 (target 98, 2349.32 Hz): INVALID at 6.1 dB. It settles near 2080 Hz for most of the note, and the same 6 to 7 kHz attack junk appears.
- Reading: the attack-junk defect is not piano-specific. It appears on guitar, vibraphone and violin. The validity rule rejects vibraphone and violin at this level, so their pitch numbers are not measurements.

## Shipped builds

- `ffaa83d`: 1274080 B, md5 `170f0ee76b1ff9390a0a6f56354c5f43`, CI `38130094189` (audience gate snapped). `d316e22` (1273936 B) is the `/opt/aloop/aloop.prev-inputroute`-era baseline. Input-routing build `0947f3a`+`9cdcae0`: 1274544 B, md5 `27d9a864a69bc204425b2226e0c97b47`, CI `38123683795`; control WITNESSED, audio still blocked on clean ingress.

## Effect parity

- Effect parity (#3), fixed `a9ae078`, deployed; CI `38117216623`: 24 cases, 21 gated, 0 fail. `record_vs_cue` is exact, and the regress rows catch the un-fix.

## Host build limits

- This host: no cmake, no X11/GL/freetype/alsa headers, uid 1000 so no apt, so a clean-install check is a CI job, never a local run. A Linux clean install on ubuntu-latest additionally needed the GL development packages, plus freetype via `CPATH`.

## ENGAGED latch

- `engagedZone` written 1.0 and never cleared left the pitch stage engaged for process life after one mod-wheel touch: a permanent 128-sample (2.667 ms) latency plus an open FORMANT hiss path. Fixed `76350bd`; the else-branch costs one 128-sample discontinuity at disengage.

## Latency bias

- `latency_bias_samples = N + roundTripEst + trim`, from `capDelay + playDelay + N` averaged over 4 s (never a fast EMA). Resample (SHIFT) bias is derived: `round(D_dry*(1-f) + (2*blockSize + L_chain)*f)`, `f` = mean `combinedFold` over the take, `L_chain = 128*engagedFraction + 128*shiftFraction`.

## Lock shift applied once

- REFUTED `5e36cfa1` (row `lock-shift-applied-twice`, status stale, witness `.gm/witness/lock-shift-twice.txt`): the lock shift is applied exactly once. A 440.00 Hz sine locked to note 84 reads +0.1 c and to note 82 reads +0.4 c, where a doubled shift would read +1500 c and +1200 c. The claimed extra +4.5 to +4.9 c is source detuning: the pre-note-on f0 gives soprano_sax_high_C6 +16.6 c and trumpet_high_C6 +11.5 c against the 1046.50 Hz target, and a pure 1046.50 Hz sine locked to note 84 reads +33.2 c, so the live detector is -33.2 c at C6 and the lock carries that single tracker bias to the output one for one. The earlier attribution of mid-high error to a doubled shift (`246c9d9f`, `fac8896f`) is dead; the fix belongs in the tracker.

## Corpus pitch reference (labels are not ground truth)

- `.gm/witness/corpus-pitch-reference.txt` (`4acd1333`) records a measured spectral peak per swept file with harmonic margins; score against it, not the filename note. Files whose peak is nowhere near their label include `bassoon_low_C2B2` (label 65.41, peak 486.70, +3474.5 c), `tuba_run_C2B2` (65.41 / 496.50, +3509.1 c), `trumpet_low_A3` (220.00 / 1091.84, +2773.4 c) and `violin_low_sulG_G3B3` (196.00 / 394.71, +1211.9 c). Per-window medians (`11ab5e91`): sax 1052.13, trumpet 1048.63, clarinet 1049.63, cello 111.50 (+23.4 c against its label, mostly label error), vibraphone 590.81; oboe reads a partial. C6 labels are sound (+2 to +8 c); C5 reads 114 c low, so C5 numbers need their reference named. Output error against the target equals source/detected, so all live error is detector bias.

## Confidence gates

- `confidenceGate = 0.85` (`multitranspose.dsp`) gates re-tracking only; `kContGate = 0.50` (`snacPeriodTracker.h`) gates whether `confidence()` reports it. `updateContinuity` uses window `min(2p+128, SNAC_WIN)` and the best r over ±6%: `confidence()` >=0.50 on 96.3% of real-audio blocks with a good lock.

## Refine spread is lag-proportional

- `dfd4871a`: a 3-point parabola fitted at +-K around a lag sitting d samples off the true period returns a vertex biased by about d*(1 - x*cot(x)) with x = pi*K/period, so the bias grows as (K/period)^2. The old fixed +-16-sample window spanned about 70% of a period at C6, where the period is 46 samples. Measured offline (pinned flags, 64-sample blocks, 34-file corpus, gain 1.0, median of voiced frames from t>=1s, scored against each file's own measured spectral peak): soprano_sax_high_C6 -34.2 -> -3.2 c, clarinet_high_C6B6 -36.2 -> -0.5 c, trumpet_high_C6 -73.4 -> -6.8 c, cello_low_sulC_A2 -0.4 -> -0.4 c.

## Granulator live-ring witness

- Fresh-boot granulator test (`.gm/witness` via /tmp/gran3.js): A_dry in=0.3615 out=0.3042; B_gran_latched_nokey in=0.1054 out=0.0938; C_FIRST_note48_granular in=0.2627 out=0.2253; D_FIRST_note48_granular_2 in=0.3405 out=0.1650; E_released in=0.2157 out=0.1829. Loop health: Pi audio_peak.in 0.0001 -> 0.2542, peakOut -> 0.2643; Scarlett input capture ch04 = 0.8883, ch05 = 0.2961 against a ~0.00003 noise floor before the fix. Netboot reachability check on the same run: lease e4:5f:01:53:f0:ef at 192.168.137.132; ping, tcp/22 and tcp/9401 all answer; udp/4445 telemetry returns live JSON with xruns=0.

## Witness metrics: hop-level median

- `1da2e1a3`: the whole-segment estimate picks one loud window and drifts - marimba C2 against target 36 (unshifted) read +18.4, +12.4, -20.8, -33.9, -18.8 c over five 4 s runs and -52.1 c on one 6 s run - so judge a run by the hop-level median instead: +5.0, +2.4, -0.3 c with 86-89% of voiced hops within 50 c on three kept captures. `tools/witness-summary` parses the loopback logs; it records `NOT_DETECTED` as its own verdict (`c4fe3b08`), parses the octave-jump list (`fbbb6bc5`), and CI checks it on every push (`187fb6ab`).


## Vocoder and formant layer

- Surface: `GrainFormant` (`effects/home/faust/grainFormant.h`) is the ONLY vocoder/formant layer;
  `soladSnacOctaver.h:88` maps `FORMANT` (octaves, -3..3) to `setFormantFactor(powf(2,d))`, clamped
  0.5..2, and mixes dry/grain at `kFormantMixCap=0.6`. No second pitch estimate exists for it: it
  reads `m_lastGoodPeriodF` from the same SNAC tracker as the transpose.
- Measured with `tools/formant-lab/` (`measure-formant.py` drives `dsp_cli --solad`,
  `formant_meter.cpp` reads wavs): 34 corpus files x semis {-12, 0, +12} x dial {-1, 0, +1}, steady
  middle 60%, ENV = log2(centroid/dry centroid), ECS(d) = ENV(d)-ENV(0).
- Before -> after (median over 204 cases): |ECS(-1)| 0.079 -> 0.504 oct; |ECS(+1)| 0.717 -> 0.713;
  SEE |ECS(d)-d| 0.896 -> 0.437 oct; |L| = |20log10(rms(d)/rms(0))| 2.72 -> 0.37 dB median and
  9.45 -> 4.12 dB worst; dAM +0.06 -> +0.00 dB; dRIPPLE -1.89 -> -0.26 dB.
- Fixes: (1) mix now tracks the OCTAVE deviation `log2(fm)`, not the linear `|fm-1|`, so the dial is
  symmetric (before, -1 got 0.29 mix against +1's 0.60); (2) equal-power dry/grain normalisation
  `1/sqrt((1-mix)^2+mix^2)` (the two paths are phase-incoherent whenever fm != 1, so a linear
  crossfade dipped ~2.8 dB); (3) mix is additionally bounded by `|log2(fm)-log2(scale)|`, so the
  layer is not blended in where its envelope already matches the dry path (dial -1 at -12 semis,
  dial +1 at +12 semis: now exactly 0.000 oct and 0.00 dB). Zero added latency; identical at fm=1.
- PRE-REGISTERED GATE M1 monotonicity is DEGENERATE and unmeetable as written: the ideal
  displacement is `d - semis/12`, which is 0 for 68 of 204 cases (semis=-12/dial=-1 and
  semis=+12/dial=+1), where the correct answer has no sign. Over the 136 non-degenerate cases
  monotonicity is 0.971 (was 0.784 before, over the same 136).
- OPEN: worst-case |L| 4.12 dB (gate 3.0) on soprano_sax_high_C6 and clarinet_high_C6B6 at dial -1.
  The grain layer's own gain there is ~0.34, i.e. grains emitted at a tracked period that is not one
  source period cancel at the hop -- a TRACKER defect leaking into the layer, not a mix-math defect.
  Not masked with a wet-path AGC: that would restore the RMS while leaving the cancellation.
