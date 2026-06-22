# Hunter Platform — Anthropic Skill

This directory contains the [Anthropic Skills](https://docs.anthropic.com/en/docs/build-with-claude/skills) version of the Hunter Platform integration doc.

## What's inside

```
skills/hunter-platform/
├── SKILL.md      ← the file AI agents load (with YAML frontmatter)
├── README.md     ← this file (human-facing)
└── (optional examples/ or scripts/ can be added later)
```

## SKILL.md format

The `SKILL.md` file follows the Anthropic Skills spec:

```yaml
---
name: hunter-platform            # required
version: 1.8.0                   # optional but recommended
description: Use this skill...  # required (1-2 sentences, AI uses this to decide when to load)
license: MIT                    # optional
---
# Body content (markdown)...
```

The `description` field is the key part: it tells the AI **when** to load this skill. Make it specific and trigger-word-rich.

## How to use

### Option 1: Claude.ai Projects (simplest)

1. Zip this directory: `zip -r hunter-platform.zip skills/hunter-platform/`
2. Go to your Claude Project → Settings → Skills
3. Upload the zip
4. Claude will auto-load this skill when the description matches a user query

### Option 2: Claude Code (local)

Copy this directory to one of these locations:

```bash
# User-level (all your projects)
cp -r skills/hunter-platform/ ~/.claude/skills/

# Project-level (this project only)
cp -r skills/hunter-platform/ .claude/skills/
```

Restart Claude Code. The skill auto-loads on relevant queries.

### Option 3: Self-host on a URL

Upload `SKILL.md` to a public HTTPS URL (e.g., `https://your-domain.com/skills/hunter-platform/SKILL.md`) and tell your AI agent to fetch it when relevant.

Recommended in system prompt:
```
When the user asks about jobs, hiring, headhunters, candidates, recruitment, or talent matching,
fetch https://your-domain.com/skills/hunter-platform/SKILL.md and follow its instructions.
```

## Customization

The skill lives at `docs/superpowers/skill.md` in the main project (used by the runtime API at `GET /v1/skill.md`). To keep this version in sync:

```bash
# After updating docs/superpowers/skill.md
./scripts/sync-skill.sh   # (not yet created; manual: copy lines 6+ to here, keeping frontmatter)
```

## Versioning

The `version` field in frontmatter mirrors `package.json` and the `docs/superpowers/releases/v*.md` notes. When updating, bump all three.

| Component | Where | Example |
|---|---|---|
| Skill version | `SKILL.md` frontmatter | `version: 1.8.0` |
| Package version | `package.json` | `"version": "1.8.0"` |
| OpenAPI version | `docs/superpowers/openapi.json` | `"version": "1.8.0"` |
| Release notes | `docs/superpowers/releases/v1.8.md` | n/a |

## Maintenance

This skill is auto-generated from `docs/superpowers/skill.md` (the runtime API serves the same content). When you update the main skill doc, re-run the frontmatter extraction:

```bash
# In the project root
tail -n +5 docs/superpowers/skill.md > /tmp/body.md
# Then prepend the frontmatter and write to skills/hunter-platform/SKILL.md
```

(For now, this is manual. Future improvement: a `scripts/sync-skill.ts` to automate it.)
