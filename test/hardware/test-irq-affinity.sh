#!/bin/sh
set -eu
AUDIO_CORES_MASK_1_AND_3=0xa
bad=0
for irq in /proc/irq/*/; do
    n=$(basename "$irq")
    if grep -qiE 'brcmfmac|dwc2|mmc|xhci|eth|wlan' "/proc/irq/$n/"* 2>/dev/null; then
        aff=$(cat "/proc/irq/$n/smp_affinity" 2>/dev/null || echo 0)
        affinity_intersects_audio_cores=$(( 0x$aff & AUDIO_CORES_MASK_1_AND_3 ))
        if [ "$affinity_intersects_audio_cores" -ne 0 ]; then
            echo "  IRQ $n (net/usb) is on an audio core: mask=$aff"; bad=1
        fi
    fi
done
if [ "$bad" -eq 0 ]; then echo "PASS: no net/USB IRQ on the audio cores"; exit 0
else echo "FAIL: some net/USB IRQ lands on an audio core — rt-tune.sh affinity did not take"; exit 1; fi
