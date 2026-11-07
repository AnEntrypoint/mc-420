# Parameter mapping — CC/note → normalized → chain constant

The looper's effect params arrive as MIDI CC/note values and are normalized before
reaching the DSP. `effects/home/faust/chain.dsp` declares the chain constants
(SEMIS/FORMANT/ENGAGED/DELAYAMT/REVAMT/TIME/DIV/MLB/HPCUT/LPCUT/LPRES/LPSLOPE) as
compile-time values; the shipped runtime chain `dsp/effects_runtime.dsp` exposes the
same labels as `hslider`/`checkbox`/`nentry` UI controls so `targetToZone`
(`src/dsp/audio_thread.cpp:157`) can set them live. The normalization below is the
control-plane mapping: `src/control/midi.cpp` (the flat `config/controls.conf`
bindings and the eight intercepted fx-knob CCs) and `src/control/apc_grid.cpp`
(`ApcGrid::onFxKnobCC`, `applyFormantCC`, and the `k*Targets` bank tables). On the
Dub page the knob CCs feed the zones below; on the Guitar and LofiFx pages the same
CCs feed different targets (see `docs/COMMAND-SURFACE.md`).

| Knob | MIDI source | Normalization (C++) | Chain param |
|------|-------------|---------------------|-------------|
| HP cutoff | CC51 | `data2/127` | HPCUT ∈ [0,1] |
| LP resonance | CC54 | `data2/127` | LPRES ∈ [0,1] |
| LP cutoff | CC55 | `data2/127` | LPCUT ∈ [0,1] |
| LP slope | CC56 | `data2/127` -> `fx/lpslope`; 0 = 12 dB/oct, 1 = 24 dB/oct | LPSLOPE ∈ [0,1] (`si.smoo`) |
| Reverb amount | CC48 (Dub page) | `data2/127` scaled by 2.0 (`kDubTargets[0]`, `apc_grid.cpp:880`) | REVAMT ∈ [0,2] (`dsp/effects_runtime.dsp:11`) |
| Delay amount | CC49 | `data2/127` | DELAYAMT ∈ [0,1] |
| Time | CC50 | `data2/127` | TIME ∈ [0,1] |
| Formant depth | CC53 (Dub page) | `ApcGrid::applyFormantCC` (`apc_grid.cpp:864`): deadzone data2∈[60,68]→0; else `((data2-64)/63)*1.5` clamped to ±3. SHIFT does not expand it. Applies only while live pitch is on, in multi-key mode, or while a pitch-lock key is held | FORMANT ∈ [-3,3] (`dsp/effects_runtime.dsp:14`) |
| Pitch semitones | keybed note (ch1) | note → `fx/xpose<N>/note` (`apc_grid.cpp:793`); the poly pitch-lock shift is `targetNote - heldDetNote` (`multitranspose.dsp:99`), not `note-60` | SEMIS is `fx/pitch` plus `fx/pitchbend` (`audio_thread.cpp:758-763`). |
| " | mod wheel CC1 | deadzone 59-69 → `fx/pitchbend_engaged`=0 and `fx/pitchbend`=0; else `(data2-64)*12/63` → `fx/pitchbend` (`apc_grid.cpp:584`); returns early in multi-key mode and when live pitch is off | added to SEMIS |
| " | CC52 | `(data2/127)*24-12` → `fx/pitchbend` (`apc_grid.cpp:597`); returns early in multi-key mode and when live pitch is off | added to SEMIS |
| Pitch scale | (derived) | `pow(2, semitones/12)` | (computed in pitch.dsp) |
| Engaged | `fx/pitchbend_engaged` (`audio_thread.cpp:760-764`) | boolean: >0.5 → 1.0f, else 0.0f | ENGAGED ∈ {0,1} |
| Microrepeat div | notes 82-86 | latched → {1,2,4,8,16}; note-off clears | DIV |
| masterLoopBlocks | Link / loop grid | `masterLen / N` (or Link-driven 4-beat length in blocks when no take) → `mlbZone` (`audio_thread.cpp:826,832`) | MLB |
| THRU/LOOP/MIX vol | CC (base 0x08) | `value/63` (looper parity reference) | no shipped stage: no mix bus in `chain.dsp` and no such binding in `config/controls.conf` |
| INPUT/OUTPUT gain | CC | `value/127` → codec (looper parity reference) | no shipped stage: no codec gain binding in `src/` |

Defaults (the passthrough state): HPCUT=0, LPCUT=1, LPRES=0, LPSLOPE=0, REVAMT=0,
DELAYAMT=0, TIME=0.5, FORMANT=0, SEMIS=0, ENGAGED=0, DIV=0, MLB=0 — these match
`chain.dsp:3-13` and `filters.dsp:48-51`. The byte-exact passthrough (maxAbs=0) is a
recorded witness, not re-run here; there is no THRU/LOOP/MIX default in the shipped
chain.
