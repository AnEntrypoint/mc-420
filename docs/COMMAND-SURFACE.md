# Command surface — the looper control behavior aloop clones

100% clone includes the control/command behavior, not just audio. aloop
reproduces looper's full command surface (the ported apcKey25*.cpp logic + loop
commands), with the input source moved to ALSA rawmidi (src/control/midi.cpp).

## Loop commands (ported from looper loopMachine command dispatch)
record · play · stop · clear/erase (per track) · halve/double speed (varispeed) · loop-immediate · set/clear loop-start — for each of the 20 independent loopers. NO overdub.
· set/clear mark point · pause (mute-with-advancing-head) · quantize-to-grid.

### Exact opcode → aloop control target (commonDefines.h → config/controls.conf)
The hardware speaks `LOOP_COMMAND_*` opcodes; aloop's control map speaks named
targets that resolve to Faust zones (src/dsp/audio_thread.cpp `targetToZone` +
the engine-global `clear`/`speed` handling). This is the authoritative parity map:

| looper opcode | value | aloop target | how it's realized |
|---|---|---|---|
| `LOOP_COMMAND_RECORD` (per track `TRACK_BASE 0x20`) | 0x80 / 0x20+i | `looper<i>/rec` | Faust `button("rec")` — record replaces the loop (NO overdub) |
| `LOOP_COMMAND_PLAY` | 0x81 | `looper<i>/play` | Faust `checkbox("play")` — gates the looper output |
| `LOOP_COMMAND_STOP` / `STOP_IMMEDIATE` | 0x03 / 0x02 | `cmd/stopall` | audio thread clears **every** `looper<i>/play` to 0 |
| `LOOP_COMMAND_STOP_TRACK_BASE` | 0x40+i | `looper<i>/play`=0 | per-track stop = clearing that one play checkbox |
| `LOOP_COMMAND_CLEAR_ALL` | 0x01 | `cmd/clearall` | engine-global — a plain `process()` signal input (3rd input), NOT a Faust UI zone — wipes all 20 loops |
| `LOOP_COMMAND_ERASE_TRACK_BASE` | 0x60+i | `looper<i>/erase` | per-looper Faust `button("erase")` — wipes that one loop |
| `LOOP_COMMAND_HALFSPEED_ON/OFF` | 0x0C/0x0D | `cmd/halfspeed` | engine-global `speed`=0.5 while held (varispeed read rate) — a plain `process()` signal input (4th input, `effSpeed`), NOT a Faust UI zone (see below) |
| `LOOP_COMMAND_DOUBLESPEED_ON/OFF` | 0x0E/0x0F | `cmd/doublespeed` | engine-global `speed`=2.0 while held (2× read rate), same signal-input mechanism |
| `LOOP_COMMAND_ABORT_RECORDING` | 0x06 | `looper<i>/rec`=0 | releasing rec ends the take; record replaces in place so there is nothing to "un-append" |
| `LOOP_COMMAND_LOOP_IMMEDIATE` | 0x08 | *(model difference)* | needs an addressable read head — see the note below |
| `LOOP_COMMAND_SET_LOOP_START` | 0x09 | *(model difference)* | needs an addressable read head — see the note below |
| `LOOP_COMMAND_CLEAR_LOOP_START` | 0x0A | *(model difference)* | needs an addressable read head — see the note below |
| Link tempo/phase | — | `looper<i>/len` | audio thread sizes every loop from the Link BPM (varispeed grid sync) |

### The one deliberate model difference: mark-point / immediate re-trigger (0x08–0x0A)
These three commands reposition an **addressable read head** (set a restart mark at
the current play position; jump all heads to their mark). The aloop loop engine is a
Faust **feedback-delay ring** — record replaces the loop, play recirculates it — which
has NO addressable read position, so it cannot express a mark-point jump.

Why not a buffer+playhead (rwtable) engine, which *does* have an addressable head?
Because a preserve-on-hold playhead looper must **read the buffer and write the
read-back to the same buffer** (so the loop survives while not recording) — a
read-modify-write that Faust's pure-signal evaluator rejects. This was witnessed
across **4 CI codegen attempts** (`syntax error` → `stack overflow in eval` →
`endless evaluation cycle of 8 steps`); the delay ring sidesteps RMW by construction
and is the correct Faust looper. See `.wfgy/lessons.md` and the ADR in `DECISIONS.md`.

Everything ELSE maps 1:1 (record/play/stop/stop-all/erase/clear/half-double-speed,
plus Link-driven varispeed loop length). Mark-point is the single behavior traded for
a single-Faust-program, maintainable, RMW-free engine — a documented, evidence-backed
model choice, not a silently dropped feature.

Momentary semantics match the hardware exactly: `HALFSPEED`/`DOUBLESPEED` and
`clear`/`erase` are **held** (value 1 = active, release = neutral), driven each
block from the atomic ParamStore the MIDI thread writes. `speed` composes with the
Link-set `len`: Link sets the base loop length, `speed` divides it (loop stays
grid-locked, plays at 0.5×/2×). The `TRACK_BASE 0x20` / `STOP_TRACK_BASE 0x40` /
`ERASE_TRACK_BASE 0x60` families are 20 contiguous per-track slots, decoded directly in
`ApcGrid`/`midi.cpp`. `config/controls.conf` currently binds only four controls:
`note81 cmd/stopall`, `note70 cmd/halfspeed`, `note71 cmd/doublespeed`,
`cc56 fx/lpslope`. Those four are remappable without a recompile; the pad and
knob decoding lives in C++.

**`clear`/`speed` are process() signal inputs, not Faust UI zones (fixed in
commit 9806835, 2nd-generation fix on top of 382e775's incomplete attempt):**
Faust's `par(i, NLOOPERS, vgroup(...))` combinator re-elaborates whatever UI
primitive (`button()`/`hslider()`) is textually referenced inside its body at
EACH of the 20 instantiation sites — even when the declaration itself is
hoisted to file scope and threaded in as an ordinary function parameter. This
was WITNESSED via the generated C++ (`build/loop.cpp`): `"speed"`/`"clear"`
each appeared 20 times, one per `"looper N"` vgroup, even after 382e775
believed it had collapsed them to a single shared zone. There is no Faust
mechanism for "declare a UI control once, reference the same zone from many
call sites" across a `par()` boundary. The real fix removes `clear`/`speed`
as Faust UI controls entirely: `dsp/loop.dsp`'s `process()` takes 8 signal
inputs — `(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen,
sidechainEnv, recordedBeats)` — and `clearAll`/`effSpeed` are plain wires
threaded through `par()`, which cannot duplicate a signal the way it
duplicates a UI primitive. `audio_thread.cpp` fills the corresponding
per-block-constant buffers and passes them as the matching `fins[]` slots to
`compute()` instead of calling `fui.set("clear"/"speed", ...)`.

## APC Key25 controls (the exact mapping — src/control/midi.cpp, param_mapping.md)
- CC48/49/50/51/54/55/57/53 → the eight fx knobs (see the bank tables
  below); all normalized `data2/127`.
- CC53 → formant depth on the Dub page — `ApcGrid::applyFormantCC`: deadzone
  60–68 → 0, otherwise `((data2-64)/63)*1.5` clamped to ±3. SHIFT does not
  expand it. It applies only while live pitch is on, in multi-key mode, or
  while a pitch-lock key is held.
- CC52 / keybed / mod-wheel → live pitch semitones
- notes 82–86 → microrepeat divisors {1,2,4,8,16}
- notes 70/71 → global speed-scrub (varispeed)
- SHIFT (note 0x62/98, channel 0 only) → held state driving the
  loop-fold/monitor routing: while held, the running loops are folded INTO the
  effect input (`fx/monitorfold` → Faust `MONITORFOLD`, `dsp/aloop.dsp`'s
  `foldMix`) with the dry loop contribution complementarily suppressed, so the
  loops are heard once, through the effects — `ApcGrid::onShiftPress/Release`,
  `AudioThread::Telemetry::monitorMode`. Drum-record-mode IS ported: holding
  note 66 (`ApcGrid::onSamplerBtn66Press`) sets `m_drumRecordMode`, and each
  keybed key press records into that key's drum slot (`EV_REC_START` with the
  key index); releasing note 66 sends `EV_REC_STOP`. See `docs/manual.html`.
- the 8×5 grid → track/clip select + state display

## 3-bank fx control-surface (LOFI feature — src/control/apc_grid.h/.cpp, midi.cpp)
The 8-button control row above the pad grid is transpose / sample / drum-sample /
dub-fx / guitar-fx / lofi-fx / varispeed / varispeed. The first three and last two
are the existing, unchanged buttons (`onLiveEngageToggle`, `onSamplerBtn65/66Press`,
note70/71 speed-scrub). Positions 4-6 are 3 new, symmetric bank-select buttons —
**FULLY WIRED** in `ApcGrid`/`midi.cpp`, and (per the Core-3 redesign below)
so is every bank's own effect chain — all 3 banks are simultaneously live.

- **dub-fx** = note 67, **guitar-fx** = note 68, **lofi-fx** = note 69 (channel 0
  only) — WITNESSED live on real APC Key25 hardware (originally assumed 87/88/89
  from an unverified "free note range" guess; real button presses, isolated one
  at a time and read from the live `[midi] note decoded` log, showed 67/68/69 —
  which also makes physical sense: they sit immediately before notes 70/71
  (the varispeed scrub buttons), i.e. these ARE "positions 4/5/6 of the row,
  left of the two varispeed controls" exactly as originally specified).
- Tap-to-select, radio-button style — no cycling, no hold-preview. Pressing one
  makes it the `activeBank()` immediately (`ApcGrid::onDubFxPress`/
  `onLofiFxPress`/`onGuitarFxPress`). There is no `pushBankValuesToZones`: a
  bank press sets the active bank, records whether SHIFT was held (which selects
  that bank's SHIFT knob page until the bank is pressed again without SHIFT),
  and starts the 150 ms LED flash. Stored knob values are NOT re-sent on bank
  select; a knob applies as soon as it moves. A plain lofi-fx tap toggles the
  granulator; SHIFT + lofi-fx toggles Resonode and also turns the granulator off.
- Selecting a bank starts a `bankFlashActive()` window (150ms, `kBankFlashMs`),
  cleared by `pollHolds` — a **transient** LED flash on selection, not a
  persistent "which bank is active" indicator.
- CC48/49/50/51/54/55/57/53 (the 8 physical fx knobs) are intercepted in
  `midi.cpp` and routed to `ApcGrid::onFxKnobCC`, ahead of the flat
  `config/controls.conf` map. That file binds none of these 8 CCs — it holds
  only the four entries listed above — so a flat binding cannot race
  `ApcGrid`'s bank-aware write. CC53 on the Dub page goes to `applyFormantCC`
  instead of the knob table. `onFxKnobCC` writes the normalized `data2/127`
  value into the active bank's stored slot and then to the selected target
  (Faust zone, LV2 port, or Sampler setter), so a knob applies immediately.

### Per-bank independent knob storage
Each bank stores its own value per physical knob position — switching banks
changes what the 8 knobs currently mean/show without touching any other bank's
stored values (`m_fxBankValues[bank][knob]`, initialized in `apc_grid.h`).

**REDESIGN (Core-3 move, superseding an earlier in-Faust 3-bank crossfade
design — see "Guitar/LofiFx bank DSP wiring" below for why that was
abandoned):** each bank's 8 knob positions have their OWN permanent target
(`FxKnobTarget` and the `k*Targets` tables in `apc_grid.cpp`): Dub's targets
are Core-1 Faust zones, Guitar's are `fx2/*` LV2 control ports on the permanent
Core-3 `guitar_lofi_fx.dsp` bundle, and LofiFx's are the bitcrush port plus the
granulator patch-morph and direct knobs. Each bank also has a SHIFT table
(`kDubShiftTargets`, `kGuitarShiftTargets`) or a SHIFT branch (Resonode for
LofiFx). All 3 chains are simultaneously, permanently live — switching banks
is a pure UI/state change (which page the physical knobs currently show/edit),
never a DSP-routing change:

| CC | Dub target | Guitar target | LofiFx target |
|---|---|---|---|
| 48 | `fx/reverb` (Faust, scale 2.0) | `fx2/FLANGEAMT` (LV2) | `fx2/BITCRUSHAMT` (LV2) |
| 49 | `fx/delay` (Faust) | `fx2/TREMOLOAMT` (LV2) | Glass patch weight |
| 50 | `fx/time` (Faust) | `fx2/BANKSPEED` (LV2) | Cloud patch weight |
| 51 | `fx/hp` (Faust) | `fx2/PHASERAMT` (LV2) | Chop patch weight |
| 54 | `fx/lpres` (Faust) | `fx2/DISTAMT` (LV2) | Shatter patch weight |
| 55 | `fx/lp` (Faust) | `fx2/VINYLAMT` (LV2) | scan rate 0–3; bottom eighth freezes |
| 57 | `fx/pitch` (Faust) | `fx2/FLUTTERAMT` (LV2) | grain density 2–200 Hz (log) |
| 53 | formant (`applyFormantCC`) | `fx2/GATEAMT` (LV2) | spray: 0–1200 cents / ±12 semitones / interval sets |

CC53 on the Dub page is handled separately by `applyFormantCC`; on the
Guitar and LofiFx pages it is the eighth knob.

**"Super music granulator" rework (LOFI feature):** LofiFx keeps
`fx2/BITCRUSHAMT` on knob 1 (CC48) as its one surviving audio-effect knob.
Knobs 2–5 (CC49/50/51/54) are the blend weights of four named grain
patches — Glass, Cloud, Chop, Shatter — each a full point in
grain-size/density/pitch-spray/position-jitter/scan-rate/reverse-probability/envelope-shape/live-source/live-tone space. `applyGranulatorMorph`
forms the convex blend and calls `Sampler::setGrainPatch`, falling back to
Glass when all four weights are zero. Knobs 6–8 (CC55/57/53) are direct
controls: scan rate 0–3 with the bottom eighth (v01 <= 0.125) engaging
freeze; grain density 2–200 Hz on a log taper; and a spray dial whose bottom
half is 0–1200 cents of continuous spray, middle band ±12 semitones of grain
transposition (`setGrainTransposeCents`), top eighth selects a pitch-quantize
interval set (`setGrainPitchQuantize`). Freeze (`Sampler::setGrainFreeze`)
holds the live ring snapshot and draws every grain from it; turning the
scan-rate dial back up releases it. Reverse probability is a field of each
named patch, not a separate knob and not a `Sampler::setReverseProbability`
API. `VINYLAMT` and `FLUTTERAMT` are not dropped: they are Guitar-bank targets
(CC55 and CC57 on that page).

**Granulator / Resonode gesture:** a plain tap on lofi-fx (note 69) toggles the
granulator (`m_granulatorLatched` -> `Sampler::setGranulatorEnabled`) and also
selects the LofiFx page. Holding SHIFT while pressing lofi-fx instead toggles
Resonode (`toggleResonodeEngage`), which releases all Resonode voices when
disengaged and turns the granulator off when engaged. The LofiFx knob page
follows SHIFT on the last lofi-fx press (`m_lofiShiftMode = m_shift`), not
whether Resonode is engaged: a plain tap shows the granulator page even while
Resonode stays on. SHIFT held while pressing any bank selects that bank's SHIFT
page until the bank is pressed again without SHIFT (`m_dubShiftMode`,
`m_guitarShiftMode`, `m_lofiShiftMode`).

### SHIFT pages
- Dub: `fx/dubgate/amt`, `fx/dubgate/pattern`, `fx/dublfo/rate`, `depth`,
  `shape`, `target`, `phase`; knob 8 unused.
- Guitar: filter attack/decay/sustain/release and amp attack/decay/sustain/release
  (`SamplerFilter*`/`SamplerAmp*` targets).
- LofiFx / Resonode: knob 1 is `fx/resonode/input` (0 = keys self-sounding,
  1 = live signal only); knobs 2–5 are the four named material patches
  Percussive, Metal/Glass, Strings, Dance Bass blended by
  `applyResonodePatchMorph`; knobs 6–8 are direct ranges `fx/resonode/tone`
  200–18000 Hz (log), `fx/resonode/level` 2–60 (log), `fx/resonode/couple`
  0–1 (linear). With Resonode engaged the keybed drives up to four Resonode
  voices (`kResonodeVoices = 4`), bound as `fx/resonodevoice<N>/note|gate|vel`.
  See `docs/manual.html` and `docs/CONTROLS.md`.

### guitar-fx's dual gesture
guitar-fx is the one bank button with a second, independent gesture layered on
top of plain tap-to-select:
- **Plain tap** (press+release, no looper pad pressed in between) selects the
  Guitar bank exactly like dub-fx/lofi-fx. The bank-select actually fires on
  PRESS (not release) — same shape as the main pad grid's ARM/FINISH, which
  also commits on press while a separate flag suppresses only the matching
  release.
- **Hold guitar-fx + press a looper pad** instead toggles that looper's
  sidechain-pump SOURCE designation (`ApcGrid::onSidechainLooperToggle`) — the
  press is redirected entirely away from the normal ARM/FINISH pad dispatch
  (never touches `m_looperHeld`/hold-erase timing at all). Toggle, not set:
  press again while still held to remove it. **Multiple loopers can be
  sidechain sources simultaneously.** The designation persists after guitar-fx
  is released (not cleared on release), and auto-clears if that looper is
  erased (per-looper hold-erase) or a clear-all fires (`cmd/clearall`) — both
  paths confirmed by reading `apc_grid.cpp` (the erase and clear-all branches
  each explicitly reset `m_looperIsSidechainSource`).
- `looperIsSidechainSource(int)` is the read accessor. The ducking/pump signal
  itself IS now wired at the DSP level (see "Sidechain-pump DSP routing"
  below) — a designated source looper's own level telemetry drives a shared
  ducking envelope applied to every OTHER looper's output.

### Guitar/LofiFx bank DSP wiring — LANDED (Core-3 redesign)
**Superseded design, kept here for history:** an earlier iteration of this
feature made `dsp/effects_runtime.dsp` compute all 3 banks' effect chains
every block and blend them via an 8th `fx/bank` Faust zone (a continuous
`si.smoo`-smoothed triangular crossfade). **WITNESSED live on a real Pi 4:**
Faust has no runtime branching — `select2`/crossfade math chooses among
ALREADY-COMPUTED signals, it never skips computing the other banks — so this
design computed guitar+lofi-fx's 8 effects on Core 1 continuously regardless
of which bank was "selected," a real ~7 percentage-point `core_busy`
regression (23%→30%) that caused audible continuous audio dropouts. Confirmed
via a real CI-built pre-feature baseline (zero xruns) vs the crossfade build
(continuous dropouts), and via a second isolated A/B test reverting only that
file.

**Current, landed design:** `dsp/effects_runtime.dsp` is restored to its
pre-feature dub-only chain (`pitchStage : delayStage : reverbStage :
microStage <: (filterStage, _)`) — Core 1's cost is back to its original
budget. Guitar+lofi-fx's 8 effects moved to their own standalone Faust
program, `effects/home/faust/guitar_lofi_fx.dsp`, compiled by CI
(`.github/workflows/build-lv2.yml`'s `guitar-lofi-fx-lv2` job) into its own
LV2 bundle under `/effects/home`, and hosted in-process on Core 3 (previously
fully idle) via a SECOND, PERMANENT `Lv2Host` instance (`audio_thread.cpp`'s
`homeFx`, distinct from the existing swappable `userFx`) — running in series
after Core 1's full dub-chain output, every block, unconditionally:
`homeFx.process(fout.data(), N); userFx.process(fout.data(), N);`. Per the
confirmed design, this is a genuinely free capacity win, not a
redistribution: all 3 banks' effects are now simultaneously, permanently
active (never gated by bank selection), matching "Both guitar and lofi-fx
always stack together with dub."

- `guitar_lofi_fx.dsp`'s chain: `flanger -> tremolo -> phaser -> distortion ->
  bitcrush -> vinyl -> flutter -> gate`, each stage reading its own permanent
  `fx2/*` zone directly (no shared-zone reinterpretation). The bundle exposes
  ten `fx2/*` zones, including `fx2/GATEPHASE` and the shared `fx2/BANKSPEED`.
- `Lv2Host::setControl(symbol, value)` (new) pushes a live control value into
  every loaded plugin's matching LV2 port by symbol — `ApcGrid::onFxKnobCC`
  calls this for every Guitar/LofiFx knob whose target is `FxKnobKind::
  Lv2Control` (see the per-bank target table above), the same way it calls
  `ParamStore::setByName` for Dub's Faust zones.
- `effects/home/faust/distortion.dsp` is wired to CC54/`fx2/DISTAMT` and the
  gate stage to CC53/`fx2/GATEAMT`; CC57 is `fx2/FLUTTERAMT`. There is no
  `fx2/COMPRESSAMT` zone in the shipped bundle.
- Verified via `dsp_cli`: `guitar_lofi_fx.dsp` compiles clean, exposes
  ten `fx2/*` zones, byte-exact passthrough at all
  defaults, and audibly engages when driven (flange+bitcrush test case).
  CI-built and confirmed green (`guitar-lofi-fx-lv2` artifact uploads
  alongside the existing `home-fx-lv2` job).

### Sidechain-pump DSP routing — LANDED
`dsp/loop.dsp`'s `oneLooper` gained a 7th `process()`-level signal input,
`sidechainEnv` — broadcast identically to all 20 loopers via the same
par()-duplication-avoidance technique as `masterPhase`/`masterLen`/
`effSpeed`/`clearAll` (confirmed safe scaling from 6 to 7 signal inputs via a
standalone Faust repro this session, no zone duplication, correct per-
instance broadcast) — plus a per-looper `sidechainsrc` checkbox (safe as a
per-instance UI control, unlike the shared broadcast signal). `audio_thread.cpp`
computes `sidechainEnv` each block as the max/peak of every currently-
source-designated looper's own `level` telemetry (one-block-lag, same
staleness class already accepted for `prevFiltIn`/`prevLoopSum`'s own
one-block-lag folds). Ducking: `out = loopSig * playN * volN * duckGain`,
where `duckGain = 1.0 - sidechainEnv*(1.0-isSourceN)` — a source looper's own
`isSourceN` gates the duck factor back to 1 so it is never ducked by its own
signal. Verified via a standalone Faust repro isolating the exact formula: a
non-source looper's RMS dropped under a full-envelope step while a source
looper's RMS stayed byte-identical to its unducked value under the identical
step.

## Link / transport
Ableton Link tempo/phase drives the loop grid; loop record start quantizes to the
Link phase; the first loop can propose the tempo to the session (ported logic).

Every one of these behaviors is the *ported looper logic* — same code, same
result. `docs/manual.html` is the printable control manual that follows the
shipped code; `effects/home/faust/param_mapping.md` still records an older
control-plane normalization for formant (range 1, or 3 with SHIFT). The bank
tables above are taken from `kDubTargets`/`kGuitarTargets`/`kLofiFxTargets` in
`src/control/apc_grid.cpp` and the SHIFT tables alongside them. The
`config/controls.conf` file is deliberately tiny: the pad/knob decoding lives
in `ApcGrid` and `midi.cpp`, not in the flat map.
