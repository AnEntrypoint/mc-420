from pathlib import Path

import numpy as np
import dawdreamer as daw

REPO_ROOT = Path(__file__).resolve().parents[2]
DSP_PATH = REPO_ROOT / "effects" / "home" / "faust" / "resonode_synth.dsp"

SAMPLE_RATE = 48000
BLOCK_SIZE = 64
COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-ct", "0"]


def _short_name(label):
    return label.replace("/", "_")


def compile_processor(engine, dsp_text, name="resonode"):
    faust = engine.make_faust_processor(name)
    faust.set_dsp_string(dsp_text)
    faust.compile_flags = COMPILE_FLAGS
    if not faust.compile():
        raise RuntimeError("faust compile failed")
    descs = faust.get_parameters_description()
    index = {_short_name(p["label"]): p["index"] for p in descs}
    full_name = {_short_name(p["label"]): p["name"] for p in descs}
    return faust, index, full_name


def render(dsp_text, excite, dur, params=None, automation=None):
    engine = daw.RenderEngine(SAMPLE_RATE, BLOCK_SIZE)
    excite = np.asarray(excite, dtype=np.float32).reshape(1, -1)
    playback = engine.make_playback_processor("in", excite)
    faust, index, full_name = compile_processor(engine, dsp_text)
    engine.load_graph([(playback, []), (faust, ["in"])])
    for label, value in (params or {}).items():
        faust.set_parameter(index[label], float(value))
    for label, arr in (automation or {}).items():
        faust.set_automation(full_name[label], np.asarray(arr, dtype=np.float32))
    engine.render(dur)
    return engine.get_audio()[0]


def burst_excitation(n, seed, amp=0.6):
    rng = np.random.default_rng(seed)
    burst_n = int(0.015 * SAMPLE_RATE)
    burst = rng.uniform(-1.0, 1.0, size=burst_n) * amp
    excite = np.zeros(n, dtype=np.float32)
    excite[: min(burst_n, n)] = burst[: min(burst_n, n)]
    return excite


def spectral_centroid(x, sr=SAMPLE_RATE, warmup_s=0.2):
    seg = x[int(warmup_s * sr):]
    if len(seg) < 256:
        seg = x
    windowed = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
    return float(np.sum(freqs * spec ** 2) / (np.sum(spec ** 2) + 1e-20))
