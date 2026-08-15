#!/bin/bash
cd "$(dirname "$0")"
for f in *.f32; do
  case "$f" in
    *_ft.f32) continue ;;
  esac
  base="${f%.f32}"
  ./free_transpose_harness "$f" "${base}_ft.f32" 0.5 0.0
done
echo "batch done"
