#!/bin/sh

set -eu
KVER="${KVER:-6.12}"
ARCH=arm64
CROSS="${CROSS:-aarch64-linux-gnu-}"

echo "[rt-kernel] building PREEMPT_RT kernel $KVER for Pi4 ($ARCH)"

cat > rt.fragment <<'FRAG'
CONFIG_PREEMPT_RT=y
CONFIG_HIGH_RES_TIMERS=y
CONFIG_NO_HZ_FULL=y
CONFIG_RCU_NOCB_CPU=y
CONFIG_CPU_ISOLATION=y
CONFIG_HZ_1000=y
# USB gadget for f_uac2:
CONFIG_USB_CONFIGFS=y
CONFIG_USB_CONFIGFS_F_UAC2=y
CONFIG_USB_DWC2=y
CONFIG_USB_DWC2_PERIPHERAL=y
# Sound + gadget audio:
CONFIG_SND_USB_AUDIO=y
FRAG

echo "[rt-kernel] config fragment written (rt.fragment):"
cat rt.fragment
echo "[rt-kernel] (CI runs: defconfig + merge fragment + make Image modules dtbs)"
