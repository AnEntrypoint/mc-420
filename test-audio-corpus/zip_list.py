import sys
import struct
import urllib.request

URL = sys.argv[1]
PATTERN = sys.argv[2] if len(sys.argv) > 2 else ""


def http_range(url, start, end):
    req = urllib.request.Request(url, headers={"Range": "bytes=%d-%d" % (start, end)})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def get_size(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return int(resp.headers.get("Content-Length"))


size = get_size(URL)
print("total size", size, file=sys.stderr)

tail_len = min(1 << 20, size)
tail = http_range(URL, size - tail_len, size - 1)

eocd_sig = b"PK\x05\x06"
idx = tail.rfind(eocd_sig)
if idx < 0:
    raise SystemExit("EOCD not found in tail")

eocd = tail[idx:idx + 22]
(sig, disk_no, cd_disk, disk_entries, total_entries, cd_size, cd_offset, comment_len) = struct.unpack(
    "<IHHHHIIH", eocd
)
print("total_entries", total_entries, "cd_size", cd_size, "cd_offset", cd_offset, file=sys.stderr)

cd = http_range(URL, cd_offset, cd_offset + cd_size - 1)

entries = []
p = 0
while p < len(cd):
    sig = cd[p:p + 4]
    if sig != b"PK\x01\x02":
        break
    (ver_made, ver_need, flags, method, mtime, mdate, crc32, csize, usize,
     fname_len, extra_len, comment_len2, disk_start, int_attr, ext_attr, lho) = struct.unpack(
        "<HHHHHHIIIHHHHHII", cd[p + 4:p + 4 + 42]
    )
    name_start = p + 46
    fname = cd[name_start:name_start + fname_len].decode("utf-8", "replace")
    entries.append({
        "name": fname,
        "csize": csize,
        "usize": usize,
        "crc32": crc32,
        "method": method,
        "lho": lho,
    })
    p = name_start + fname_len + extra_len + comment_len2

print("entries", len(entries), file=sys.stderr)
for e in entries:
    if PATTERN and PATTERN not in e["name"]:
        continue
    print(e["name"], e["usize"], e["csize"])
