import sys
import struct
import zlib
import urllib.request

URL = sys.argv[1]
TARGET_NAME = sys.argv[2]
OUT_PATH = sys.argv[3]


def http_range(url, start, end):
    req = urllib.request.Request(url, headers={"Range": "bytes=%d-%d" % (start, end)})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def get_size(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return int(resp.headers.get("Content-Length"))


size = get_size(URL)
tail_len = min(1 << 20, size)
tail = http_range(URL, size - tail_len, size - 1)
eocd_sig = b"PK\x05\x06"
idx = tail.rfind(eocd_sig)
if idx < 0:
    raise SystemExit("EOCD not found")
eocd = tail[idx:idx + 22]
(sig, disk_no, cd_disk, disk_entries, total_entries, cd_size, cd_offset, comment_len) = struct.unpack(
    "<IHHHHIIH", eocd
)
cd = http_range(URL, cd_offset, cd_offset + cd_size - 1)

target = None
p = 0
while p < len(cd):
    csig = cd[p:p + 4]
    if csig != b"PK\x01\x02":
        break
    (ver_made, ver_need, flags, method, mtime, mdate, crc32, csize, usize,
     fname_len, extra_len, comment_len2, disk_start, int_attr, ext_attr, lho) = struct.unpack(
        "<HHHHHHIIIHHHHHII", cd[p + 4:p + 4 + 42]
    )
    name_start = p + 46
    fname = cd[name_start:name_start + fname_len].decode("utf-8", "replace")
    if fname == TARGET_NAME:
        target = {
            "name": fname, "csize": csize, "usize": usize, "crc32": crc32,
            "method": method, "lho": lho,
        }
        break
    p = name_start + fname_len + extra_len + comment_len2

if target is None:
    raise SystemExit("target not found: %s" % TARGET_NAME)

print("found", target, file=sys.stderr)

lho = target["lho"]
local_header = http_range(URL, lho, lho + 30 - 1)
if local_header[:4] != b"PK\x03\x04":
    raise SystemExit("bad local file header")
(lf_ver, lf_flags, lf_method, lf_mtime, lf_mdate, lf_crc32, lf_csize, lf_usize,
 lf_fname_len, lf_extra_len) = struct.unpack("<HHHHHIIIHH", local_header[4:30])

data_start = lho + 30 + lf_fname_len + lf_extra_len
csize = target["csize"]
compressed = http_range(URL, data_start, data_start + csize - 1)

if target["method"] == 0:
    raw = compressed
elif target["method"] == 8:
    raw = zlib.decompress(compressed, -15)
else:
    raise SystemExit("unsupported compression method %d" % target["method"])

crc = zlib.crc32(raw) & 0xFFFFFFFF
if crc != target["crc32"]:
    raise SystemExit("CRC mismatch: got %08x expected %08x" % (crc, target["crc32"]))
if len(raw) != target["usize"]:
    raise SystemExit("size mismatch: got %d expected %d" % (len(raw), target["usize"]))

with open(OUT_PATH, "wb") as f:
    f.write(raw)

print("OK wrote", OUT_PATH, len(raw), "bytes, CRC verified", file=sys.stderr)
