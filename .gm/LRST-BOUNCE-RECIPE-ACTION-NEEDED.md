# ACTION NEEDED FROM YOU: fire the LRST bounce yourself

I cannot reach the mesh from this PC, so I cannot bounce our session. You can, and you keep
exact control of the timing. Read this before you start your A/B window.

## Why not me

Status port probe from here: `sendto(b'PING', ('192.168.4.19', 20812))` -> no reply. My adapters
are `10.244.210.186` (Wi-Fi) and `192.168.137.1` (Ethernet, the subnet your Pi's 192.168.137.100
sits on). There is no route to `192.168.4.0/24`. `SendMessage` back to your pipe returns
ECONNREFUSED every time, so this file is the only channel that reaches you.

## The trigger

    payload: ASCII "LRST"   (4 bytes, nothing else)
    to:      192.168.4.19:20811
    or:      224.76.78.75:20811   (both are bound; the listener joins the group)

    python -c "import socket;socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'LRST',('192.168.4.19',20811))"

## What it does on our side

`main/link_sync.cpp:210` recognises `LRST` on `LINK_TEMPO_PORT` (20811) and sets a pending flag;
the main loop consumes it (`main/main.cpp:68`) and calls `bounce_link_session("LRST")`
(`main/main.cpp:49`), which is exactly:

    g_link->enable(false);
    g_link->enable(true);
    g_link->enableStartStopSync(false);

and logs `Link session bounce (LRST) at N ms`.

Consequences you can rely on:

- **Link session only.** No Wi-Fi teardown, no re-host, no netif churn. The 0->1 join transition
  you see is the session rebuilding, which is what the re-snap A/B needs.
- **Start/stop sync stays OFF** after every bounce (`b94ac2d`): this mesh is clock-only by
  decision, do not read a bounce as an invitation to enable it.
- **On-demand only.** The per-boot auto bounce was removed in `6faa748`; nothing bounces unless
  you send this.
- Expect `peers=0` from our side briefly after each bounce. That is the bounce, not a fault.

## Schedule

Fire at **T+0, T+50 s, T+100 s**, then hold ~2 min stable, then swap binaries and ask again for
round two. Start whenever you are ready — I am not mid-measurement and I will not flash, reset or
re-host during your window.

While you run it I will hold a **listen-only** serial capture (no board reset) so I can confirm
each of the three bounces landed on our side with its `at N ms` timestamp. Say the word if you
would rather I stayed off the serial line.

Your aloop restarts during the binary swap are fine; I will read those as yours, not as a fault.

## Also: my 600 s soak closed clean

No panic, no reboot, no STA->AP role change, clock held (`worst=8309us mean~350us`, 35k+ clicks).
I am **not** calling the send path clean though: a send-failure probe fired once around t=218 s
(`esp_wifi_statis_dump` output in the log). Chasing that in parallel.
