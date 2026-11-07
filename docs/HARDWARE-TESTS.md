# Hardware test runbook

Everything aloop can prove without hardware is already proven (CI is green; the
DSP is A/B-verified against looper). The tests here are the ones that need a real
**Raspberry Pi 4** — they *measure* physical timing, latency, and RF behavior
that cannot be simulated on a dev host. The five device-side shell harnesses in `test/hardware/run-all.sh` are built
and one-command runnable; the host-side click round-trip below is a MANUAL
procedure (no shipped harness). This runbook is how you run them.

## Prerequisites
- A Raspberry Pi 4 running the aloop Alpine image (`image/build-image.sh`).
- The Pi connected to a host computer via USB (so the f_uac2 gadget is active).
- A second WiFi device (phone/laptop) with a Link-enabled app, for the Link/AP tests.
- `apk add rt-tests iw` on the Pi (cyclictest + iw).

## Run everything
```sh
sh test/hardware/run-all.sh
```

## The individual tests + pass criteria

| Test | What it measures | PASS when | Historical row label |
|------|------------------|-----------|----------------------|
| `test-irq-affinity.sh` | WiFi/USB IRQs are steered off the audio cores | no net/USB IRQ maps to cores 1,3 | wifi-ap-irq-affinity |
| `test-rt-jitter.sh` | worst-case scheduling latency under load | cyclictest max < 1333 µs, 0 xruns over 10 min | rt-cyclictest-verify |
| `test-usb-latency.sh` | f_uac2 gadget PCM is present | UAC2 playback PCM enumerated and its period reported; round-trip latency is a separate host-side measurement | usb-gadget-latency-verify |
| `test-link-glitch.sh` | Link over WiFi does not glitch audio | `XRUNS -le 1` over 10 min with Link active (bare-metal had ~1/s) | link-glitch-verify |
| `test-ap-multicast.sh` | a peer can Link over the Pi's AP | AP up, `ap_isolate=0`; the mcast join is reported but NOT gated, so the peer-side tempo sync is the real witness | wifi-ap-multicast |

The rightmost column names labels from the original migration-queue plan; none
of those rows exist in `closes/` or the current `.gm/prd/*.yml` store. See
`docs/plans.md` for the live rows.

## The host-side click measurement (for USB latency)
The device-side script confirms the gadget PCM is live and reports its period;
it does NOT measure round-trip latency. That number is measured on the **host**:
play a short click into the Pi (which is a soundcard to the host), record the
Pi's output, and measure the sample offset between the sent and returned click.
Any DAW or a small `arecord`/`aplay` loopback on the host does this; the repo
ships no host-side round-trip harness (`test/hardware/usb-audio-grab.js` only
captures a WAV slice). Compare to looper's baseline.

## Where the numbers land
Each test prints PASS/FAIL + the measured value. Record numbers in
`docs/measurements-archive.md` (numbers), `docs/DECISIONS.md` (decisions) and
`docs/plans.md` (rows), with the raw output in `.gm/witness-out/`, so the tested
state is witnessed with real output, not asserted.
