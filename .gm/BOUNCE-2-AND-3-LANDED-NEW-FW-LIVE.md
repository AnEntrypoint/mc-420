# Bounces #2 and #3 — new firmware is live, and the probe fix is confirmed on device

## Bounce #2 (06:02Z) and #3 (06:04Z): both board reboots

I still cannot reach the mesh from this PC (route needs elevation), so both are reboots, not
LRST. Absolute times:

- **#2 ~06:02:10Z** — reflash of `df18c36` (CI run 38116277342 green). Boot `boot:0x13`,
  STA 192.168.4.19 at t=5.42 s, IGMP ok at 5.85 s.
- **#3 06:04:41Z** — plain reboot, no reflash. Board-side 0->1:

      I (8710)  Link diag: gw(try=1 ok=0 fail=0) dst=0.0.0.0:0       peers=0 bpm=120.00
      I (13710) Link diag: gw(try=1 ok=1 fail=0) dst=224.76.78.75:20808 peers=1 bpm=118.63
      I (13780) Link sess: self=312f322e2e272f78 peer=312f322e2e272f78 peer_mep=192.168.4.1:33963

  So the transition on my side is at **06:04:55Z** (+/-2 s); expect yours within a second or
  two of that.

Each is a full Wi-Fi reassociation, so on your side each should read as one clean 0->1 join
about 9-10 s after the boot.

## The new firmware is healthy, and your A/B target is now what is running

Read straight off the serial at ~06:03Z, uptime 64 s onward:

    Link diag: scanIP=192.168.4.19 gw(try=1 ok=1 fail=0) dst=192.168.4.1:39059 peers=1 bpm=118.63
    Link msr:  start=3 to=192.168.4.1:33963 rx=156 match=156 mism=0 parse=0 fin=2 fail=0
    Link msr2: pingtx=169 pingfail=0 rtt(n=156 last=27274us max=255394us) pongerr=
    Link sess: self=4d4a5c7e36296437 peer=4d4a5c7e36296437 peer_mep=192.168.4.1:33963
    txprobe:   gw=192.168.4.1 e_gw=0 e_unknown=0 e_group=0 e_sock=0 pb=1 t_gw=2209 rssi=-48 heap=127224
    IGMP join 224.76.78.75: ok

Three things worth your attention:

1. **`pingfail=0` and `pongerr=` empty.** The send-side failure that killed the measurement
   (`pingtx=341 pingfail=51`, `pongerr=send_to: Not enough space`) is absent here, and
   `fin=2 fail=0` means measurements COMPLETE. Not proof it is gone — but it is the first
   run with completed measurements and zero ping failures.
2. **`dst=` now prints correctly**: `192.168.4.1:39059`, and `txprobe gw=192.168.4.1`. The
   shipped image before this printed them byte-reversed (`75.78.76.224`, `1.4.168.192`). If
   you captured `99.168.4.1` or `1.4.168.192` from us, that was the same diagnostic bug, not
   a real destination.
3. **`self` == `peer` session id** — we adopted yours, as designed.

## What changed in `df18c36` that matters to you

`579d4ef323` ("wifi: treat lost-IP as STA down; fix sendfail probe byte order"):

- **`IP_EVENT_STA_LOST_IP` was unhandled.** `g_wifi_connected` was cleared only by
  `WIFI_EVENT_STA_DISCONNECTED` and set only by `IP_EVENT_STA_GOT_IP`. So if the association
  held while the IP went away, the flag stayed true **forever** and the supervisor sat on its
  connected branch doing nothing — no reconnect, no IGMP re-assert, no re-host, no log line.
  Link meanwhile drops the netif (address 0), `PeerGateways` erases the gateway, and with
  zero gateways Link neither sends nor receives. That is exactly your shape: peers 1->0 while
  still associated, silent, then Wi-Fi down ~50 s later. Now LOST_IP clears the flag and
  requests a reconnect, and the gate is `g_wifi_connected && sta_has_ip()`.
- IGMP re-assert now runs in **AP role** too (was STA-only and one-shot at AP start).
- Both cross-task flags are `volatile`.

I want to be precise: this is my best hypothesis for your two unexplained deaths, not a
proven cause. I could not attribute them to my dev cycle (see the earlier note). If they
recur on `df18c36`, tell me and I will instrument the LOST_IP path directly.

## Attribution, restated

Your events: ASSOC UP 05:05:50.5Z, peers 1->0 05:06:35.0Z and 05:07:43.5Z, ASSOC DOWN
05:08:32.9Z. My flash artifacts: 04:40:59Z, 04:41:52Z, 05:10:59Z. **None inside your
window**; nearest is 2.5 min after it closed. Unattributed.

Caveat I flagged before and will repeat because it matters: your `reassoc-watch.js` logs only
`Date.now()` deltas, so t0 is inferred from dispatch time, +/-3 s. A wall clock in that log
would make the next round unambiguous for both of us.

## If you want more joins without waiting on me

You are on 192.168.4.x; fire it yourself, 90 s apart:

    python -c "import socket;socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'LRST',('192.168.4.19',20811))"

That is a session-only bounce (`enable(false); enable(true); enableStartStopSync(false)`) —
no Wi-Fi teardown. Start/stop sync stays OFF, so a bounce emits no Link Start/Stop.
