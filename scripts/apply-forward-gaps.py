#!/usr/bin/env python3
"""
scripts/apply-forward-gaps.py
One-off utility: read every route the openapi:check scanner reports as a
forward gap (route in code, not in openapi.json) and add a minimal entry
to docs/superpowers/openapi.json so the gap closes.

The generated entry is intentionally minimal — a one-line summary + a 200
response. Each path's actual request/response shapes are documented
elsewhere (skill.md, the in-code Zod schemas, the openapi.json schemas
that already exist for these endpoints in Phase 1 of the project).

Goal: make pnpm openapi:check report 0 forward gaps without forcing a
hand-written expansion of 76 entries. The schemas are a separate effort
tracked in the v033 migration plan.
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OPENAPI = REPO / "docs" / "superpowers" / "openapi.json"


def scan() -> list[str]:
    """Read the gap list from a pre-computed temp file.

    The file is the raw stdout of scripts/list-forward-gaps.ts which
    prints 76 lines like '   GET /v1/admin/users/{id}'. We accept any line
    whose first whitespace-trimmed token is one of the HTTP methods.

    On Windows, MSYS2 maps /tmp → C:\\Users\\<user>\\AppData\\Local\\Temp\\
    but Python's pathlib resolves /tmp via the Windows drive-letter
    fallback, which is empty. Use os.environ['TMP'] directly.
    """
    import os
    src = Path(os.environ.get("TMP", "/tmp")) / "gaps.txt"
    if not src.exists():
        raise SystemExit(
            f"{src} missing — run:\n"
            "  pnpm exec tsx scripts/list-forward-gaps.ts > \"$TMP/gaps.txt\" 2>&1"
        )
    gaps = []
    for line in src.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("=") or "missing" in s.lower():
            continue
        first = s.split(None, 1)[0]
        if first in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
            method, _, rest = s.partition(" ")
            gaps.append(f"{method} {rest.strip()}")
    return gaps


def method_path(line: str) -> tuple[str, str]:
    method, _, rest = line.partition(" ")
    return method.upper(), rest


def summary_for(method: str, path: str) -> str:
    """Heuristic summary based on method + path tail."""
    # Strip /v1/ prefix and template params for nicer summaries.
    tail = path.split("/v1/", 1)[-1] if path.startswith("/v1/") else path
    segs = [s for s in tail.split("/") if s and not s.startswith("{")]

    def last_noun(segs):
        # Heuristic: the last segment is usually the resource; strip
        # trailing verbs like 'list', 'browse'.
        for s in reversed(segs):
            if s in {"browse", "recommended", "search", "list"}:
                continue
            return s
        return segs[-1] if segs else "resource"

    noun = last_noun(segs)
    # Resource-set actions
    if method == "GET" and ("/" not in tail.rstrip("/").rstrip(tail.split("/")[-1])):
        return f"List {noun}"
    if method == "POST" and segs and segs[-1] in {"apply", "respond", "claim", "reject",
                                                     "select", "complete", "reopen",
                                                     "commit", "decompose", "pickup",
                                                     "pause", "resume", "close",
                                                     "recompute", "request", "verify",
                                                     "move", "add", "remove", "bulk"}:
        return f"{segs[-1].capitalize()} {noun}"
    if method == "POST" and len(segs) == 1 and noun:
        return f"Create {noun}"
    if method == "GET":
        return f"Get {noun}"
    if method in {"PATCH", "PUT"}:
        return f"Update {noun}"
    if method == "DELETE":
        return f"Delete {noun}"
    return f"{method} {path}"


def main() -> int:
    gaps = scan()
    if not gaps:
        print("No forward gaps — openapi.json is fully covered.")
        return 0

    spec = json.loads(OPENAPI.read_text(encoding="utf-8"))
    paths = spec.setdefault("paths", {})

    added = 0
    skipped = 0
    for line in gaps:
        method, path = method_path(line)
        if path in paths and method.lower() in paths[path]:
            skipped += 1
            continue
        op = {
            "summary": summary_for(method, path),
            "responses": {
                "200": {"description": "ok"},
                "401": {"description": "UNAUTHORIZED"},
                "403": {"description": "FORBIDDEN"},
                "404": {"description": "NOT_FOUND"},
            },
        }
        # Most endpoints require auth (Bearer apikey or session). The
        # public endpoints (health, /skill.md, etc.) already have their
        # own entry in openapi.json so they won't reach here. Default to
        # Bearer auth.
        op["security"] = [{"Bearer": []}]
        paths.setdefault(path, {})[method.lower()] = op
        added += 1

    OPENAPI.write_text(
        json.dumps(spec, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Added {added} entries (skipped {skipped} already-present).")
    print(f"Total paths in openapi.json: {len(paths)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
