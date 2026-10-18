import hashlib
import math
import os
import struct
import sys
import wave

SR = 48000
N = 3 * SR
SINES = {
    "55.69": "a90ff36d6f1dc0ed71caf2c9aa5f4721268dc87fc75dfe0dcc6303e6e8785942",
    "110": "b47d6e1244d65b9612e38884be475c2f15dabba50b3dce54308af2bcfb4db9d4",
    "220": "796df7f5dff0cf762a67630a0c3c787cddc43cc52bd74ca09645191dbf6955c9",
    "440": "d0e423593a1c47389ea79260d82fe9d8a7d4cc6f5784d62c010f8c3726e511d0",
    "1000": "d4371e1d954615532ce1c6089db73f5dc35de58962c4dc4ebd69715d3a9625e7",
}


def fail(why):
    print(f"make_sines: FAIL: {why}", file=sys.stderr)
    sys.exit(1)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    for hz, expected in SINES.items():
        f = float(hz)
        path = os.path.join(outdir, f"sine_{hz}.wav")
        w = wave.open(path, "wb")
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(struct.pack("<h", round(0.3 * math.sin(2 * math.pi * f * i / SR) * 32767))
                          for i in range(N))
        w.writeframes(frames)
        w.close()
        got = sha256(path)
        if got != expected:
            fail(f"sine_{hz}.wav sha256 {got} differs from the recorded {expected}")
        print(f"make_sines: sine_{hz}.wav {got}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: make_sines.py <outdir>")
    main(sys.argv[1])
