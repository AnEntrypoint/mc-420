from pathlib import Path
import re

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "dsp" / "loop.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]


def _short_name(label):
    return label.replace("/", "_")


def _shared_grid_block(body):
    engine = re.search(r"^loopEngine\(([^)]*)\)[^=]*=\s*.*?with \{\n(.*?)\n\};", body, re.M | re.S)
    if engine is None:
        raise RuntimeError("dsp/loop.dsp no longer has a loopEngine with-block")
    block = "\n".join(l for l in engine.group(2).split("\n")
                      if not l.strip().startswith(("outs", "loopSum", "loopSolos")))
    for name in ("masterPhaseWrapped", "fineGridWrapped"):
        if name not in block:
            raise RuntimeError("loopEngine no longer derives " + name)
    return block


def single_looper_dsp():
    body = DSP_PATH.read_text()
    proc = re.search(r"^process\(([^)]*)\).*$", body, re.M)
    if proc is None:
        raise RuntimeError("dsp/loop.dsp no longer has a process line")
    if body[proc.end():].strip():
        raise RuntimeError("dsp/loop.dsp has code after the process line")
    args = proc.group(1)
    shared = _shared_grid_block(body)
    single = "process(%s) = oneLooper(%s, masterPhaseWrapped, fineGridWrapped)\nwith {\n%s\n};\n" % (
        args, args, shared)
    body = body[:proc.start()] + single
    assert body.count("process(") == 1
    return body


def compile_processor(engine, dsp_text, name="loop"):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    descs = faust.get_parameters_description()
    index = {_short_name(p["label"]): p["index"] for p in descs}
    full_name = {_short_name(p["label"]): p["name"] for p in descs}
    return faust, index, full_name


def render_take(dsp_text, channels, dur_samples, automation=None, params=None):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    arr = np.asarray(channels, dtype=np.float32)
    playback = engine.make_playback_processor("in", arr)
    faust, index, full_name = compile_processor(engine, dsp_text)
    engine.load_graph([(playback, []), (faust, ["in"])])
    for label, value in (params or {}).items():
        faust.set_parameter(index[label], float(value))
    for label, a in (automation or {}).items():
        faust.set_automation(full_name[label], np.asarray(a, dtype=np.float32))
    engine.render(dur_samples / SAMPLE_RATE)
    audio = engine.get_audio()
    return audio, index, full_name


def arm_sample(master_phase, fine_grid):
    idx = np.floor(np.asarray(master_phase, dtype=np.float64) / fine_grid).astype(np.int64)
    wrapped = np.zeros(len(idx), dtype=bool)
    wrapped[1:] = idx[1:] != idx[:-1]
    return int(np.argmax(wrapped))


def fine_grid_samples(master_len_samples, recorded_beats):
    return 0.125 * (master_len_samples / max(1.0, recorded_beats))


def const(n, v):
    return np.full(n, v, dtype=np.float32)
