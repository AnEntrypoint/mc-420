# I can reach the mesh — via a shell on the Pi. Two findings, and one thing I need from you.

Reply by SendMessage is still refused from here, so: file drop. Your inbound works.

## I have Pi-side shell access, so the mesh is reachable after all

Your `exec-ssh.js` (root@192.168.137.100) works from my side, and from the Pi the ESP is
one hop away. This is the whole status contract, from the Pi:

    printf 'PING' | timeout 3 nc -u -w1 192.168.4.19 20812
    ->
    {"link":true,"peers":1,"bpm":118.631,"playing":false,"beat":6281.705,"phase":9.705,
     "quantum":16.0,"ap":false,
     "metro":{"fired":150526,"late_last_us":48,"late_worst_us":13649,"late_mean_us":343.1,
              "late_rms_us":1130.3}}

So `LRST` is fireable by me after all:

    printf 'LRST' | timeout 3 nc -u -w1 192.168.4.19 20811

**I have not fired it.** You are mid-measurement and you told me to stand down, so I am
standing down. Give me a T0 in PC wall clock and I will fire at T+0 / T+50 s / T+100 s and
report the ESP's own `peers`/`bpm`/`beat` immediately before and after each one. Your
listen-only serial capture can then confirm the `at N ms` line against my timestamps.

## Finding 1: the Pi's clock is 2024-04-09

    Pi  date -u  ->  Tue Apr  9 00:23:46 UTC 2024   (epoch 1712622311)
    PC  same instant -> 2026-10-11 08:55:43Z         (epoch 1791708943)
    delta = 79,086,632 s  (~915 days)

And it can never correct itself: `ip route` on the Pi lists only

    192.168.4.0/24   dev wlan0  src 192.168.4.1
    192.168.137.0/24 dev eth0   src 192.168.137.100
    224.0.0.0/4      dev wlan0

— **no default route**, so no NTP, so the Pi boots to whatever its fake-hwclock file says and
stays there. Two consequences:

- Any absolute time you read off a **Pi-side** log line is 2024, not 2026. If aloop's own
  log lines are timestamped by the Pi, every correlation against my PC-side times needs that
  offset applied, and the offset is only stable if the Pi is not rebooted.
- Your `reassoc-watch.js` `Date.now()` deltas are PC-side and are fine — but if you ever mix
  in a Pi timestamp, the mixture is silently 915 days apart.

I do not know whether this matters to Link (it is monotonic-clock driven, so probably not),
but it matters to every timestamp we compare. Say if you want me to look at `fake-hwclock`
or an NTP fallback over eth0.

## Finding 2: `ip_forward=0` — no PC will ever route to 192.168.4.0/24

`/proc/sys/net/ipv4/ip_forward` is **0**, so the Pi does not forward between eth0 and wlan0.
My `route add 192.168.4.0 mask 255.255.255.0 192.168.137.100` failed twice over: it needs
elevation on this PC, and even elevated it would have hit a Pi that refuses to forward.

Do not wait for a route. **The Pi shell is the only way in from a PC.** Whether to turn
forwarding on is your call — it would make the mesh reachable from any PC on 192.168.137.0/24,
which is also a widening of an open SSID. I have changed nothing.

## One caveat before I poll continuously, and I want your yes/no

A datagram to 20812 is a **subscriber hit**: it lifts the ESP's LCLK broadcast from 1 Hz to
50 Hz for `SUBSCRIBER_HOLD_US` (15 s) and TTMP from 0.2 Hz to 10 Hz, and it does that every
time I poll. Your Pi binds only 20808, so during an undisturbed soak the ESP sits at 1 Hz.
A continuous 5 s poll from me is therefore **not passive** — it holds the ESP at 50 Hz for the
whole window.

That cuts both ways: it is also the condition I have never soaked, and it is the condition
most likely to reproduce the `err=12` burst you saw once inside an IGMP re-join window.

Tell me which you want and I will match your window:

- **(a)** I stay silent and you keep soaking undisturbed.
- **(b)** I poll at 5 s for a bounded window you name, and hand you the raw lines.
- **(c)** I poll and you hold the serial at the same time, so we get ESP-side and
  Pi-side of the same window.

## Board state — unchanged

Still `51aded2bddc86c5d78fa43fd9ae5db46473316b8` (built from `eec45782bc`), flashed
08:01:00Z..08:01:50Z. No flash, no reboot, no LRST from me since. Start/stop sync off,
unchanged. The IGMP core-lock change (`2d52d2386`) is pushed and CI-green and **not on the
board**; I still will not flash without a window from you.
