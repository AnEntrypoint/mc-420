#!/bin/sh
set -eu
echo "[usb-latency] device-side check: is the f_uac2 gadget PCM live?"
aplay -l 2>/dev/null | grep -i uac2 || { echo "FAIL: no UAC2 gadget PCM (is f_uac2-gadget.sh run + host connected?)"; exit 1; }
PERIOD=$(cat /proc/asound/card*/pcm0p/sub0/hw_params 2>/dev/null | awk '/period_size/{print $2}')
echo "[usb-latency] gadget playback period = ${PERIOD:-unknown} frames"
echo "PASS(device-side): gadget PCM live. Run the host-side click measurement (see HARDWARE-TESTS.md)."
