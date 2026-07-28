---
name: project-tenancy-listing-pipeline
description: "First real unit listing (Apt C1, 45 Eleventh Street) exposed that the whole public tenancy booking pipeline never worked end-to-end — MinIO presign, RLS, and a missing frontend page all fixed session 36"
metadata: 
  node_type: memory
  type: project
  originSessionId: 65f3884a-cbf4-4f55-a3b0-278587ce2d1b
---

Session 36 (2026-07-06) was Robert's first attempt to actually list a real vacant unit (Apt C1, 45 Eleventh Street, Barataria) using the tenancy module built in session 11. This surfaced that most of the pipeline had **never been exercised end-to-end** and had several dormant bugs:

- MinIO presigned URLs were built against the internal Docker hostname (`minio`), unreachable from browsers — every photo upload/gallery view was silently broken since the feature shipped.
- The public booking page (`/book/:slug`) had a working backend route but **no frontend page at all** — anonymous visitors hit the Keycloak-gated SPA and got a blank screen.
- The public booking API ran on a bare DB connection with no RLS owner context, so FORCE RLS silently returned zero rows for every request.
- The units-list query was missing `listing_status`/`listing_description`/`rent_amount`/utility columns entirely.
- `rent_amount` (Asking Rent field) referenced a column that was never migrated in.
- AI suggest-price query referenced a non-existent column (`l.rent_amount_ttd` vs real `l.monthly_rent`).

**Why:** all 25 units in the portfolio were sitting VACANT with the listing UI built but never used for a real listing — bugs like this only surface on first real use, not code review.

**How to apply:** if a feature in this codebase has UI + backend but no evidence of a completed real-world walkthrough (check for actual data, not just code existing), treat "it compiles and the route exists" as unverified. When picking up related tenancy/listing work, verify presigned MinIO URLs resolve from outside the VM and that public (unauthenticated) routes have explicit RLS scoping — both bug classes are silent (no server error) and only show up in the browser.

**What now works (Apt C1 is the reference example):** photo upload/reorder/caption, public booking page with screening questionnaire and day-grouped slot picker, WhatsApp confirmation on booking, viewing hours 7:30am–5:30pm, Open Graph branded link previews. See [[feedback-minio-presign-public-endpoint]] and [[feedback-rls-bare-connection-update]] for the specific technical fixes. Commit `4ed7f1a`.

**Still open:** Google Calendar event creation on booking submit failed silently in the live test (not yet root-caused); remaining 24 units still need photos/description/rent/utilities filled in.
