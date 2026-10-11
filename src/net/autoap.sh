#!/bin/sh
set -eu
IFACE="${IFACE:-wlan0}"
CONF_DIR="${CONF_DIR:-/etc/aloop-net}"
AP_IP="192.168.4.1/24"
MESH_SSID="${MESH_SSID:-ticker}"
SCAN_INTERVAL="${SCAN_INTERVAL:-15}"
STA_RETRY_LIMIT="${STA_RETRY_LIMIT:-6}"
ASSOC_WAIT="${ASSOC_WAIT:-12}"
HOLD_MAX="${HOLD_MAX:-6}"
AP_SCAN_IDLE="${AP_SCAN_IDLE:-90}"
OUTRANK_TICKS="${OUTRANK_TICKS:-3}"

log() { echo "[autoap] $*"; }

own_mac() {
    cat "/sys/class/net/$IFACE/address" 2>/dev/null || echo ""
}

mac_key() {
    echo "$1" | tr 'A-F' 'a-f' | tr -d ':-'
}

lower_key() {
    [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort | head -n1)" = "$1" ]
}

current_host_key() {
    iw dev "$IFACE" link 2>/dev/null | awk '/Connected to/ { print $3 }' | tr 'A-F' 'a-f' | tr -d ':-'
}

scan_mesh_bssid() {
    iw dev "$IFACE" scan 2>/dev/null | awk -v want="$MESH_SSID" '
        /^BSS /        { bss = $2; sub(/\(.*/, "", bss) }
        /^[ \t]*SSID: / { $1 = ""; sub(/^[ \t]+/, ""); if ($0 == want && bss != "") print bss }
    ' | tr 'A-F' 'a-f' | sort | head -n1
}

sta_associated() {
    iw dev "$IFACE" link 2>/dev/null | grep -q "Connected to"
}

has_ip() {
    ip -4 addr show dev "$IFACE" 2>/dev/null | grep -q "inet "
}

write_role_state() {
    mkdir -p /run/aloop 2>/dev/null
    printf '%s' "$1" > /run/aloop/wifi_role.tmp 2>/dev/null && \
        mv /run/aloop/wifi_role.tmp /run/aloop/wifi_role 2>/dev/null
}

join_sta() {
    pkill dnsmasq 2>/dev/null || true
    pkill hostapd 2>/dev/null || true
    pkill wpa_supplicant 2>/dev/null || true
    ip addr flush dev "$IFACE" 2>/dev/null || true
    ip link set "$IFACE" up 2>/dev/null || true
    iw dev "$IFACE" set power_save off 2>/dev/null || true
    wpa_supplicant -B -i "$IFACE" -c "$CONF_DIR/wpa_supplicant.conf" >/dev/null 2>&1 || true
    waited=0
    while [ "$waited" -lt "$ASSOC_WAIT" ]; do
        if sta_associated; then
            if udhcpc -i "$IFACE" -n -q >/dev/null 2>&1 || has_ip; then
                add_mesh_route
                write_role_state sta
                return 0
            fi
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

start_ap() {
    log "hosting mesh AP '$MESH_SSID' at $AP_IP"
    pkill wpa_supplicant 2>/dev/null || true
    pkill dnsmasq 2>/dev/null || true
    pkill hostapd 2>/dev/null || true
    _waited=0
    while pgrep hostapd >/dev/null 2>&1 && [ "$_waited" -lt 20 ]; do
        sleep 1
        _waited=$((_waited + 1))
    done
    ip addr flush dev "$IFACE" 2>/dev/null || true
    ip addr add "$AP_IP" dev "$IFACE"
    ip link set "$IFACE" up
    iw dev "$IFACE" set power_save off 2>/dev/null || true
    if ! hostapd -B "$CONF_DIR/hostapd.conf"; then
        log "hostapd failed to start on $IFACE -- no mesh AP is being hosted"
        write_role_state none
        return 1
    fi
    add_mesh_route
    write_role_state ap
    if ! dnsmasq -C "$CONF_DIR/dnsmasq.conf"; then
        log "dnsmasq failed to start -- peers can associate but will get no lease"
    fi
}

stop_ap() {
    pkill dnsmasq 2>/dev/null || true
    pkill hostapd 2>/dev/null || true
    ip addr flush dev "$IFACE" 2>/dev/null || true
    write_role_state none
}

add_mesh_route() {
    ip route replace 224.0.0.0/4 dev "$IFACE" 2>/dev/null || true
}

ap_has_clients() {
    [ -n "$(iw dev "$IFACE" station dump 2>/dev/null)" ]
}

ap_up() {
    iw dev "$IFACE" info 2>/dev/null | awk '$1 == "type" { print $2 }' | grep -qx "AP"
}

ip link set "$IFACE" up 2>/dev/null || true
MAC="$(own_mac)"
MACKEY="$(mac_key "$MAC")"
log "interface $IFACE mac=$MAC mesh_ssid=$MESH_SSID"

state=""
peer_bssid="$(scan_mesh_bssid)"
if [ -n "$peer_bssid" ] && lower_key "$(mac_key "$peer_bssid")" "$MACKEY"; then
    log "found lower-key '$MESH_SSID' host $peer_bssid — joining as STA"
    if join_sta; then
        log "joined '$MESH_SSID' as STA"
        state="STA"
    else
        log "join failed — hosting instead"
        start_ap
        state="AP"
    fi
elif [ -n "$peer_bssid" ]; then
    log "'$MESH_SSID' host $peer_bssid is higher-key than $MAC — hosting as the lowest key"
    start_ap
    state="AP"
else
    rank_hex="$(echo "$MACKEY" | tail -c 7)"
    rank="$(printf '%d' "0x${rank_hex:-0}" 2>/dev/null || echo 0)"
    hold=$(( rank * HOLD_MAX / 16777215 ))
    log "no '$MESH_SSID' — MAC-ordered host hold ${hold}s (rank=$rank)"
    waited=0
    joined=0
    while [ "$waited" -lt "$hold" ]; do
        sleep 1
        waited=$((waited + 1))
        peer_bssid="$(scan_mesh_bssid)"
        if [ -n "$peer_bssid" ] && lower_key "$(mac_key "$peer_bssid")" "$MACKEY"; then
            log "lower-key peer '$MESH_SSID' appeared during hold (bssid $peer_bssid) — joining"
            if join_sta; then
                log "joined '$MESH_SSID' as STA"
                state="STA"
                joined=1
                break
            fi
            log "join attempt failed — continuing hold"
        fi
    done
    if [ "$joined" -eq 0 ]; then
        log "hold expired, no lower-key peer '$MESH_SSID' — hosting AP"
        start_ap
        state="AP"
    fi
fi
outrank=0

retries=0
idle=0
while true; do
    sleep "$SCAN_INTERVAL"
    ip route get 224.76.78.75 >/dev/null 2>&1 || add_mesh_route
    case "$state" in
        STA)
            if sta_associated && has_ip; then
                retries=0
                hostkey="$(current_host_key)"
                if [ -n "$hostkey" ] && lower_key "$MACKEY" "$hostkey"; then
                    outrank=$((outrank + 1))
                    if [ "$outrank" -ge "$OUTRANK_TICKS" ]; then
                        log "host key $hostkey is higher than our $MACKEY for $outrank ticks — taking over as AP"
                        pkill wpa_supplicant 2>/dev/null || true
                        start_ap
                        state="AP"
                        outrank=0
                    fi
                else
                    outrank=0
                fi
                continue
            fi
            outrank=0
            retries=$((retries + 1))
            log "STA link down ($retries/$STA_RETRY_LIMIT) — reconnecting"
            if join_sta; then
                log "STA reconnected"
                retries=0
            elif [ "$retries" -ge "$STA_RETRY_LIMIT" ]; then
                log "host gone after $retries attempts — taking over as AP"
                start_ap
                state="AP"
                retries=0
            fi
            ;;
        AP)
            if ! ap_up; then
                log "AP not up on $IFACE -- restarting hostapd"
                start_ap
                idle=0
                continue
            fi
            if ap_has_clients; then
                idle=0
                continue
            fi
            idle=$((idle + SCAN_INTERVAL))
            [ "$idle" -ge "$AP_SCAN_IDLE" ] || continue
            other="$(scan_mesh_bssid)"
            idle=0
            if ! ap_up; then
                log "scan knocked $IFACE off AP mode -- restarting hostapd"
                start_ap
                continue
            fi
            [ -n "$other" ] || continue
            otherkey="$(mac_key "$other")"
            [ "$otherkey" != "$MACKEY" ] || continue
            if lower_key "$otherkey" "$MACKEY"; then
                log "lower-BSSID '$MESH_SSID' host $other exists — yielding AP and joining it"
                stop_ap
                if join_sta; then
                    log "joined lower-BSSID host as STA"
                    state="STA"
                    retries=0
                else
                    log "yield join failed — resuming AP"
                    start_ap
                fi
            fi
            ;;
    esac
done
