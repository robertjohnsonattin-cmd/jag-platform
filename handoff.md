# Session Handoff

## 1. Metadata

- **Date:** 2026-07-25
- **Project path:** `C:\Users\rober\Documents\Claude\Projects\JAG Holdings`
- **Git branch:** `main`
- **Context estimate:** Long session — built two major features end-to-end (full Fitness module, then AI Fitness Coach) with extensive live deploy/debug/browser-verification cycles. Likely near or past typical compaction range; treat this handoff as authoritative over re-reading the raw transcript.

## 2. Current Objective

Build a full Fitness module for the JAG platform, then layer an AI-driven "coach" on top of it (Gemini) that asks about goals, body specifics, and daily mood/readiness before suggesting a workout — factoring in real health data, not just generic profile fields. Both are done and deployed. The live thread now is Robert's stated next direction: expand the Lifestyle Health Tracker into a fuller personal medical record (tentatively "Medical Record Tracker") by having Claude read a folder of his medical documents and extract structured data from them — **he has not yet provided the folder path.**

## 3. Decisions Made & Rationale

- **Metric units (kg/cm) throughout the Fitness module, not imperial.** Initially defaulted exercise-weight logging to `lb`/`mi`. Robert explicitly corrected this mid-session ("let's use metric throughout instead") to match the pre-existing Health Tracker's `WEIGHT_KG` convention. Fixed via migration + Zod default + frontend state default, all flipped to kg/km. Full detail: [[feedback-ai-coach-design-preferences]] memory.
- **Reused the existing Gemini integration pattern (`listing.ts`'s `suggest-price`) rather than building new AI infra.** Plain `fetch`, `responseSchema` for structured JSON, same env vars. Zero new AI infrastructure.
- **AI-suggested workouts are NOT a separate data structure.** `POST /ai/suggest` inserts a normal `fam_workout_programs` (flagged `ai_generated = true`) + `fam_program_workouts` + `fam_program_exercises` row set, so the existing Programs/Log Workout/Progress/PR pipeline works on them unchanged. "Start This Workout" just calls the existing session-start endpoint.
- **AI is never asked to suggest a target weight per exercise.** No reliable way for a model to guess a person's actual working weight — left null, the person sets it based on how the previous set felt.
- **Server-side validates every AI-returned `exercise_id` against the real library** before insert — never trust the model to only emit real IDs it was shown.
- **AI Coach tab is the default landing tab** on the Fitness page (not "Log Workout") — it's meant to be the primary daily entry point.
- **Exercise library expanded from 38 → 80**, specifically matched to Robert's real home gym (photo he shared: cable multi-gym, dumbbells, barbell, adjustable bench w/ leg developer, treadmill, upright + recumbent bikes) rather than staying generic — Robert flagged that generic exercises + low variety per muscle group would make AI suggestions monotonous.
- **AI coach prompt explicitly moderates intensity for elevated health readings** (resting HR, cholesterol, triglycerides, glucose) even when stated energy is high — verified live with a real Gemini call. Framed as general fitness-programming judgment, not medical advice/diagnosis.
- **Health Tracker lab-marker expansion (cholesterol/triglycerides/glucose) done proactively** as the first step toward Robert's "full medical record" direction, before he's provided the actual documents.
- **CLAUDE.md and the auto-memory system were both updated** at the end of this session (user asked to "update the memory and records") — CLAUDE.md now has a full "Fitness module + AI Fitness Coach (session 48)" writeup, migration table rows, and an OPEN ITEMS entry; auto-memory has `project_fitness_ai_coach.md` and `feedback_ai_coach_design_preferences.md`. **Do not re-document this build from scratch in a future session — read CLAUDE.md's session-48 section first.**

## 4. Active & Critical Files

All below are **deployed to production and verified working**, but **not yet committed to git** (working tree is dirty — see git status). User has been asked twice this session whether to commit; hasn't answered yet.

- `jag-infra/migrations/jag_family/025_fitness_module.sql` — exercise library, programs, sessions, PRs. Applied to prod DB.
- `jag-infra/migrations/jag_family/026_ai_fitness_coach.sql` — fitness profiles, checkins, `ai_generated` flag. Applied.
- `jag-infra/migrations/jag_family/027_exercise_variety_and_health_context.sql` — 38→80 exercises, `biological_sex`, kg default fix. Applied.
- `jag-infra/migrations/jag_family/028_health_tracker_lab_markers.sql` — cholesterol/triglycerides/glucose metric types. Applied.
- `jag-api/src/routes/lifestyle/fitness.ts` — new file, full Fitness CRUD + PR auto-detection. Deployed.
- `jag-api/src/routes/lifestyle/ai-coach.ts` — new file, Gemini-backed suggestion endpoint + profile/checkin CRUD. Deployed.
- `jag-api/src/routes/lifestyle/index.ts` — `MetricEnum` extended with lab markers. Deployed.
- `jag-web/src/pages/Fitness.tsx` — new page, 6 tabs (AI Coach, Exercises, Programs, Log Workout, History, Progress, Records). Deployed.
- `jag-web/src/api/fitness.ts`, `jag-web/src/types/fitness.ts` — new. Deployed.
- `jag-web/src/api/lifestyle.ts`, `jag-web/src/pages/Lifestyle.tsx` — `MetricType` + label/icon/unit maps extended for lab markers. Deployed.
- `jag-web/src/auth/AuthProvider.tsx` — StrictMode double-init bug fixed (useRef guard). Deployed; this was a real pre-existing bug, not new-feature code.
- `jag-web/src/api/client.ts` — added `api.put()` method (needed for profile upsert). Deployed.
- `jag-infra/docker-compose.yml` — `GEMINI_API_KEY`/`GEMINI_MODEL` added to `api.environment` block (was missing entirely — also silently broke the pre-existing Properties rent-suggestion feature). Deployed + force-recreated on VM.
- `CLAUDE.md` — updated this session, see Decisions above. Not committed.
- `handoff.md` (this file) — new, written just now.

## 5. Immediate Next Steps

1. **Ask the user whether to commit** the accumulated working-tree changes (everything above) — this has been asked twice and not yet answered. Don't assume; ask again if picking this up fresh.
2. **Wait for Robert to provide the folder path** to his local medical documents. Do not proceed on the "Medical Record Tracker" expansion without it — nothing else is actionable there yet.
3. **When the folder is provided:** read its actual contents first before designing anything. The shape of what's there (lab report PDFs vs. scanned prescriptions vs. narrative doctor's notes vs. a structured export) should drive the data model — likely a combination of (a) document storage in a DocVault-style MinIO vault tagged per family member, and (b) structured value extraction into `fam_lifestyle_tracker` or a new dedicated table for data that doesn't fit a simple metric/value/unit shape (medications, diagnosed conditions, visit notes).
4. If picking this up as a fresh session with no memory of the above, read CLAUDE.md's "Fitness module + AI Fitness Coach (session 48)" section and OPEN ITEMS entry of the same name before doing anything else — full architecture and bug history is there, don't rediscover it.

## 6. Key Patterns & Constraints

- **This project has no staging tier.** Every deploy this session went straight to production (`jagcorporate.com` / VM at `150.136.151.64`). Migrations are always applied manually via `sudo -u postgres psql` over SSH — never auto-applied. See CLAUDE.md's deploy pattern notes if deploying again.
- **`deploy.sh --api-only --no-commit --no-push`** and **`--frontend-only --no-commit --no-push`** were used throughout — the `--no-commit`/`--no-push` flags matter because `deploy.sh`'s default behavior auto-commits (`git add -A`) after a successful deploy, which would have committed this work without being asked.
- **The `prod_modules/node_modules` tar-compression step in `deploy.sh` was unusually slow this session** (4-8 minutes vs. the ~6 seconds documented elsewhere in CLAUDE.md) — confirmed via direct process/file-size monitoring that it was genuinely progressing, not hung. Environmental, not a real problem, but don't assume a stall next time without checking `tasklist | findstr tar.exe` and watching the temp `.tar.gz` file grow before intervening.
- **Local frontend dev (`npm run dev` in `jag-web`) proxies `/api` straight to production** (`api.jagcorporate.com`) — there's no local backend. This only actually got exercised for the first time this session (see the StrictMode bug above).
- **Always grep `docker-compose.yml` before assuming a new `process.env.X` var is wired**, even if `.env` has it — 4th time this exact gap has bitten this project (see CLAUDE.md).
- **Test data hygiene:** every test performed against production (fitness profiles, checkins, sessions, logs, PRs, health tracker entries) was deleted via direct SQL after verification, using `WHERE family_member_id = '<Robert's UUID>'` scoping. Continue this pattern — never leave synthetic data attributed to a real person in production.
- **i18n convention on this project:** build in English first with inline fallback strings (`t('key', 'English fallback')`), translate to zh-CN in the same pass when reasonable, missing keys degrade gracefully. Followed throughout.

## 7. Resumption Instruction

Read `handoff.md` in the project root before doing anything else. The Fitness module and AI Fitness Coach are fully built, deployed, and verified — do not rebuild them. The working tree has uncommitted changes; ask the user whether to commit before touching git. The one open thread is Robert's plan to expand the Health Tracker into a fuller medical record by having you read a folder of his medical documents — if he hasn't given you that folder path yet, that's the only thing actually blocking forward progress, so ask for it rather than guessing at next steps.
