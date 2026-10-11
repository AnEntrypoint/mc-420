#!/usr/bin/env sh
echo "[build-local] Docker builds are not supported (no WSL/Docker). Build on GitHub Actions: gh workflow run build-binary.yml" >&2
exit 1
