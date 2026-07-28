# Memory archive

Verbatim copies of Claude's project memory files as they stood on **2026-07-27**, before
the memory directory was consolidated.

## Why this exists

Claude's memory directory (`~/.claude/projects/C--Users-rober-.../memory/`) had grown to
**324 KB across 76 files** — the same failure mode that took `CLAUDE.md` to 226 KB. Most
of it was session narrative ("what we built in session N"), which by the routing rule in
`../../CLAUDE.md` belongs in `docs/CHANGELOG.md`, not in memory. Memory is for durable,
hard-to-re-derive facts: preferences, working style, recurring gotchas.

The narratives were copied here **verbatim** before the memory files were compressed, so
nothing was lost — it moved from always-loaded memory into read-on-demand repo docs.

## When to read these

Rarely. `docs/CHANGELOG.md` is the maintained history and should be your first stop.
Reach for a file here only when you need the fuller blow-by-blow of one specific piece of
work and CHANGELOG's entry is too terse — e.g. the exact sequence of Meta template
failures, or the precise param spec of a WhatsApp template.

**These files are frozen.** Do not update them. New writeups go to `docs/CHANGELOG.md`.

## Caveat

Every file here is a point-in-time observation from the session that wrote it. Several
contain claims that were already superseded when archived (the WhatsApp file, for
instance, argues with itself across five sessions as templates went pending → approved).
Treat any specific claim as provisional and verify against the code before relying on it.
