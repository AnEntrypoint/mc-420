#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:?usage: build-device.sh <out dir> [deps dir]}
DEPS=${2:-$OUT/../host-build-deps}
mkdir -p "$DEPS/debs" "$OUT"
DEPS=$(cd "$DEPS" && pwd)
OUT=$(cd "$OUT" && pwd)
LIBDIR=$DEPS/root/usr/lib/$(gcc -print-multiarch)
if [ ! -x "$DEPS/pkg-config" ]; then
  (cd "$DEPS/debs" && apt-get download libasound2-dev pkgconf-bin libpkgconf7)
  for deb in "$DEPS"/debs/*.deb; do dpkg -x "$deb" "$DEPS/root"; done
  sed -i "s#^prefix=.*#prefix=$DEPS/root/usr#" "$LIBDIR/pkgconfig/alsa.pc"
  ln -sf "$(ldconfig -p | awk '/libasound\.so\.2 /{print $NF; exit}')" "$LIBDIR/libasound.so"
  printf '#!/bin/sh\nexport LD_LIBRARY_PATH=%s\nexport PKG_CONFIG_PATH=%s\nexec %s "$@"\n' "$LIBDIR" "$LIBDIR/pkgconfig" "$DEPS/root/usr/bin/pkgconf" > "$DEPS/pkg-config"
  chmod +x "$DEPS/pkg-config"
fi
export LIBRARY_PATH=$LIBDIR
cd "$ROOT"
faust -lang cpp -vec -fun -dfs -vs 32 -nvi -ct 0 -cn AloopPreDsp -I dsp -I effects/home/faust dsp/aloop_pre.dsp -o "$OUT/loop_pre.cpp"
faust -lang cpp -vec -fun -dfs -vs 32 -nvi -ct 0 -cn AloopPostDsp -I dsp -I effects/home/faust dsp/aloop_post.dsp -o "$OUT/loop_post.cpp"
cmake -S src -B "$OUT" -G Ninja -DCMAKE_BUILD_TYPE=Release -DPKG_CONFIG_EXECUTABLE="$DEPS/pkg-config" -DFETCHCONTENT_BASE_DIR="$DEPS/fetchcontent" > "$OUT/configure.log" || { tail -20 "$OUT/configure.log"; exit 1; }
cmake --build "$OUT" -j2 -- -k 0 > "$OUT/build.log" || { grep -m20 -E "error|Error" "$OUT/build.log"; exit 1; }
nm -C --defined-only "$OUT/aloop" | awk '$2 ~ /^[TtWw]$/ { $1 = ""; print }' | grep "aloop::" | sort -u > "$OUT/symbols.txt"
echo "built $OUT/aloop ($(wc -l < "$OUT/symbols.txt") aloop:: symbols)"
