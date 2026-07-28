# Session Handoff — Context/token reduction

## 1. Metadata

- **Date:** 2026-07-27
- **Project path:** `C:\Users\rober\Documents\Claude\Projects\JAG Holdings`
- **Git branch:** `main` — in sync with `origin/main`. **History was rewritten and force-pushed this session** (see §5); all SHAs from 2026-07-26 onward changed. Anyone holding an older clone must re-clone, not pull.
- **Context estimate:** moderate. This session did doc/memory restructuring plus a git history rewrite; no application code was touched and no deploy was run.

## 2. Current Objective

Cut the token cost of *starting* a session on this project (231.6k tokens before any work began). Three levers: the 226 KB `CLAUDE.md` (done, prior session), the 324 KB memory directory (done, this session), and unused auto-installed plugins carrying 17 unauthenticated MCP servers (**still not done — needs UI action from Robert**). A fourth thread opened mid-session: family clinical data had been written into the git repo and needed removing.

## 3. Decisions Made & Rationale

- **Memory was consolidated the same way `CLAUDE.md` was: relocate, don't delete.** 25 session narratives were copied **verbatim into `docs/memory-archive/` and committed *before* any memory file was edited**, so content moved from always-loaded memory into read-on-demand repo docs. Memory went 324.6 KB / 76 files → ~185 KB / 75 files.
- **The four largest memory files were rewritten by hand, not scripted.** Phase status (40 KB), WhatsApp (25 KB), backups (17.7 KB), GPS (8.3 KB). Durable facts kept deliberately: the WABA/phone IDs, the three permanent `_v2` template names, "never delete a PENDING template", the tracker `uniqueId` formats, the two credentials that break GPS silently.
- **Mid-tier files were compressed by script with a safety fallback** — keep the opening statement plus every `Why:`/`How to apply:`/`Lesson:` paragraph, and if that yields under three paragraphs, keep the first four instead rather than gutting the file.
- **Two script defects were caught by inspecting output, not byte counts.** PowerShell 5.1's `Get-Content -Raw` reads as ANSI and mangled every em-dash (redone with explicit UTF-8 via `[System.IO.File]::ReadAllText`); and the first heuristic gutted files whose guidance wasn't bold-prefixed.
- **Clinical data does not belong in the repo — this was the significant call of the session.** Findings for four family members had been written into `docs/CHANGELOG.md` and `docs/rules/health-medical.md` and pushed to GitHub. A code repo's access model is "whoever holds the account", which is the wrong classification for medical data. The system of record is the `jag_family` DB (RLS, access model, backups); interpretation now lives in `C:\Users\rober\Dropbox\Family\Medical-Extraction-Notes.md`, beside the source documents it was extracted from.
- **Every transferable engineering lesson was kept, restated without the personal specifics** — "trace an alarming note back to its source result", "absence of a documented follow-up is itself a finding", "a citation that resolves to a real document is not proof the citation is correct".
- **Robert asked for the history purge explicitly** after being told the forward scrub left the pre-scrub versions reachable in git history.

## 4. Active & Critical Files

- `docs/memory-archive/` — 25 verbatim memory narratives + `README.md`. New, committed, pushed. **Frozen — never update these**; new writeups go to `docs/CHANGELOG.md`.
- `C:\Users\rober\Dropbox\Family\Medical-Extraction-Notes.md` — **sole home of the clinical detail** (per-person findings, re-review audit trail, method). Outside the repo by design. Not backed up by the repo's off-site push.
- `~\.claude\projects\C--Users-rober-...\memory\` — 75 files, ~185 KB. `MEMORY.md` rewritten to 11.6 KB / 107 lines, verified in sync (no file lacks an index line; no index line points at a missing file).
- `docs/CHANGELOG.md`, `docs/rules/health-medical.md`, `.claude/skills/extract-medical-records/SKILL.md` — scrubbed of clinical specifics.
- `CLAUDE.md` — one row added to the DOCUMENTATION MAP registering `docs/memory-archive/`.
- **Backups before the rewrite:** `C:\Users\rober\jag-platform-pre-rewrite-20260727.bundle` (3.9 MB, `--all`, `git bundle verify` reports a complete history). A second copy is in the session scratchpad. Restore with `git clone <bundle> <dir>`.
- `C:\Users\rober\jag-rw.git` — mirror clone the rewrite runs in. The working repo was deliberately left untouched until the result is verified.

## 5. Immediate Next Steps

1. ~~Delete and recreate the GitHub repo.~~ **DONE 2026-07-27.** Robert deleted `robertjohnsonattin-cmd/jag-platform` and recreated it empty; `main` was pushed to the fresh repo. **Verified against a clean clone of the new remote: 205 commits, 0 containing clinical terms, and three sampled pre-rewrite SHAs (`968c892`, `d4a0fb8`, `95fa6bd`) all return "not our ref".** This was the step that actually completed the purge — a force-push alone had left those commits fetchable by SHA, which was tested and confirmed at the time. Remaining cleanup: delete `C:\Users\rober\jag-platform-pre-rewrite-20260727.bundle` once Robert is satisfied — it is the only remaining copy of the unpurged history.
2. **Remove the unused plugins** via the desktop app's Directory → Plugins panel (⚙ gear = installed, ➕ plus = not installed). Uninstall `Engineering`, `Sales`, `PDF Viewer`, `product-tracking-skills`, `cowork-plugin-management` — all 0–1 uses. **Keep `anthropic-skills`** (33 uses).
3. **Verify in a NEW session and report real numbers.** Plugin and memory changes cannot affect a running session; tool and skill lists are assembled at startup.

## 6. Key Patterns & Constraints

- **The "Memory files ≈ 101.8k tokens" figure is an inference, not a measurement.** 324.6 KB at ~3.2 chars/token lands almost exactly on the context-panel number from the previous handoff, but the panel was never seen directly this session. Do not repeat it as measured fact.
- **`CLAUDE.md` and the memory directory must both stay flat.** Route new writeups per the `KEEPING THIS FILE SMALL` table. Memory holds durable, hard-to-re-derive facts — preferences, working style, recurring gotchas — never session narrative.
- **Never write family clinical detail into the repo or into memory.** Query `jag_family`, or read the Dropbox notes file.
- **Back up before any destructive git operation, and verify the backup restores** — not just that the file exists.
- **`deploy.sh` step 8 runs `git add -A`.** Check `git status` before deploying if there is unrelated WIP.
- **Robert asks for structural fixes, not one-time cleanups.** A fix that leaves the recurrence mechanism intact is not an answer.
- **Don't claim something is done without verifying it.** Both script defects this session were found by reading the output; byte counts would have hidden the mojibake entirely.

## 7. Resumption Instruction

Read `handoff.md` in the project root. The `CLAUDE.md` split, the memory consolidation, and the git history purge are **all complete, verified and pushed** — do not redo any of them, and do not re-litigate the clinical-data decision. Only two things remain, both needing Robert rather than code: removing the five unused plugins (step 5.2) and measuring a freshly-started session against the 231.6k baseline (step 5.3). Neither can be verified from inside a running session.
