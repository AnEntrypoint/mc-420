#!/bin/bash
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SERVED_DIR=${SERVED_DIR:-/srv/tftp/aloop-netboot}
ARCHIVE="$SERVED_DIR/aloop.apkovl.tar.gz"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
if [ $# -ge 1 ]; then BINARY=$1; else
  REPO=${REPO:-AnEntrypoint/mc-420}
  RUN=$(gh api "/repos/$REPO/actions/workflows/build-binary.yml/runs?branch=main&status=success&per_page=1" -q '.workflow_runs[0].id')
  AID=$(gh api "/repos/$REPO/actions/runs/$RUN/artifacts" -q '.artifacts[] | select(.name=="aloop-aarch64-musl") | .id')
  gh api "/repos/$REPO/actions/artifacts/$AID/zip" > "$WORK/artifact.zip"
  python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extract('aloop',sys.argv[2])" "$WORK/artifact.zip" "$WORK"
  BINARY="$WORK/aloop"
  echo "fetched aloop from build-binary run $RUN"
fi
tar -xzf "$ARCHIVE" -C "$WORK"
install -m 755 "$BINARY" "$WORK/opt/aloop/aloop"
tar -tzf "$ARCHIVE" > "$WORK/entries.before"
NEW=$(mktemp)
(cd "$WORK" && tar --numeric-owner --no-recursion -czf "$NEW" -T "$WORK/entries.before")
tar -tzf "$NEW" > "$WORK/entries.after"
cmp -s "$WORK/entries.before" "$WORK/entries.after" || { echo "entry list changed; refusing to install" >&2; exit 2; }
NEW_SHA=$(tar -xzOf "$NEW" ./opt/aloop/aloop | sha256sum | cut -c1-64)
WANT_SHA=$(sha256sum "$BINARY" | cut -c1-64)
[ "$NEW_SHA" = "$WANT_SHA" ] || { echo "binary sha mismatch in archive" >&2; exit 3; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cp -p "$ARCHIVE" "$ARCHIVE.bak-$STAMP"
install -m 644 "$NEW" "$ARCHIVE"
rm -f "$NEW"
echo "installed apkovl with aloop sha256 $WANT_SHA (backup $ARCHIVE.bak-$STAMP)"
