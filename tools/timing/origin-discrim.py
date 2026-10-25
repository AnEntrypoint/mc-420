import json, socket, subprocess, sys, time, statistics, math
HOST = "192.168.137.132"
def status():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(1.5)
    s.sendto(b"status", (HOST, 4445))
    try:
        d = json.loads(s.recvfrom(65535)[0].decode())
    except Exception:
        return None
    finally:
        s.close()
    return d
def pad(note):
    t = time.time()
    subprocess.run(["node", "test/hardware/midi-inject.js", HOST, "note-on", str(note), "127"], capture_output=True)
    subprocess.run(["node", "test/hardware/midi-inject.js", HOST, "note-off", str(note), "0"], capture_output=True)
    return t
BEAT = 0.5
ta_m = pad(2); time.sleep(4 * BEAT); tf_m = pad(2)
master_polls = []
t_m = time.time()
while time.time() - t_m < 2.5:
    t_send = time.time(); s = status(); t_recv = time.time()
    if s and s["loopers"]["rec"] == 0:
        master_polls.append({"t": (t_send + t_recv) / 2, "phase": s["master_phase_beats"], "rec": s["recorded_beats"]})
    time.sleep(0.05)
d0 = status(); bpm = d0["link"]["bpm"]; beat = 60.0 / bpm
ta = pad(3); time.sleep(4.49 * beat); tf = pad(3)
polls = []
t_start = time.time()
while time.time() - t_start < 4.0:
    t_send = time.time(); s = status(); t_recv = time.time()
    if s and s["loopers"]["rec"] == 0:
        polls.append({"t": (t_send + t_recv) / 2, "phase": s["master_phase_beats"], "len": s["master_len_samples"], "rec": s["recorded_beats"]})
    time.sleep(0.05)
d = status()
L = statistics.median(p["rec"] for p in polls) if polls else float("nan")
phrase = L
def model_err(origin_t):
    errs = []
    for p in polls:
        pred = ((p["t"] - origin_t) / beat) % phrase
        e = ((p["phase"] - pred + phrase / 2) % phrase) - phrase / 2
        errs.append(e)
    return statistics.mean(errs), statistics.pstdev(errs)
ma, sa = model_err(ta)
mf, sf = model_err(tf)
print(f"bpm {bpm:.2f} beat {beat*1000:.1f} ms  phrase {phrase:.3f} beats  polls {len(polls)}")
print(f"arm-origin model:    mean err {ma:+.3f} beats, sd {sa:.3f}")
print(f"finish-origin model: mean err {mf:+.3f} beats, sd {sf:.3f}")
print(f"press gap finish-arm (late take) {(tf-ta):.3f} s = {(tf-ta)/beat:.2f} beats; wrap {phrase:.2f}")
mp = master_polls
err_m = []
for p in mp:
    pred = ((p["t"] - ta_m) / beat) % 4.0
    err_m.append(((p["phase"] - pred + 2.0) % 4.0) - 2.0)
c = statistics.mean(err_m) if err_m else float("nan")
print(f"master-window constant c = {c:+.3f} beats, sd {statistics.pstdev(err_m):.3f}, polls {len(err_m)}")
print(f"late arm-model {ma:+.3f} vs c {c:+.3f} -> diff {ma-c:+.3f}")
print(f"late finish-model {mf:+.3f} vs c {c:+.3f} -> diff {mf-c:+.3f}")
json.dump({"polls": polls, "master_polls": mp, "c": c, "ta": ta, "tf": tf, "bpm": bpm, "phrase": phrase, "arm_err": ma, "fin_err": mf}, open(sys.argv[1], "w"))
