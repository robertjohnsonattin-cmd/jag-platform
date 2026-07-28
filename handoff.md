# Session Handoff — Context/token reduction

## 1. Metadata

- **Date:** 2026-07-27
- **Project path:** `C:\Users\rober\Documents\Claude\Projects\JAG Holdings`
- **Git branch:** `main` — **ahead of `origin/main` by 1 commit (unpushed)**
- **Context estimate:** moderate. This session did config inspection and scripted file splits rather than large file reads; no compaction occurred. The *starting* context of the session that prompted this work was 231.6k/967k (24%), which is the problem being solved.

## 2. Current Objective

Cut the token cost of *starting* a session on this project, which was 231.6k tokens before any work began and was burning the weekly usage limit on material irrelevant to most sessions. Two levers were identified: the 226 KB `CLAUDE.md` (done) and unused auto-installed plugins carrying 17 unauthenticated MCP servers (not done — needs UI action from Robert). Robert asked explicitly for a *structural* fix that prevents recurrence, not a one-time cleanup.

## 3. Decisions Made & Rationale

- **Split `CLAUDE.md` into an index + `docs/` tree rather than deleting content.** The content was genuinely valuable, just not needed *every* session — e.g. the Traccar GPS writeup loaded during medical-records work. Detail is now one `Read` away instead of always resident.
- **A `TOP GOTCHAS` section stays inline in `CLAUDE.md`.** About a dozen rules have each caused real production breakage more than once (`set_config` vs `SET LOCAL`, `NULLIF` in RLS policies, `req.rlsCtx` not `req.user`, the docker-compose env-wiring gap, `scp -r` stalls, date-only timezone shift). These must not depend on remembering to open a file, so they're one-line entries with pointers to full detail.
- **The routing rule is the actual fix, not the split.** `CLAUDE.md` grew ~5–8 KB/session because sessions appended full narratives; 99 of 104 `OPEN ITEMS` bullets were completed work. Without the new `KEEPING THIS FILE SMALL` section it would return to 226 KB by roughly October. A finished item now moves to `docs/CHANGELOG.md` and is deleted from `CLAUDE.md`.
- **The split was done with Python scripts, not by retyping.** 226 KB is far too much to reproduce by hand without transcription error.
- **Verified by line-by-line diff, not byte totals.** All 764 substantive lines of the original were checked for presence in the new set. This caught a 3-line Phase 7 preamble the extraction had silently dropped, which byte-count accounting would have missed (the new set is *larger* than the original because of added index text). Only 2 lines differ, both deliberately rewritten to point at `docs/`.
- **`docs/CHANGELOG.md` content was NOT re-verified against the running system.** It was converted from what `CLAUDE.md` claimed about itself. Anything mis-recorded before today is still mis-recorded, merely relocated — `CLAUDE.md` already warns in several places that a "DONE" entry reflects intent at write-time, not necessarily current VM reality.
- **Plugin keep/drop decided on measured usage, not guesswork.** `~/.claude.json` → `pluginUsage`: `anthropic-skills` 33 uses (keep), `engineering` 1, `sales` 0, `product-tracking-skills` 0, `cowork-plugin-management` 0, `pdf-viewer` 0. Also `officialMarketplaceAutoInstalled: true` — Robert never chose these; they were auto-installed at setup.
- **Plugin enablement is app-managed and cannot be changed from the filesystem.** Confirmed by checking `~/.claude/settings.json`, `~/.claude.json`, `~/.claude/plugins/`, and the Electron `Local Storage/leveldb` store — no enable/disable key exists in any of them. It requires the desktop app's Directory UI or an interactive `claude` terminal.

## 4. Active & Critical Files

- `CLAUDE.md` — rewritten as a 22 KB index (was 226,563 bytes). Committed and merged to `main`. Contains new `DOCUMENTATION MAP`, `TOP GOTCHAS`, and `KEEPING THIS FILE SMALL` sections; `OPEN ITEMS` reduced to the 6 genuinely-open entries.
- `docs/CHANGELOG.md` — 98 completed items moved out of `OPEN ITEMS`. New, committed. Never auto-loaded.
- `docs/route-map.md`, `docs/migrations.md` — routes/UI and the five DBs' migration tables. New, committed. These are the files to read before answering "does feature X exist".
- `docs/rules/*.md` — 9 files (`db-rls`, `deploy-infra`, `storage-minio`, `finance`, `properties`, `frontend`, `api-conventions`, `vehicles-gps`, `health-medical`). New, committed.
- `docs/mobile-app.md`, `docs/ops-scripts.md`, `docs/i18n.md` — new, committed.
- `C:\Users\rober\.claude\projects\C--Users-rober-Documents-Claude-Projects-JAG-Holdings\memory\feedback_claude_md_stays_an_index.md` — new memory entry recording the split and the routing rule, plus a pointer line added to `MEMORY.md`. Written, outside the repo.
- `handoff.md` — this file; overwrote a stale one from session 48 (2026-07-25, Fitness/AI-Coach).
- Branch `docs/split-claude-md` — merged into `main`, now redundant and safe to delete.
- No application code was touched this session. No deploy was run.

## 5. Immediate Next Steps

1. **Push `main` to the off-site backup** — it is 1 commit ahead of `origin/main`. The project convention is that "deployed" and "saved off-site" happen together; this commit is currently only local.
2. **Remove the unused plugins** via the desktop app's Directory → Plugins panel. In that UI a **⚙ gear means installed** and a **➕ plus means not installed**. As of the last screenshot, `Engineering`, `Sales`, and `PDF Viewer` still showed gears. Click the gear on **Engineering** and **Sales** and uninstall/disable; scroll for `product-tracking-skills` and `cowork-plugin-management` (also 0 uses) and do the same. **Do not remove `anthropic-skills`** — 33 uses.
3. **Verify in a NEW session** — plugin and memory changes cannot affect an already-running session, because the tool and skill lists are assembled at startup. In a fresh session check the context panel for: `Memory files` ≈ 18k (was 101.8k) and `MCP tools` well below 49.4k / 114 tools.
4. **Report the measured numbers.** Predicted: startup ~148k after the `CLAUDE.md` split alone, ~110k once plugins are removed, versus 231.6k before. These are estimates derived from byte counts and have not been confirmed against a real context panel.
5. **Delete the merged branch** `docs/split-claude-md` once the push is confirmed.
6. Optionally run `/consolidate-memory` — `MEMORY.md` is 19.5 KB with 60+ index lines, several duplicating what's now in `docs/`. Worth ~3–4k tokens, low priority next to the above.

## 6. Key Patterns & Constraints

- **`CLAUDE.md` must stay roughly flat in size.** Route new writeups per the `KEEPING THIS FILE SMALL` table: routes → `docs/route-map.md`, migrations → `docs/migrations.md`, gotchas → `docs/rules/*.md`, narratives and finished items → `docs/CHANGELOG.md`. If an edit to `CLAUDE.md` would add more than a few lines, it belongs in `docs/` with a pointer.
- **Feature registration is unchanged in force, only in destination.** It still happens the moment a route/migration/component file is created — it now lands in `docs/`. When adding a migration, grep the entire table for that DB to confirm no numbered file is missing an entry.
- **Before answering "does feature X exist", read `docs/route-map.md` and `docs/migrations.md`, then grep the code.** Never answer from recall; the docs have known gaps, so treat a denial as provisional.
- **`deploy.sh` step 8 runs `git add -A`.** Check `git status` before deploying if there is unrelated WIP in the tree.
- **Robert asks for structural fixes, not one-time cleanups.** When he says "so this does not happen again," a fix that leaves the recurrence mechanism intact is not an answer.
- **Don't claim something is done without verifying it.** This session's line-by-line diff caught a real 3-line loss that byte accounting hid; the plugin state was reported honestly as unconfirmed rather than assumed. This matches a documented recurring failure mode on this project where "documented as deployed" did not match VM reality.

## 7. Resumption Instruction

Read `handoff.md` in the project root. The `CLAUDE.md` split is complete, verified, and merged to `main` — do not redo it. Your first action is to push `main` to `origin` (it is 1 commit ahead and the off-site backup is stale), then confirm with Robert whether he has removed the `Engineering`, `Sales`, `PDF Viewer`, `product-tracking-skills`, and `cowork-plugin-management` plugins via the desktop Directory panel; if he has, ask him to paste the context panel from a freshly-started session so the actual token reduction can be measured against the predicted ~110k.
