#!/bin/sh
set -eu
cd "$(dirname "$0")"
pass=0; fail=0
for t in test-irq-affinity test-rt-jitter test-usb-latency test-link-glitch test-ap-multicast; do
    echo "=== $t ==="
    if sh "./$t.sh"; then pass=$((pass+1)); else fail=$((fail+1)); fi
    echo
done
echo "=== SUMMARY: $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
