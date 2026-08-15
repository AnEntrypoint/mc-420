#!/bin/bash
URL="$1"
OUT="$2"
TRIES="${3:-10}"
i=0
while [ $i -lt "$TRIES" ]; do
  if curl -sS --max-time 25 "$URL" -o "$OUT"; then
    if [ -s "$OUT" ]; then
      echo "OK after $((i+1)) tries: $OUT ($(wc -c < "$OUT") bytes)"
      exit 0
    fi
  fi
  i=$((i+1))
  sleep 2
done
echo "FAILED after $TRIES tries: $URL"
exit 1
