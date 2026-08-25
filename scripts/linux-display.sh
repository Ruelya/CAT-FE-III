#!/usr/bin/env bash
# Run a command under a virtual display for headless Linux CI/dev machines.
set -euo pipefail
if [[ -n "${DISPLAY:-}" ]]; then
  exec "$@"
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "xvfb-run is required when no DISPLAY is available" >&2
  exit 1
fi
exec xvfb-run --auto-servernum --server-args="-screen 0 1600x1000x24" "$@"
