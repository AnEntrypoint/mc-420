#!/bin/sh

set -eu

IFACE="eth0"
ROOT="/srv/tftp/aloop-netboot"
SERVER="192.168.137.1"
NET="192.168.137.0"
MODE="standalone"

usage() {
  cat <<'USAGE'
usage: sudo image/serve-netboot.sh [--iface IFACE] [--root DIR] [--server IP] [--net NET] [--proxy]

  --iface    interface cabled to the Pi           (default eth0)
  --root     the netboot root (build-netboot.sh)  (default /srv/tftp/aloop-netboot)
  --server   this host's IP on that link          (default 192.168.137.1)
  --net      the LAN network                       (default 192.168.137.0)
  --proxy    proxy DHCP instead of standalone (another DHCP server leases)

Build the netboot root with a matching NETBOOT_SERVER so its cmdline HTTP URLs
point back here:  NETBOOT_SERVER=<--server> image/build-netboot.sh

Leave it running; watch the log for the Pi's DHCPACK -> TFTP GETs -> HTTP GETs
of modloop/apkovl. Ctrl-C stops everything.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --iface)  IFACE="$2"; shift 2 ;;
    --root)   ROOT="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --net)    NET="$2"; shift 2 ;;
    --proxy)  MODE="proxy"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v dnsmasq >/dev/null || { echo "dnsmasq not installed (apt-get install dnsmasq)"; exit 2; }
command -v python3 >/dev/null || { echo "python3 needed for the HTTP root server";        exit 2; }
[ -d "$ROOT" ] || { echo "netboot root not found: $ROOT (run image/build-netboot.sh first)"; exit 2; }
[ -f "$ROOT/start4.elf" ] || { echo "netboot root looks wrong: no start4.elf in $ROOT"; exit 2; }

if [ "$MODE" = "standalone" ]; then
  BASE="$(echo "$NET" | sed 's/\.0$//')"
  DHCP="--dhcp-range=${BASE}.50,${BASE}.150,255.255.255.0,1h --dhcp-boot=bootcode.bin"
  echo "[serve] STANDALONE DHCP on $IFACE (${BASE}.50-.150) — ensure NO other DHCP server leases here"
else
  DHCP="--dhcp-range=${NET},proxy"
  echo "[serve] PROXY DHCP on $IFACE for $NET (another DHCP server must lease the Pi)"
fi

cleanup() { kill "$HTTP_PID" 2>/dev/null || true; kill "$DNS_PID" 2>/dev/null || true; }
trap cleanup INT TERM EXIT

start_http_root_server() {
  ( cd "$ROOT" && exec python3 -m http.server 8080 --bind "$SERVER" ) >/tmp/aloop-http.log 2>&1 &
  HTTP_PID=$!
}

start_http_root_server
echo "[serve] HTTP root  http://$SERVER:8080/  (apks / modloop-rpi / apkovl)"

start_dhcp_and_tftp() {
  # shellcheck disable=SC2086
  dnsmasq --keep-in-foreground --log-dhcp \
    --interface="$IFACE" --bind-interfaces --except-interface=lo \
    --dhcp-authoritative \
    $DHCP \
    --dhcp-vendorclass=set:rpi,PXEClient \
    --dhcp-option-force=tag:rpi,43,"Raspberry Pi Boot" \
    --enable-tftp --tftp-root="$ROOT" --tftp-no-fail \
    --port=0 >/tmp/aloop-dnsmasq.log 2>&1 &
  DNS_PID=$!
}

start_dhcp_and_tftp
echo "[serve] TFTP root: $ROOT   (Pi requests under <serial>/ — auto-linked below)"
echo "[serve] watching for the Pi's DHCP + TFTP + HTTP — Ctrl-C to stop"
echo "[serve] ------------------------------------------------------------"

make_served_tree_world_readable() {
  chmod -R a+rX "$ROOT" 2>/dev/null || true
}

make_served_tree_world_readable

serial_from_tftp_log() {
  grep -oE 'file /[^ ]*/[0-9a-f]{8}/start4\.elf' /tmp/aloop-dnsmasq.log 2>/dev/null \
         | grep -oE '/[0-9a-f]{8}/' | tr -d / | head -n1 || true
}

link_serial_tftp_dir() {
  ( cd "$ROOT" && mkdir -p "$1" && for f in *; do
        [ "$f" = "$1" ] && continue; ln -sf "../$f" "$1/$f"; done )
}

watch_for_serial_tftp_requests() {
  SEEN=""
  while kill -0 "$DNS_PID" 2>/dev/null; do
    SER="$(serial_from_tftp_log)"
    if [ -n "$SER" ] && [ "$SER" != "$SEEN" ] && [ ! -e "$ROOT/$SER" ]; then
      link_serial_tftp_dir "$SER"
      echo "[serve] created per-serial TFTP dir $SER/ -> root (Pi will re-fetch)"
      SEEN="$SER"
    fi
    tail -n 3 /tmp/aloop-dnsmasq.log 2>/dev/null | grep -E 'DHCPACK|tftp:' || true
    sleep 3
  done
}

watch_for_serial_tftp_requests
