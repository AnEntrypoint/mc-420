from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "dsp" / "loop.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]


def _short_name(label):
    return label.replace("/", "_")


def single_looper_dsp():
    body = DSP_PATH.read_text()
    body = body.replace(
        "loopEngine(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = in, (par(i, NLOOPERS, vgroup(\"looper%2i\", oneLooper(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats))) :> _);\n\nprocess(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = loopEngine(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats);",
        "process(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = oneLooper(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats);",
    )
    assert "process(in, prevFiltIn" in body and body.count("process(") == 1
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


def const(n, v):
    return np.full(n, v, dtype=np.float32)
