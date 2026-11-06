#!/bin/bash
set -euo pipefail
SERVED_DIR=${SERVED_DIR:-/srv/tftp/aloop-netboot}
ARCHIVE="$SERVED_DIR/aloop.apkovl.tar.gz"
REPO=${REPO:-AnEntrypoint/mc-420}
PIN=${NETBOOT_PIN:-5acb7d3b48269432e64de63eb120f4fa5b4ab356}
LV2_SOURCE=${NETBOOT_LV2_DIR:-}
BINARY=${1:-}
if [ $# -ge 2 ]; then LV2_SOURCE=$2; fi
[ -f "$ARCHIVE" ] || { echo "served payload not found: $ARCHIVE" >&2; exit 2; }
[ -z "$BINARY" ] || [ -f "$BINARY" ] || { echo "binary not found: $BINARY" >&2; exit 2; }
WORK=$(mktemp -d "$SERVED_DIR/.refresh-apkovl.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

green_run() {
  gh api "/repos/$REPO/actions/workflows/$1/runs?head_sha=$PIN&status=success&per_page=1" \
    -q '.workflow_runs[0].id // empty'
}
fetch_artifact() {
  RUN=$1
  NAME=$2
  DEST=$3
  AID=$(gh api "/repos/$REPO/actions/runs/$RUN/artifacts" \
    -q "first(.artifacts[] | select(.name==\"$NAME\") | .id) // empty")
  [ -n "$AID" ] || { echo "artifact $NAME missing on run $RUN" >&2; exit 5; }
  mkdir -p "$DEST"
  gh api "/repos/$REPO/actions/artifacts/$AID/zip" > "$WORK/$NAME.zip"
  python3 -I -c '
import sys, zipfile
archive = zipfile.ZipFile(sys.argv[1])
dest = sys.argv[2]
for name in archive.namelist():
    if name.startswith("/") or ".." in name.split("/"):
        continue
    archive.extract(name, dest)
' "$WORK/$NAME.zip" "$DEST"
}

if [ -n "$BINARY" ]; then
  echo "using binary $BINARY (pin $PIN unchanged)"
else
  BIN_RUN=$(green_run build-binary.yml)
  [ -n "$BIN_RUN" ] || { echo "no green build-binary run for pin $PIN" >&2; exit 4; }
  fetch_artifact "$BIN_RUN" aloop-aarch64-musl "$WORK/artifacts/bin"
  BINARY="$WORK/artifacts/bin/aloop"
  [ -f "$BINARY" ] || { echo "aloop binary missing in build-binary run $BIN_RUN" >&2; exit 5; }
  echo "fetched aloop from build-binary run $BIN_RUN (pin $PIN)"
fi

mkdir -p "$WORK/ovl"
tar -xzf "$ARCHIVE" -C "$WORK/ovl"
mkdir -p "$WORK/ovl/effects/home" "$WORK/ovl/effects/resonode" \
         "$WORK/ovl/effects/pitchtracker" "$WORK/ovl/effects/delayverb" \
         "$WORK/ovl/opt/aloop"

STAGED=0
stage_bundles() {
  for bundle in "$1"/*.lv2; do
    if [ ! -d "$bundle" ]; then continue; fi
    name=$(basename "$bundle")
    case "$name" in
      aloop.lv2) continue ;;
      resonode.lv2) dest="$WORK/ovl/effects/resonode" ;;
      pitchtracker.lv2) dest="$WORK/ovl/effects/pitchtracker" ;;
      delayverb.lv2) dest="$WORK/ovl/effects/delayverb" ;;
      *) dest="$WORK/ovl/effects/home" ;;
    esac
    rm -rf "$dest/$name"
    cp -a "$bundle" "$dest/"
    STAGED=$((STAGED+1))
  done
}

for dir in home resonode pitchtracker delayverb; do
  for old in "$WORK/ovl/effects/$dir"/*.lv2; do
    if [ -d "$old" ]; then rm -rf "$old"; fi
  done
done

if [ -n "$LV2_SOURCE" ]; then
  [ -d "$LV2_SOURCE" ] || { echo "LV2 source dir not found: $LV2_SOURCE" >&2; exit 2; }
  stage_bundles "$LV2_SOURCE"
  echo "staged LV2 bundles from $LV2_SOURCE"
else
  LV2_RUN=$(green_run build-lv2.yml)
  [ -n "$LV2_RUN" ] || { echo "no green build-lv2 run for pin $PIN" >&2; exit 4; }
  for name in home-fx-lv2 guitar-lofi-fx-lv2 resonode-lv2 pitchtracker-lv2 delayverb-lv2; do
    dest="$WORK/artifacts/$name"
    fetch_artifact "$LV2_RUN" "$name" "$dest"
    stage_bundles "$dest"
  done
  echo "fetched LV2 bundles from build-lv2 run $LV2_RUN (pin $PIN)"
fi
[ "$STAGED" -gt 0 ] || { echo "no LV2 bundles staged for pin $PIN" >&2; exit 6; }

install -m 755 "$BINARY" "$WORK/ovl/opt/aloop/aloop"
NEW="$WORK/aloop.apkovl.tar.gz"
(cd "$WORK/ovl" && tar --numeric-owner -czf "$NEW" .)
tar -tzf "$ARCHIVE" > "$WORK/entries.before"
tar -tzf "$NEW" > "$WORK/entries.after"
grep -v '\.lv2' "$WORK/entries.before" > "$WORK/entries.keep" || true
sort -o "$WORK/entries.keep" "$WORK/entries.keep"
sort -o "$WORK/entries.after" "$WORK/entries.after"
comm -23 "$WORK/entries.keep" "$WORK/entries.after" > "$WORK/entries.missing"
[ ! -s "$WORK/entries.missing" ] || { echo "payload lost non-LV2 entries; refusing to install" >&2; cat "$WORK/entries.missing" >&2; exit 2; }

NEW_SHA=$(tar -xzOf "$NEW" ./opt/aloop/aloop | sha256sum | cut -c1-64)
WANT_SHA=$(sha256sum "$BINARY" | cut -c1-64)
[ "$NEW_SHA" = "$WANT_SHA" ] || { echo "binary sha mismatch in archive" >&2; exit 3; }

LV2_CHECKED=0
TTL_CHECKED=0
SO_CHECKED=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  got=$(tar -xzOf "$NEW" "./$rel" | sha256sum | cut -c1-64)
  want=$(sha256sum "$WORK/ovl/$rel" | cut -c1-64)
  [ "$got" = "$want" ] || { echo "LV2 sha mismatch in archive: $rel" >&2; exit 3; }
  LV2_CHECKED=$((LV2_CHECKED+1))
  case "$rel" in
    *.ttl) TTL_CHECKED=$((TTL_CHECKED+1)) ;;
    *.so) SO_CHECKED=$((SO_CHECKED+1)) ;;
  esac
done <<EOF
$(cd "$WORK/ovl" && find effects -type f \( -name '*.ttl' -o -name '*.so' \) -print | sort)
EOF
[ "$TTL_CHECKED" -gt 0 ] && [ "$SO_CHECKED" -gt 0 ] || { echo "rebuilt payload has no LV2 ttl/so entries" >&2; exit 3; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$ARCHIVE.bak-$STAMP"
cp -p "$ARCHIVE" "$BACKUP"
chmod 644 "$NEW"
mv -f "$NEW" "$ARCHIVE"
echo "installed apkovl with aloop sha256 $WANT_SHA, $STAGED LV2 bundles, $LV2_CHECKED ttl/so verified (backup $BACKUP)"
