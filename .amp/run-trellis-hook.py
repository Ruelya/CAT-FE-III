#!/usr/bin/env python3
"""Run a Claude-compatible Trellis hook for the Amp plugin bridge.

Usage:
  python .amp/run-trellis-hook.py <hook-relpath> <context-key> [session-id] [hook-event-name]
  python .amp/run-trellis-hook.py --status-line <context-key>

Env:
  TRELLIS_HOOK_PAYLOAD_B64 — optional base64 JSON stdin for the hook
  TRELLIS_HOOKS=0 / TRELLIS_DISABLE_HOOKS=1 — skip (exit 0, empty stdout)

Prints hook stdout (JSON with hookSpecificOutput.additionalContext, or bare text).
`--status-line` prints one short line for Amp status bar (e.g. "Trellis · asset-curation-center · in_progress").
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _status_line(context_key: str) -> int:
    """Emit a compact status bar line using Trellis active-task resolver."""
    root = _repo_root()
    scripts = root / ".trellis" / "scripts"
    if not scripts.is_dir():
        print("Trellis · not a project")
        return 0

    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))

    env = os.environ.copy()
    env["TRELLIS_CONTEXT_ID"] = context_key
    os.environ["TRELLIS_CONTEXT_ID"] = context_key

    try:
        from common.active_task import resolve_active_task  # type: ignore[import-not-found]
    except Exception:
        print("Trellis · (resolver unavailable)")
        return 0

    active = resolve_active_task(root, {"session_id": context_key}, platform="session")
    if not active.task_path:
        print("Trellis · no active task")
        return 0

    task_ref = active.task_path.replace("\\", "/")
    slug = task_ref.rstrip("/").split("/")[-1]
    # strip date prefix if present: 07-19-asset-curation-center
    if len(slug) > 6 and slug[2] == "-" and slug[5] == "-":
        short = slug[6:] or slug
    else:
        short = slug

    status = "?"
    task_dir = Path(task_ref)
    if not task_dir.is_absolute():
        task_dir = root / task_dir
    task_json = task_dir / "task.json"
    if task_json.is_file():
        try:
            data = json.loads(task_json.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("status"):
                status = str(data["status"])
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            pass

    if active.stale:
        status = "stale"

    # Keep short for status bar
    if len(short) > 28:
        short = short[:25] + "…"
    print(f"Trellis · {short} · {status}")
    return 0


def main() -> int:
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return 0

    if len(sys.argv) >= 2 and sys.argv[1] in ("--status-line", "status-line"):
        key = sys.argv[2] if len(sys.argv) > 2 else "amp_unknown"
        return _status_line(key)

    if len(sys.argv) < 3:
        print(
            "usage: run-trellis-hook.py <hook-relpath> <context-key> [session-id] [hook-event-name]\n"
            "       run-trellis-hook.py --status-line <context-key>",
            file=sys.stderr,
        )
        return 2

    hook_rel = sys.argv[1]
    context_key = sys.argv[2]
    session_id = sys.argv[3] if len(sys.argv) > 3 else context_key
    hook_event_name = sys.argv[4] if len(sys.argv) > 4 else "UserPromptSubmit"

    # Repo root = parent of .amp/
    root = _repo_root()
    hook_path = (root / hook_rel).resolve()
    if not hook_path.is_file():
        return 0

    payload_b64 = os.environ.get("TRELLIS_HOOK_PAYLOAD_B64", "")
    if payload_b64:
        try:
            payload = base64.b64decode(payload_b64).decode("utf-8")
        except Exception:
            payload = "{}"
    else:
        payload = json.dumps(
            {
                "cwd": str(root),
                "session_id": session_id,
                "hook_event_name": hook_event_name,
                "_trellis_platform": "amp",
            },
            ensure_ascii=False,
        )

    env = os.environ.copy()
    env["TRELLIS_CONTEXT_ID"] = context_key
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    try:
        result = subprocess.run(
            [sys.executable, "-W", "ignore", str(hook_path)],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(root),
            env=env,
            timeout=25,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    sys.stdout.write(result.stdout or "")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        for name in ("stdin", "stdout", "stderr"):
            stream = getattr(sys, name, None)
            if stream is not None and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass
    raise SystemExit(main())
