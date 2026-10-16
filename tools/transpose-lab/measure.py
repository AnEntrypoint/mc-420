import os
import sys
import json
import math
import array
import wave
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
INSTR_DIR = os.path.join(ROOT, "test-audio-corpus", "instruments")
MANIFEST = os.path.join(INSTR_DIR, "manifest.json")
DSP_CLI = os.environ.get("DSP_CLI", "/tmp/dsp_cli")
OUT_DIR = os.environ.get("TRANSPOSE_LAB_OUT", "/tmp/tvout")
RENDER_DIR = os.path.join(OUT_DIR, "render")
MATRIX_PATH = os.path.join(OUT_DIR, "matrix.json")

SEMITONES = [-24, -12, 0, 12, 19, 24]
BAND_LO = 40.0
BAND_HI = 4000.0
NARROW = 1.1225
WIN_SEC = 0.8
SRC_WIN_SEC = 1.4
FRAME_SEC = 0.05
LOCK_SEC = 1.2
TIE_FRAC_SRC = 0.80
TIE_FRAC_OUT = 0.90
HALF_FRAC = 0.95
TIE_ABS = 0.02
NCC_MIN = 0.45
MARGIN_MIN = 0.02
PRIOR_BUCKET_CENTS = 100.0
NORM_RMS = 0.21
GLITCH_THRESHOLD = 0.25
CAND_LO = 20.0
CAND_HI = 16000.0

NOMINAL_NOTE = {
    "piano_low_A1.wav": 33,
    "piano_mid_C4.wav": 60,
    "piano_high_C7.wav": 96,
    "violin_low_sulG_G3B3.wav": 55,
    "violin_high_sulE_C7E7.wav": 96,
    "cello_low_sulC_A2.wav": 45,
    "marimba_low_C2B2.wav": 36,
    "marimba_mid_C5B5.wav": 72,
    "vibraphone_mid_C5B5.wav": 72,
    "trumpet_low_A3.wav": 57,
    "trumpet_high_C6.wav": 84,
    "oboe_mid_C5B5.wav": 72,
    "bassoon_low_C2B2.wav": 36,
    "clarinet_high_C6B6.wav": 84,
    "vocal_female_vibrato.wav": 69,
    "vocal_male_baritone_scale.wav": 53,
}


def midi_to_hz(note):
    return 440.0 * math.pow(2.0, (note - 69) / 12.0)


def cents_between(measured, expected):
    if measured <= 0.0 or expected <= 0.0:
        return None
    return 1200.0 * math.log(measured / expected) / math.log(2.0)


def run_cli(args):
    p = subprocess.run([DSP_CLI] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def parse_fields(line):
    out = {}
    for part in line.split(","):
        eq = part.find("=")
        if eq < 0:
            continue
        key = part[:eq]
        raw = part[eq + 1:]
        try:
            out[key] = float(raw)
        except ValueError:
            out[key] = raw
    return out


def duration_of(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def pick_window(path, min_start=0.0, max_end=None, win_sec=WIN_SEC):
    with wave.open(path, "rb") as w:
        n = w.getnframes()
        sr = w.getframerate()
        data = w.readframes(n)
    a = array.array("h")
    a.frombytes(data[:len(data) - (len(data) % 2)])
    frame = int(FRAME_SEC * sr)
    win_frames = max(1, int(round(win_sec / FRAME_SEC)))
    first = int(min_start * sr) // frame
    limit = n if max_end is None else min(n, int(max_end * sr))
    rms = []
    for s in range(0, n - frame + 1, frame):
        acc = 0
        for i in range(s, s + frame):
            v = a[i]
            acc += v * v
        rms.append(math.sqrt(acc / float(frame)))
    best_mean = -1.0
    best_i = first
    usable = max(first, (limit // frame) - win_frames)
    for i in range(first, usable + 1):
        seg = rms[i:i + win_frames]
        if len(seg) < win_frames:
            continue
        m = sum(seg) / float(len(seg))
        if m > best_mean:
            best_mean = m
            best_i = i
    start = best_i * FRAME_SEC
    end = start + win_frames * FRAME_SEC
    if max_end is not None:
        end = min(end, max_end)
    if end - start < 0.3:
        end = min((limit / float(sr)) if max_end is None else max_end, start + 0.3)
    return round(start, 3), round(end, 3)


def measure_narrow(path, cand, from_sec, to_sec):
    lo = cand / NARROW
    hi = cand * NARROW
    _, out, err = run_cli([
        "--pitch", path,
        "hz=%.4f" % cand,
        "minhz=%.4f" % lo,
        "maxhz=%.4f" % hi,
        "from=%.4f" % from_sec,
        "to=%.4f" % to_sec,
    ])
    for line in out.splitlines():
        if line.startswith("pitch,"):
            f = parse_fields(line)
            return dict(cand=cand, measured=f.get("measured", 0.0), ncc=f.get("ncc", -1.0),
                        lag=f.get("lag", 0.0))
    return dict(cand=cand, measured=0.0, ncc=-1.0, lag=0.0, error=(err.strip() or "no pitch row"))


def measure_wide_band(path, min_hz, max_hz, from_sec, to_sec):
    _, out, _ = run_cli([
        "--pitch", path, "hz=0",
        "minhz=%.4f" % min_hz, "maxhz=%.4f" % max_hz,
        "from=%.4f" % from_sec, "to=%.4f" % to_sec,
    ])
    for line in out.splitlines():
        if line.startswith("pitch,"):
            f = parse_fields(line)
            return f.get("measured", 0.0)
    return 0.0


def measure_wide(path, from_sec, to_sec):
    _, out, _ = run_cli([
        "--pitch", path, "hz=0",
        "minhz=%.1f" % BAND_LO, "maxhz=%.1f" % BAND_HI,
        "from=%.4f" % from_sec, "to=%.4f" % to_sec,
    ])
    for line in out.splitlines():
        if line.startswith("pitch,"):
            f = parse_fields(line)
            return f.get("measured", 0.0), f.get("ncc", -1.0)
    return 0.0, -1.0


def add_candidate(cands, label, hz):
    if hz < CAND_LO or hz > CAND_HI:
        return
    for c in cands:
        d = cents_between(hz, c["cand"])
        if d is not None and abs(d) < 30.0:
            return
    cands.append(dict(label=label, cand=hz))


def score(cands, path, from_sec, to_sec):
    for c in cands:
        c.update(measure_narrow(path, c["cand"], from_sec, to_sec))
    cands.sort(key=lambda c: c["ncc"], reverse=True)
    return cands


def half_period_ok(c, path, from_sec, to_sec):
    h = measure_narrow(path, c["cand"] * 2.0, from_sec, to_sec)
    c["half_ncc"] = h["ncc"]
    c["half_hz"] = h["measured"]
    if c["ncc"] <= 0.0 or h["measured"] <= 0.0 or h.get("lag", 0.0) <= 0.0:
        return False
    return h["ncc"] < HALF_FRAC * c["ncc"]


def nearest_octave_cents(hz, nominal_hz):
    if hz <= 0.0 or nominal_hz <= 0.0:
        return 1e9
    k = round(math.log(hz / nominal_hz) / math.log(2.0))
    d = cents_between(hz, nominal_hz * math.pow(2.0, k))
    return abs(d) if d is not None else 1e9


def tied_set(ranked, tie_frac):
    best = ranked[0]["ncc"]
    out = [c for c in ranked if c["ncc"] >= tie_frac * best and c["ncc"] >= NCC_MIN]
    return out if out else [ranked[0]]


def resolve_source(path, prior_hz, from_sec, to_sec, ladder=3, band=(0.5, 4.0), use_free=True):
    cands = []
    for k in range(-ladder, ladder + 1):
        add_candidate(cands, "nominal%+d" % k, prior_hz * math.pow(2.0, k))
    free_hz = measure_wide_band(path, BAND_LO, BAND_HI, from_sec, to_sec) if use_free else 0.0
    free_ncc = measure_narrow(path, free_hz, from_sec, to_sec)["ncc"] if free_hz > 0.0 else -1.0
    if free_hz > 0.0:
        add_candidate(cands, "free", free_hz)
        add_candidate(cands, "free+1", free_hz * 2.0)
        add_candidate(cands, "free-1", free_hz / 2.0)
    if use_free:
        for tag, cand in (("free2", measure_wide_band(path, prior_hz * band[0], prior_hz * band[1],
                                                      from_sec, to_sec)),):
            if cand > 0.0:
                add_candidate(cands, tag, cand)
                add_candidate(cands, tag + "+1", cand * 2.0)
                add_candidate(cands, tag + "-1", cand / 2.0)
    ranked = score(cands, path, from_sec, to_sec)
    tied = tied_set(ranked, TIE_FRAC_SRC)
    passing = [c for c in tied if half_period_ok(c, path, from_sec, to_sec)]
    confident = bool(passing)
    pool = passing if passing else tied
    best = max(pool, key=lambda c: c["ncc"])
    near = [c for c in pool if c["ncc"] >= best["ncc"] - TIE_ABS]
    near.sort(key=lambda c: (int(nearest_octave_cents(c["measured"], prior_hz) // PRIOR_BUCKET_CENTS),
                             nearest_octave_cents(c["measured"], prior_hz), -c["ncc"]))
    winner = near[0]
    runner = None
    for c in ranked:
        if c is not winner:
            runner = c
            break
    return winner, runner, ranked, (free_hz, free_ncc), confident


def resolve_output(path, want, from_sec, to_sec):
    cands = []
    add_candidate(cands, "wantx2", want * 2.0)
    add_candidate(cands, "want", want)
    add_candidate(cands, "want_2", want / 2.0)
    add_candidate(cands, "want_4", want / 4.0)
    ranked = score(cands, path, from_sec, to_sec)
    tied = tied_set(ranked, TIE_FRAC_OUT)
    passing = [c for c in tied if half_period_ok(c, path, from_sec, to_sec)]
    confident = bool(passing)
    pool = passing if passing else tied
    best = max(pool, key=lambda c: c["ncc"])
    near = [c for c in pool if c["ncc"] >= best["ncc"] - TIE_ABS]
    winner = max(near, key=lambda c: c["cand"])
    runner = None
    for c in ranked:
        if c is not winner:
            runner = c
            break
    return winner, runner, ranked, confident


def glitch_count(path):
    _, out, err = run_cli(["--glitch-check", path, "threshold=%s" % GLITCH_THRESHOLD, "minGapMs=5"])
    for line in (out + err).splitlines():
        if line.startswith("glitches="):
            try:
                return int(line.split("=")[1])
            except ValueError:
                return -1
    return -1


def render(src, dst, semis):
    _, out, err = run_cli([
        "--solad", "in=%s" % src, "out=%s" % dst, "semis=%d" % semis, "normrms=%s" % NORM_RMS,
    ])
    for line in (out + err).splitlines():
        if line.startswith("solad,"):
            return parse_fields(line)
    return {}


def main():
    if not os.path.exists(DSP_CLI):
        print("dsp_cli not found at %s (set DSP_CLI=...)" % DSP_CLI)
        return 2
    if not os.path.exists(RENDER_DIR):
        os.makedirs(RENDER_DIR)

    with open(MANIFEST) as f:
        manifest = json.load(f)
    known = [e["filename"] for e in manifest["files"]]
    files = sorted(f for f in NOMINAL_NOTE if os.path.exists(os.path.join(INSTR_DIR, f)))
    extra = [f for f in known if f not in NOMINAL_NOTE]
    if extra:
        print("skipping %d corpus files with no nominal note: %s" % (len(extra), ", ".join(extra)))

    matrix = []
    for fname in files:
        src_path = os.path.join(INSTR_DIR, fname)
        dur = duration_of(src_path)
        nominal_hz = midi_to_hz(NOMINAL_NOTE[fname])
        src_a, src_b = pick_window(src_path, 0.0, dur / 4.0, WIN_SEC)
        winner, runner, ranked, free, f0_ok = resolve_source(src_path, nominal_hz, src_a, src_b)
        f0_in = winner["measured"]
        print("%-32s win=%.2f..%.2f nominal=%8.2f free=%8.2f(%.3f) f0_in=%9.3f [%s ncc=%.4f half=%.4f] runner=%s(%.4f)%s"
              % (fname, src_a, src_b, nominal_hz, free[0], free[1], f0_in,
                 winner["label"], winner["ncc"], winner.get("half_ncc", 0.0),
                 runner["label"] if runner else "-", runner["ncc"] if runner else 0.0,
                 "" if f0_ok else "  UNRESOLVED_SOURCE"))

        for semis in SEMITONES:
            rate = math.pow(2.0, semis / 12.0)
            stem = fname.replace(".wav", "") + ("_%+03d" % semis)
            dst_path = os.path.join(RENDER_DIR, stem + ".wav")
            solad = render(src_path, dst_path, semis)
            hi = min(dur, dur * rate)
            span = max(WIN_SEC, 0.35 * rate)
            sa, sb = pick_window(src_path, LOCK_SEC, hi, span)
            if sb - sa < 0.4:
                sa, sb = pick_window(src_path, hi / 2.0, hi, min(WIN_SEC, hi / 2.0))
            out_a = round(max(0.05, sa / rate), 3)
            out_b = round(min(sb / rate, dur - 0.02), 3)
            if out_b - out_a < 0.3:
                out_b = round(min(dur - 0.02, out_a + 0.3), 3)
            cell_src, _, cell_ranked, _, cell_src_ok = resolve_source(src_path, f0_in, sa, sb,
                                                                          ladder=1, use_free=False)
            want = cell_src["measured"] * rate
            out_of_band = bool(want > BAND_HI or want < BAND_LO)

            w, r, out_ranked, out_ok = resolve_output(dst_path, want, out_a, out_b)
            measured = w["measured"]
            ncc = w["ncc"]
            cents = cents_between(measured, want)
            low_conf = bool(ncc < NCC_MIN or not out_ok or not f0_ok or not cell_src_ok)
            margin = ncc - (r["ncc"] if r else 0.0)
            octave_error = bool(not out_of_band and w["label"] != "want")

            cell = dict(
                file=fname, semis=semis,
                src_window=[sa, sb], out_window=[out_a, out_b],
                nominal_hz=round(nominal_hz, 3),
                f0_in=round(f0_in, 3), f0_in_label=winner["label"],
                f0_in_ncc=round(winner["ncc"], 4), f0_resolved=f0_ok,
                f0_cell=round(cell_src["measured"], 3), f0_cell_resolved=cell_src_ok,
                f0_cell_candidates=[dict(label=c["label"], cand=round(c["cand"], 2),
                                         measured=round(c["measured"], 2), ncc=round(c["ncc"], 4))
                                    for c in cell_ranked],
                want=round(want, 3),
                measured=round(measured, 3),
                cents=round(cents, 2) if cents is not None else None,
                octave_error=octave_error,
                out_of_band=out_of_band,
                low_confidence=low_conf,
                winner=w["label"],
                ncc=round(ncc, 4),
                runner=r["label"] if r else None,
                runner_ncc=round(r["ncc"], 4) if r else None,
                ncc_margin=round(margin, 4),
                candidates=[dict(label=c["label"], cand=round(c["cand"], 2),
                                 measured=round(c["measured"], 2), ncc=round(c["ncc"], 4),
                                 half_ncc=round(c.get("half_ncc", 0.0), 4)) for c in out_ranked],
                glitches=glitch_count(dst_path),
                solad_measured=solad.get("measured"),
                achieved_semis=solad.get("achievedSemis"),
                splices=solad.get("splices"),
                emergency=solad.get("emergency"),
                peak_step=solad.get("peakStep"),
                gap_max=solad.get("gapMax"),
                rms=solad.get("rms"),
            )
            matrix.append(cell)
            flag = "OCTAVE_ERR" if octave_error else ("OUT_OF_BAND" if out_of_band else "ok")
            if octave_error and low_conf:
                flag = "OCTAVE_ERR?"
            print("    %+4d want=%9.2f meas=%9.2f cents=%s ncc=%.4f win=%-7s %-12s glitch=%s step=%.4f"
                  % (semis, want, measured, ("%+.1f" % cents) if cents is not None else "n/a",
                     ncc, w["label"], flag, cell["glitches"],
                     cell["peak_step"] if cell["peak_step"] is not None else -1.0))

    with open(MATRIX_PATH, "w") as f:
        json.dump(matrix, f, indent=2)

    print("\n=== SUMMARY ===")
    print("cells: %d   out_of_band: %d   low_confidence: %d"
          % (len(matrix),
             sum(1 for c in matrix if c["out_of_band"]),
             sum(1 for c in matrix if c["low_confidence"])))
    errs = [c for c in matrix if c["octave_error"]]
    firm = [c for c in errs if not c["low_confidence"]]
    soft = [c for c in errs if c["low_confidence"]]
    print("octave errors: %d  (confident: %d, low-confidence: %d)" % (len(errs), len(firm), len(soft)))
    for c in firm:
        print("  FIRM  %-32s %+4d want=%9.2f measured=%9.2f winner=%-7s ncc=%.4f runner=%s(%.4f) glitch=%s"
              % (c["file"], c["semis"], c["want"], c["measured"], c["winner"], c["ncc"],
                 c["runner"], c["runner_ncc"] if c["runner_ncc"] is not None else -1.0, c["glitches"]))
    for c in soft:
        print("  SOFT  %-32s %+4d want=%9.2f measured=%9.2f winner=%-7s ncc=%.4f runner=%s(%.4f) glitch=%s"
              % (c["file"], c["semis"], c["want"], c["measured"], c["winner"], c["ncc"],
                 c["runner"], c["runner_ncc"] if c["runner_ncc"] is not None else -1.0, c["glitches"]))

    print("\nworst non-octave cents per file (in-band, confident cells only):")
    for fname in files:
        rows = [c for c in matrix if c["file"] == fname and not c["octave_error"]
                and not c["out_of_band"] and not c["low_confidence"] and c["cents"] is not None]
        if not rows:
            print("  %-32s n/a" % fname)
            continue
        worst = max(rows, key=lambda c: abs(c["cents"]))
        print("  %-32s %+8.2f cents at %+d semis (want=%.2f measured=%.2f ncc=%.4f)"
              % (fname, worst["cents"], worst["semis"], worst["want"], worst["measured"], worst["ncc"]))

    return 0


if __name__ == "__main__":
    sys.exit(main())
