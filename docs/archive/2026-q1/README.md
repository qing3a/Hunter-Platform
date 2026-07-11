# docs/archive/2026-q1

Historical documents from the v1.x development arc (2026-06-17 → 2026-06-23)
that are kept for historical reference but are no longer part of the active
docs surface.

## Contents

**Top-level archive** (moved from `docs/` on 2026-07-11):

| File | Why archived |
|------|--------------|
| `CHANGELOG.md` | Aggregated change log through v0.3.0 (2026-06-19); the project is at v1.8.0 with no continued changelog discipline. |
| `DELIVERY.md` | v1.0.0 delivery doc (2026-06-18); superseded by `docs/superpowers/release-notes/` (newer arc). |
| `RELEASE_NOTES_v1.0.md` | v1.0 release notes; superseded by later `docs/superpowers/release-notes/` files. |
| `FIX_PLAN.md`, `FIX_PLAN_v1.2_*.md`, `FIX_PLAN_v1.3*.md`, `FIX_PLAN_v1.4.md` | Six historical fix-plan docs (v1.1 → v1.4); all work completed and merged to main. |
| `GITHUB_RELEASE_SHORT.md` | One-off release blurb; never updated since v1.0. |
| `employer-api-inventory.md` | Pre-Phase-3 audit of `/v1/employer/*` endpoints; the inventory was consumed by the Employer Panel plan and the underlying code has since been renamed (R1.C2). |

**From `docs/superpowers/release-notes/`** (4 early release notes):

- `2026-06-19.md` — undated initial entry
- `2026-06-19-v0.2.1.md`, `2026-06-19-v1.0.md`, `2026-06-20-v1.4.1.md`

**From `docs/superpowers/reviews/`** (2 post-phase reviews):

- `2026-06-21-post-phase1-review.md`
- `2026-06-22-post-phase3-review.md`

## Why archive, not delete

The files are git-tracked, so `git log --follow <path>` still surfaces their
history after the move. Archiving keeps them queryable without keeping them
in the active reading path that `docs/` represents.

## When to delete instead

If after one release cycle nobody references these files via grep / git log,
they can be `git rm`'d to drop them entirely. Until then, archive is the
right trade-off (low cost, high findability).