#!/bin/sh

set -eu
log() { echo "[rt-tune] $*"; }

AUDIO_CORES="1 3"
CONTROL_CORE="2"

for CPU_N in 0 1 2 3; do
    GOV_PATH="/sys/devices/system/cpu/cpu$CPU_N/cpufreq/scaling_governor"
    tries=0
    while [ ! -w "$GOV_PATH" ] && [ "$tries" -lt 20 ]; do
        sleep 0.1
        tries=$((tries + 1))
    done
    if [ -w "$GOV_PATH" ]; then
        echo performance > "$GOV_PATH"
        applied=$(cat "$GOV_PATH" 2>/dev/null || echo "unreadable")
        if [ "$applied" = "performance" ]; then
            log "cpu$CPU_N governor -> performance (confirmed, ${tries}00ms wait)"
        else
            log "WARNING: cpu$CPU_N governor write succeeded but readback shows '$applied', not performance"
        fi
    else
        log "WARNING: cpu$CPU_N has no cpufreq/scaling_governor after 2s wait -- governor NOT pinned, schedutil's own periodic bookkeeping may still stall this core"
    fi
done
for core in $AUDIO_CORES; do
    for st in /sys/devices/system/cpu/cpu$core/cpuidle/state*/disable; do
        [ -w "$st" ] && echo 1 > "$st" || true
    done
done
log "governor=performance, deep C-states disabled on cores: $AUDIO_CORES"

CONTROL_MASK=$(printf '%x' $((1 << CONTROL_CORE)))
for irq in /proc/irq/*/; do
    n=$(basename "$irq")
    name=$(cat "$irq/../$n/spurious" 2>/dev/null || true)
    if grep -qiE 'brcmfmac|rtl8723bs|mmc|dwc2|eth|wlan|xhci' "/proc/irq/$n/"* 2>/dev/null; then
        echo "$CONTROL_MASK" > "/proc/irq/$n/smp_affinity" 2>/dev/null || true
    fi
done
awk '/brcmfmac|rtl8723bs|dwc2|mmc|xhci|eth/{gsub(":","",$1); print $1}' /proc/interrupts 2>/dev/null | while read -r n; do
    echo "$CONTROL_MASK" > "/proc/irq/$n/smp_affinity" 2>/dev/null || true
done
log "network/USB IRQs steered to control core $CONTROL_CORE (mask $CONTROL_MASK)"

echo -1 > /proc/sys/kernel/sched_rt_runtime_us 2>/dev/null \
    && log "sched_rt_runtime_us -> unlimited (RT throttle disabled)" \
    || log "WARNING: could not disable sched_rt_runtime_us"

ulimit -r 95 2>/dev/null || true
ulimit -l unlimited 2>/dev/null || true

log "RT tuning applied. aloop audio threads will run SCHED_FIFO pinned to cores: $AUDIO_CORES"
