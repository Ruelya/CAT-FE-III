#!/usr/bin/env bash
#
# Run a command against a headless X display that has a real window manager.
#
# Electron's BrowserWindow.maximize() is a no-op under bare Xvfb because there
# is no window manager to honour the request, which makes the custom title bar
# maximize/restore assertions unreachable on the Linux validation lane. Adding
# fluxbox costs a few hundred milliseconds and makes that gate real instead of
# skipped.
#
# Windows and macOS run the suite directly; this wrapper is Linux only.
#
#   ./scripts/linux-display.sh pnpm test:e2e:desktop
#
set -euo pipefail

DISPLAY_NUM="${TRANSLUNAR_XVFB_DISPLAY:-:99}"
SCREEN="${TRANSLUNAR_XVFB_SCREEN:-2400x1500x24}"

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "Xvfb is not installed; run the suite on a real display instead." >&2
  exit 127
fi

Xvfb "${DISPLAY_NUM}" -screen 0 "${SCREEN}" >/tmp/translunar-xvfb.log 2>&1 &
XVFB_PID=$!

cleanup() {
  [ -n "${WM_PID:-}" ] && kill "${WM_PID}" 2>/dev/null || true
  kill "${XVFB_PID}" 2>/dev/null || true
}
trap cleanup EXIT

# Give the display a moment to accept connections.
for _ in $(seq 1 40); do
  if DISPLAY="${DISPLAY_NUM}" xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done

WM_PID=""
for wm in fluxbox openbox xfwm4; do
  if command -v "$wm" >/dev/null 2>&1; then
    DISPLAY="${DISPLAY_NUM}" "$wm" >/tmp/translunar-wm.log 2>&1 &
    WM_PID=$!
    sleep 1
    break
  fi
done

if [ -z "${WM_PID}" ]; then
  echo "No window manager found; maximize and restore assertions will fail." >&2
fi

DISPLAY="${DISPLAY_NUM}" "$@"
