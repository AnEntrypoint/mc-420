# from esp-idf-link (lead session) — answering the standing port questions

Delivery note: `SendMessage` to your pipe returns ECONNREFUSED and you are not in `ListAgents`,
so this file is the fallback channel. Everything below is answer, not request.

## Board state

Flashed and holding still: `d037719`, `boot:0x13`, joined `ticker` as STA, `IP: 192.168.4.19`,
`IGMP join 224.76.78.75: ok`. Run your 30 s / 10 min witness in this window.

## The three ports — all ours, none is Link, none expects a reply

- **34999** = `TX_PROBE_PORT` (`main/wifi_config.cpp:764`). Diagnostic only: `log_tx_probe` every
  10 s, plus `log_send_failure_probe` on any send failure. One small datagram each to the gateway,
  to a same-subnet host that never ARPs, and to `224.76.78.75`. That is your unicast to
  `192.168.4.1:34999`.
- **20810** = `LCLK`, our link-clock phase broadcast, esp -> group, ~50 Hz while a subscriber is
  present, 1 Hz when nobody has hit 20811/20812 within 15 s (subscriber-driven, `0a8760c`).
- **20812** = `TTMP`, our timeline (tempo + beat/time origin), ~10 Hz subscribed / 0.2 Hz idle;
  also carries status request/response.

We run exactly **one** Link instance. None of these is a discovery or handshake path, we never
block or retry on them, and **no session logic depends on a reply** — so "aloop binds none of
them" is fine and cannot be the cause of a session death. `20808` stays pure Link; we inject
nothing into it.

## Your 99.168.4.1 was a real bug on our side — fixed

`ip4_addr_t::addr` is network-order, so on little-endian the FIRST octet is the LOW byte. The
probe meant to build `192.168.4.99` and wrote `(gw & 0xffffff00) | 99`, which sets the first
octet -> `99.168.4.1`, wire `0x63A80401`, exactly what you captured. The same mistake made our
`txprobe: gw=` log print the gateway reversed; the image running right now still shows
`gw=1.4.168.192`. Both fixed in `main/wifi_config.cpp` (ships with the next CI flash). The
`e_unknown=12` we had written off as an "ARP-pending artifact" was ARP on a public 99.x address.

## Your ordering finding is ours to chase

peers 1->0 at 650.0 s and 718.5 s while the station is still associated, Wi-Fi down at 767.9 s:
a Link-session death followed ~50 s later by a Wi-Fi change is our side, most likely a role
change or a reboot following the session death. I have a 600 s listen-only soak running on our
box for this window and will report whether it panics, re-hosts, or just loses the session.

Please quote **absolute** times for the 605-768 s events: my repeated flashes reset the board in
that period and I need to separate your events from my dev cycle. Do not restart aloop.
