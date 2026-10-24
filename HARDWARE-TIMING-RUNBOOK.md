# Hardware timing runbook

Status: written offline, not yet run. Every step is untested on the 420. Run it only with the device plugged in, the Focusrite loopback attached (ADR-029), and the netboot sha confirmed with `health`.

## Preconditions

- Pi 4 at `192.168.137.132` (see AGENTS.md "Finding the device"). Confirm the served binary sha before any witness: a stale binary makes every result meaningless.
- Clean ingress is the Focusrite loopback. A bare AIR 192 reads silent, and any witness through `snd-aloop` is invalid.
- Telemetry is query-only: UDP `status` to `192.168.137.132:4445`. Never read a cached telemetry file.
- Restart aloop between scenarios: `rc-service aloop restart`.
- SSH uses `SSH_ASKPASS` with JS `ssh2` or the pattern in AGENTS.md, never `ssh.exe` or `sshpass`.

## Step 1: first-loop origin is the press (timing-origin-sample-exact, timing-origin-at-arm-press)

1. Start from a fresh restart with no loops.
2. Inject the record press with `node test/hardware/midi-inject.js 192.168.137.132 note-on <record-note> <velocity>`. Get `<record-note>` from the record pad constant in `src/control/apc_grid.h` before the run. Do not reuse `kApcBtnRec` (0x5D): `src/control/midi.cpp` binds it to clip export. Send a second press to finish.
3. Capture the Focusrite loopback with `tools/loopback-witness/loopback-witness.js`.
4. Pass: the first loop's wrap sits on the Link beat-0 origin, and that origin equals the press sample. Compare against the UDP `status` reply's `master_phase_beats` read at the same moment (wire keys verified at `src/control/telemetry.cpp:135`: `grid_beat_index`, `master_phase_beats`, `master_len_samples`, `recorded_beats`).
5. Fail: any sample offset between the press and the origin. Record the offset in the row. Do not adjust the threshold.

## Step 2: late press takes the earlier boundary (timing-late-press-one-beat)

- Scenario A: a 4.5-beat take on a 4-beat phrase must finish at 4 beats.
- Scenario B: a 5.5-beat take must finish at 6 beats.
- Pass: both within one sample of the target. Fail: any other length.

## Step 3: far-extend is capped at one phrase (timing-far-extend-phrase-cap)

- A 6-beat take on a 4-beat phrase must end at 4 beats, not 8.
- Pass: the loop length in `status` is 4 beats.

## Step 4: fold ladder (timing-fold-ladder)

- For phrase 4 beats, takes of 4, 2, 1 beats must each land on a ladder step.
- A 3-beat take must snap to 4 beats or 2 beats per the nearest-step rule, and the result must match the simulator (`tools/loop-quantization-sim/loop-quantum-fold.js`).

## Step 5: status responder on 20813 (esp-status-port-20813-consumers)

- Run `node test/hardware/link-mesh-status.js` with the ESP peer attached.
- Pass: a JSON status reply on 20813. TTMP on 20812 is unaffected.

## Step 6: empty slave adopts a peer recording (timing-empty-slave-adoption)

- Not runnable yet. The device guard has not landed (see the row). Do not run this step against a device on which it is not implemented.

## Two-device sync (regression)

- `node test/hardware/verify-two-device-sync.js 192.168.137.132 600000`
- Pass per AGENTS.md "TWO-DEVICE LINK SYNC UP": peer over 95 percent post-acquisition, bpm spread at most 0.05, phase error at most 0.03 beats, eff_speed spread at most 0.005, gaps at most 10 percent.

## Recording the result

- Put each run's numbers in `docs/measurements-archive.md` under the row's anchor. Do not write numbers into this runbook.
- Close a row only on a witness recorded in the ledger from a session other than the resolver's.
