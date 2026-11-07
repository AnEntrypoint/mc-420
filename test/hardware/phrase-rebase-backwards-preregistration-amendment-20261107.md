# Amendment 2026-11-07 to the backwards phrase rebase on-device pre-registration

**NOT RUN. The on-device window stays HELD.** This is a dated amendment document
only. It does not execute or approve any step of
`test/hardware/phrase-rebase-backwards-on-device-preregistration.md`, and it
does not change, lower, substitute, add or reinterpret any threshold in that
file. No device contact, no flash, no polls, no row changes.

Owner ruling (orchestrator-86, 2026-11-07): "don't edit
test/hardware/phrase-rebase-backwards-on-device-preregistration.md. Record the
stale citation and the wording change in a separate dated amendment file, and
leave every threshold alone. The on-device window stays held."

The pre-registration is left byte-for-byte unchanged. Its sha256 at this
amendment is `91f97342a8ecf6973a53026b2a7a11545d3b71fe6969f65648399292e43b2ee5`.
The model clause now shipped in mc-420 is commit
`75042d438d5e845514d156aea15a7fb86dbe5133`; the shipped ESP guard is esp main
`745d61a`, rebased to `1755ba6`.

## 1. Stale citation, recorded

The pre-registration's "What is already witnessed offline (model clause only)"
paragraph (lines 13-18) and its "Preconditions" bullet (line 24) name esp main
`9a832667`. That guard is no longer the shipped one. ESP `745d61a` added a
backwards-rebase branch to `main/phrase_boundary_guard.h
stepPhraseBoundary`: on `currentPhraseNumber < lastPhraseNumber` the guard now
re-adopts the lower phrase number. Before that branch it kept the stale high
number, so every forward boundary after a rebase was suppressed; that was the
one-step lag the owner watched on the ESP side. The ESP host witness
`tools/phrase_boundary_guard_witness.cpp` now reports 18 checks, 0 failed.

## 2. Wording change, recorded (old text -> text that now applies)

- Line 14: "esp guard `main/phrase_boundary_guard.h` from esp main 9a832667"
  -> "esp guard `main/phrase_boundary_guard.h` from esp main 745d61a
  (rebased 1755ba6)".
- Line 15: "(baseline capture; current > last emits; a decrease keeps the old
  last)" -> "(baseline capture; current > last emits; current < last re-adopts
  the lower phrase number)".
- Line 16: "1344/1344 cases clean, 8/8 shipped-guard host vectors, 376
  backwards" -> "1344/1344 cases clean, 11/11 shipped-guard host vectors, 376
  backwards". The extra vectors cover re-adopting the lower number and emitting
  the next forward boundary after a rebase.
- Lines 17-18: "`--no-fix` (direction-blind `!=` rule) fails 376/376 cases"
  stays as written. The model gained a second negative control,
  `--stale-hold`, which reproduces the pre-745d61a one-step lag: at the owner's
  bpm=120 rb=3 grid the stale-hold arm holds back all post-rebase forward
  boundaries while the shipped arm resumes them.
- Line 24: "esp main 9a832667 (or later) flashed with the shipped guard" ->
  read "or later" as esp main 745d61a / 1755ba6. The witness script path
  `tools/phrase-boundary-guard-witness.sh` is unchanged.
- Line 76: "the same judge on the pre-guard `!=` rule (esp main before
  9a832667)" is a historical marker for the direction-blind rule and stays as
  written; it is not a citation of the shipped guard.
- The sim's own header line and the "on-device verification is held" line now
  name 745d61a / 1755ba6 instead of 9a832667.

## 3. Thresholds left exactly as registered

Every bullet under "Preconditions fixed now", "Steps to observe the backwards
rebase, fixed now" and "Pass gate, fixed now (ALL must hold)" (lines 21-78),
including "ZERO phrase-boundary events and ZERO SPP emissions at the rebase
instant and for the following 1.5 s", "Exactly TWO forward boundaries per
128-beat post-rebase window, each with SPP units % 256 == 0", "Exactly ONE
rebaseSeq bump per impose", "the gap must be <= 1e-3 beats at every rb",
"xruns flat and latency_bias_samples within 16 samples", and the negative
control rule, is untouched. "A FAIL is a FAIL; no threshold is lowered or
reinterpreted after results." The on-device clause is HELD and this amendment
does not close the row `.gm/prd/pi-phase-rebase-backwards-phrase-jump.yml`.

## 4. Conflict recorded for the owner, not resolved here

The shipped ESP guard now re-adopts a lower phrase number on a backwards
rebase, while the pre-registered pass gate (line 63) still says "ZERO
phrase-number decreases adopted by the guard; `s_last_phrase_number` keeps the
higher value after the backwards jump". Those two statements describe different
guards. Per the owner ruling no threshold is edited here; the conflict is
recorded so it can be ruled on before any quiet window is approved. Nothing
runs until the owner explicitly approves that window.
