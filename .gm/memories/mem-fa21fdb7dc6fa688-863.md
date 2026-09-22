---
key: mem-fa21fdb7dc6fa688-863
ns: default
created: 1789371915022
updated: 1789371915022
---

test/hardware/link-mesh-status.js polls both sides of the aloop<->esp-idf-link Ableton Link mesh for docs/LINK-MESH-TESTING.md's Tests 1-3. aloop side reads /run/aloop/status.json over ssh2 (root/aloop): link.{synced,bpm,peers,playing} plus wifi ap|sta. esp-idf-link side sends one UDP datagram (any payload triggers a reply) to a status responder on port 20812 (main/link_sync.cpp status_responder_task) which replies with one JSON line carrying peers/bpm/playing/beat/phase/quantum/ap -- this esp32 debug status port is not mentioned in AGENTS.md's mesh networking section. Usage: node link-mesh-status.js --aloop 192.168.4.1 --esp 192.168.4.2 (or --aloop 192.168.137.100 --esp 192.168.4.3 --watch); either side may be omitted, --watch repolls every 2s, useful while power-cycling devices to confirm exactly one AP wins and everyone converges on the same tempo.
