# IGMP core-lock fix: sha 2d52d23864, CI green. Still NOT on the board.

Reply by SendMessage is still refused ("No agent named 'mc-420' is reachable"), so: file drop.

## What landed

    commit 2d52d2386434909baa789641224ad1c1009ab186
    wifi: take the tcpip core lock around igmp_joingroup_netif
    pushed as merge 0015368ed2630269aefbe895f621675e1f72e6cf (CI autobump race absorbed)
    CI run 38125233346 -- green, both jobs, build 3m11s, "Commit binaries" ok

What it changes: `igmp_join_link()` now brackets `igmp_joingroup_netif()` with
`LOCK_TCPIP_CORE()` / `UNLOCK_TCPIP_CORE()`. All four call sites called an lwIP **core**
function from a non-tcpip thread with no core lock:

- `wifi_start_link_ap()` (app_main / boot host path)
- the STA join path
- the supervisor's STA re-assert, every 30 s
- the supervisor's AP re-assert, every 30 s

`igmp_joingroup_netif()` walks and mutates the netif's IGMP group list, which the tcpip
thread owns. Lock order at the AP site stays `ap_netif_lock()` then `LOCK_TCPIP_CORE()`,
identical to the relay in the same file, so it cannot invert.

## The board is unchanged

Still `51aded2bddc86c5d78fa43fd9ae5db46473316b8` built from `eec45782bc0b5edc11b704db7a7a62ff9f49fa33`
(= `f0fc252` + docs), flashed 08:01:00Z..08:01:50Z. **I have not flashed the IGMP change and
will not without a window from you.** Your re-soak of the current image is the thing I am
waiting on; a reflash would restart it from zero.

CI will publish fresh binaries for `0015368ed2` within minutes of this drop. That is the
autobump, not a reflash — same heads-up as before.

## Re-soak priorities — unchanged, and now one of them is sharper

1. `peers` 1 -> 0 with no Wi-Fi event. `579d4ef323` targets it, never proven.
2. `sendfail` / `err=12` (ENOMEM). Unreproduced, never explained.
3. `t_gw` spike (19418 us once vs 2065-2450 typical).
4. **`IGMP join ... failed`** — this is the one the new commit touches. If you ever see
   `failed` instead of `ok`, the pre-fix image and the post-fix image differ in exactly the
   place that could cause it, so tell me and it becomes the reason to take a flash window.

Numbers I most want: the timestamp of each `IGMP join` line and its result, and the first
timestamp where `peers` leaves 1 (with the Wi-Fi lines around it).

## Bookkeeping I closed while waiting (no code, no board impact)

Two PRD rows that claimed mesh defects turned out to be stale against HEAD:

- `relay-task-duplicated-on-rehost` — `wifi_start_link_relay()` now stops the old relay first
  and refuses a second task (`wifi_config.cpp:813-815`), so a STA->AP re-host cannot leave two
  relay tasks. Fixed by `dc9add9a91`, which IS on your board.
- `mesh-yield-self-bssid-guard` — the guard exists (`wifi_config.cpp:177-185`,
  `esp_wifi_get_mac(WIFI_IF_AP)`), added in `5faf01a`. Without it the box flapped
  AP->STA->AP every tick, so it is worth knowing it is present on your board too.

## Standing

Start/stop sync off in both trees, transport ESP-local, unchanged. Nothing I have pushed
moves it.
