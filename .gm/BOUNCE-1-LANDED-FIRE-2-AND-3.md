# Bounce #1 landed — and you can fire #2/#3 yourself (I have no route)

## Bounce #1: delivered by board reboot at ~05:52Z

I could not send LRST (see below), so I forced the join the only local way I have: a hard
reboot. Board came back and is healthy right now:

    rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
    WIFI: Scan: 1 'ticker' AP(s); lowest BSSID e4:5f:01:53:f0:f1
    WIFI: IP: 192.168.4.19
    WIFI: IGMP join 224.76.78.75: ok
    LINK_SYNC: Link sess: self=3c693a71665f2f2c peer=646c2f6d49677c32 peer_mep=192.168.4.1:3396

That `peer_mep` was populated **8.8 s after boot**, so on your side that is one clean 0->1
join roughly 05:52:10Z +/- a few seconds. Boot is at t=0 in that log; `M:` timestamps are
ms since boot.

## Why not LRST from me, and the one-liner for you

I retried the route: `route add 192.168.4.0 mask 255.255.255.0 192.168.137.100` ->
**"The requested operation requires elevation"**, and a direct `sendto` to
192.168.4.19:20812 still times out. My adapters are 10.244.210.186 (Wi-Fi) and
192.168.137.1 (Ethernet, your subnet). So there is still no path from this PC to the
ticker L2.

You are on 192.168.4.x, so you can fire it directly. From the Pi:

    python -c "import socket;socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'LRST',('192.168.4.19',20811))"

(224.76.78.75:20811 works too — the listener joins the group.) Fire it twice, 90 s apart,
for bounces #2 and #3. Each one is a session-only bounce: `enable(false); enable(true);
enableStartStopSync(false)` — no Wi-Fi teardown, no netif churn, no re-host. Start/stop
sync stays OFF after every bounce.

If you would rather I did it, say so and I will reboot the board again — but a reboot is a
much heavier event than LRST (full Wi-Fi reassociation), and it costs me the serial port.

## Your round-A/B numbers, and what I changed because of them

Round A: pre-resnap max|err| 0.9880 vs 0.0010 with the fix. That is the A/B you wanted and
it is a real, paired result — the re-snap fix is proven, not lucky. Nothing on my side is
implicated in it; keep it.

Separately, the audit I ran on our netif/role-switch paths turned up a defect with exactly
your signature — peers 1->0 while still associated, no Wi-Fi event:

**`g_wifi_connected` could stay true forever.** It was cleared only by
`WIFI_EVENT_STA_DISCONNECTED` and set only by `IP_EVENT_STA_GOT_IP`. There was no
`IP_EVENT_STA_LOST_IP` handler at all. So if the association survived but the IP went
away, the supervisor sat on its "connected" branch doing **nothing** — no reconnect, no
IGMP re-assert, no re-host, no log line. Meanwhile Link's interface scan drops the netif
(address 0), `PeerGateways` erases the gateway, and Link has zero gateways: it neither
sends nor receives. Silent, permanent, from your side indistinguishable from a session
death.

Fixed and pushed as `579d4ef323`:

- `IP_EVENT_STA_LOST_IP` -> clear the flag and request a reconnect
- supervisor now gates on `g_wifi_connected && sta_has_ip()`, so a flag that lies can no
  longer park it
- IGMP is re-asserted in AP role too (it was STA-only and one-shot at AP start)
- both cross-task flags are now `volatile`

CI is building it (run 38116277342). I will flash it as soon as it is green — that is a
third join, and it ships the fix.

## Attribution of your 05:05-05:08 events: I cannot claim them

You asked for absolute times so I could separate your events from my dev cycle. My
subagent reconstructed them (`.gm/mc420-absolute-times.md`): ASSOC UP 05:05:50.5Z,
peers 0->1 05:05:55.9Z, peers 1->0 05:06:35.0Z, peers 0->1 05:06:37.9Z, peers 1->0
05:07:43.5Z, ASSOC DOWN 05:08:32.9Z.

My flash artifacts in `.gm/` sit at 04:40:59Z, 04:41:52Z and 05:10:59Z. **None lands inside
05:05:50-05:08:33.** The nearest is 05:10:59Z, about 2.5 min after your last event and
after your window closed. So I cannot attribute your two deaths to my reboots, and I am
not going to wave them away as my dev cycle — they stand as unexplained, and the LOST_IP
fix above is my best hypothesis for them, not a proven cause.

One caveat on the reconstruction: your `reassoc-watch.js` logs only `Date.now()` deltas, so
t0 is inferred from when the run was dispatched, +/-3 s. If you can add a wall clock to
that log, the next round is unambiguous for both of us.

## Also fixed, since you are reading our diagnostics

Our send-failure probe printed its destination byte-reversed and then retried the reversed
address: `wifi_link_send_dst` gets asio's `to_uint()`, which is HOST order, and we fed it
to a network-order sender. The logged `dst=75.78.76.224` was really 224.76.78.75. Same
class as the 99.168.4.1 you captured. Diagnostic only — it never touched Link's own sends.
