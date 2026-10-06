import hashlib
import os
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_RATE = 48000
BLOCK_SIZE = 64

_CLI_CANDIDATES = (
    "dsp_cli",
    "dsp_cli.exe",
    "tools/dsp-cli/dsp_cli.exe",
    "tools/dsp-cli/dsp_cli",
)


def dsp_cli_path():
    override = os.environ.get("DSP_CLI")
    if override:
        return Path(override)
    for relative in _CLI_CANDIDATES:
        candidate = REPO_ROOT / relative
        if candidate.exists():
            return candidate
    raise RuntimeError(
        "dsp_cli not built: run tools/dsp-cli/build.bat, or set DSP_CLI=<path>"
    )


def _write_float_wav(path, samples):
    data = np.asarray(samples, dtype="<f4").tobytes()
    header = (
        b"RIFF"
        + struct.pack("<I", 36 + len(data))
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 3, 1, SAMPLE_RATE, SAMPLE_RATE * 4, 4, 32)
        + b"data"
        + struct.pack("<I", len(data))
    )
    path.write_bytes(header + data)


def _read_wav(path):
    with wave.open(str(path), "rb") as handle:
        width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    if width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
    raise RuntimeError("unsupported dsp_cli output sample width %d" % width)


def render(channels):
    array = np.asarray(channels, dtype=np.float64)
    rows = [array[i] for i in range(array.shape[0])] if array.ndim == 2 else [array]
    length = max((len(row) for row in rows if len(row)), default=SAMPLE_RATE)
    work = Path(tempfile.mkdtemp(prefix="dsp-cli-render-"))
    try:
        args = [str(dsp_cli_path())]
        written = {}
        for index, row in enumerate(rows):
            if len(row) == 0 or not np.any(row):
                continue
            digest = hashlib.sha1(np.asarray(row, dtype="<f4").tobytes()).hexdigest()
            name = written.get(digest)
            if name is None:
                name = "ch%d.wav" % index
                _write_float_wav(work / name, row)
                written[digest] = name
            args += ["--gen%d" % index, "wav:%s" % name]
        if len(args) == 1:
            args += ["--gen0", "silence:%.6f" % (length / SAMPLE_RATE)]
        args.append("out.wav")
        result = subprocess.run(
            args,
            cwd=str(work),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "dsp_cli failed (%d):\n%s\n%s"
                % (result.returncode, result.stdout, result.stderr)
            )
        return _read_wav(work / "out.wav")
    finally:
        shutil.rmtree(work, ignore_errors=True)
