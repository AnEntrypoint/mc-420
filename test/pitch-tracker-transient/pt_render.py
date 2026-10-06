import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
ARCH_PATH = REPO_ROOT / "tools" / "pitchtracker-render" / "pt_arch.cpp"
HARNESS_PATH = REPO_ROOT / "tools" / "pitchtracker-render" / "pt_render.cpp"
CACHE_ROOT = REPO_ROOT / "build" / "pt-render"

COMPILE_FLAGS = ["-vec", "-fun", "-dfs", "-vs", "32", "-nvi", "-ct", "0", "-t", "600"]

MissingPrerequisite = SystemExit(2)


def _require(name):
    if shutil.which(name) is None:
        print(f"pt_render: {name} not found on PATH", file=sys.stderr)
        raise MissingPrerequisite


def _build(dsp_text):
    _require("faust")
    _require("g++")
    key = hashlib.sha1(dsp_text.encode("utf-8")).hexdigest()[:16]
    work = CACHE_ROOT / key
    exe = work / ("pt_render.exe" if os.name == "nt" else "pt_render")
    if exe.exists():
        return exe
    work.mkdir(parents=True, exist_ok=True)
    probe = work / "probe.dsp"
    probe.write_text(dsp_text, encoding="utf-8", newline="\n")
    gen = work / "pt_dsp.cpp"
    subprocess.run(
        ["faust", "-i", "-a", str(ARCH_PATH)] + COMPILE_FLAGS
        + ["-cn", "pitchtracker", str(probe), "-o", str(gen)],
        check=True,
    )
    subprocess.run(
        ["g++", "-O2", "-std=c++17", "-I", str(work), "-o", str(exe), str(HARNESS_PATH), "-lm"],
        check=True,
    )
    return exe


def render(dsp_text, channels, sr=48000, block=64):
    arr = np.asarray(channels, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    exe = _build(dsp_text)
    work = CACHE_ROOT / "io"
    work.mkdir(parents=True, exist_ok=True)
    in_path = work / "in.f32"
    out_path = work / "out.f32"
    arr.reshape(arr.shape[0], -1).tofile(in_path)
    subprocess.run(
        [str(exe), f"in={in_path}", f"out={out_path}", f"sr={sr}",
         f"block={block}", f"channels={arr.shape[0]}"],
        check=True,
    )
    data = np.fromfile(out_path, dtype=np.float32)
    frames = arr.shape[1]
    if data.size % frames != 0:
        raise RuntimeError(f"pt_render: {data.size} output samples over {frames} frames")
    return data.reshape(data.size // frames, frames)
