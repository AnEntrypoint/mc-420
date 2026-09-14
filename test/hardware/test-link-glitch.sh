#!/bin/sh
set -eu
DURATION="${DURATION:-600}"
echo "[link-glitch] sampling aloop telemetry xrun counter for ${DURATION}s with Link over WiFi..."
X0=$(cat /run/aloop/xruns 2>/dev/null || echo 0)
sleep "$DURATION"
X1=$(cat /run/aloop/xruns 2>/dev/null || echo 0)
XRUNS=$((X1 - X0))
echo "[link-glitch] xruns over ${DURATION}s with Link active = ${XRUNS}"
if [ "$XRUNS" -le 1 ]; then echo "PASS: no Link-induced glitching (bare-metal had ~1/s)"; exit 0
else echo "FAIL: ${XRUNS} xruns — investigate Link TX / IRQ affinity"; exit 1; fi
