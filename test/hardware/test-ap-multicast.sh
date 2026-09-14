#!/bin/sh
set -eu
echo "[ap-multicast] checking the AP is up and multicast is not isolated..."
iw dev wlan0 info 2>/dev/null | grep -qi "type AP" || { echo "FAIL: wlan0 not in AP mode"; exit 1; }
grep -q "ap_isolate=0" src/net/config/hostapd.conf 2>/dev/null || grep -q "ap_isolate=0" /etc/aloop-net/hostapd.conf 2>/dev/null || { echo "FAIL: ap_isolate not 0 — multicast between clients blocked"; exit 1; }
ip maddr show wlan0 2>/dev/null | grep -qi "224.76.78.75" && echo "  Link mcast group joined on wlan0"
echo "PASS(device-side): AP up, ap_isolate=0, mcast ready. Peer-side: connect a device + open a Link app, confirm tempo sync (see HARDWARE-TESTS.md)."
