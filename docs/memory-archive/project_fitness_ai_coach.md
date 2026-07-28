---
name: project-fitness-ai-coach
description: "Fitness module + AI Fitness Coach build (session 48) — full detail lives in CLAUDE.md; this tracks what's next"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ff2f8f6-3b67-4ede-9cbc-aa8eda2571ec
  modified: 2026-07-25T19:52:27.604Z
---

Built the full Fitness module (exercise library, programs, session logging, PRs, progress charts) plus an AI Coach (Gemini) that suggests workouts from goals/body stats/biological sex/injuries + recent Health Tracker readings (weight, resting HR, blood pressure, sleep, cholesterol/triglycerides/glucose) + today's energy/soreness check-in. Migrations 025–028 in jag_family. Full architecture detail, bugs found/fixed, and design decisions are written up in CLAUDE.md under "Fitness module + AI Fitness Coach (session 48)" and the OPEN ITEMS entry of the same name — read there first, this memory only tracks continuity state CLAUDE.md doesn't.

**Why:** Robert wanted an AI that asks about goals (strength/endurance/weight-loss), body specifics, and daily mood/energy, then suggests routines — modeled on the existing Gemini rent-suggestion pattern in Properties rather than new AI infra.

**Where it stands, end of session 48:**
- Live in production, verified end-to-end with real Gemini calls (not mocked).
- Robert wants the Health Tracker to grow into a fuller personal medical record ("Medical Record Tracker" or similar name — his call, not finalized), with the AI coach drawing on all of it.
- He's going to point Claude at a **local folder of medical documents** for Claude to read and extract from. **No folder path given yet** — this is the very next thing to pick up when he provides it.
- Likely shape once that happens: source documents into a DocVault-style vault (MinIO, tagged per family member) + structured numeric values extracted into `fam_lifestyle_tracker` (or a dedicated table if the data doesn't fit a simple metric/value/unit time series — e.g. medications, diagnosed conditions, provider visit notes are a different shape than a lab value). Migration 028 (cholesterol/triglycerides/glucose metric types) was the first step of this, done proactively before the folder was provided.
- See [[feedback-ai-coach-design-preferences]] for the durable preferences behind these choices.

**How to apply:** when Robert provides the folder path, start by reading the actual contents before proposing a schema — the shape of what's in there (lab report PDFs vs. scanned prescriptions vs. narrative visit notes vs. structured export) should drive the data model, not an assumption made in advance.
