# JAG Properties — Full Tenancy Lifecycle Build Specification
**For Claude Code implementation**
**Owner:** Robert Johnson-Attin | JAG Holdings
**Version:** 1.0 | **Date:** 2026-06-15
**Target modules:** `jag-api/` + `jag-web/` + `jag-infra/`

---

## OVERVIEW

This spec extends the JAG Properties module to cover the complete tenancy lifecycle:
**Advertising → Enquiry → Viewing → Application → Lease → Handover → Rent Collection → Maintenance → Renewal/Exit**

All engineering standards STD-01 through STD-13 apply to every line of code.
All new schema changes use node-pg-migrate. No raw SQL on production.
All financial writes carry idempotency keys.
All new routes at `/api/v1/`.

---

## EXTERNAL INTEGRATIONS REQUIRED

### 1. WhatsApp Business API (Meta Cloud API)
- Provider: Meta Cloud API (free tier — no Twilio needed at this scale)
- Requires: Meta Business account + verified phone number (dedicated JAG Properties number, NOT Robert's personal number)
- Webhook endpoint: `POST /internal/whatsapp/webhook` (no Keycloak auth — Meta-signed request; verify with `X-Hub-Signature-256` header)
- Outbound: `POST https://graph.facebook.com/v19.0/{phone-number-id}/messages`
- Env vars to add: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`
- All conversations stored in `prop_whatsapp_messages` table (see migrations)

### 2. Facebook Marketplace API (Meta Graph API)
- Auto-post new listings to Facebook Marketplace
- Endpoint: `POST https://graph.facebook.com/v19.0/{page-id}/listings`
- Requires: Facebook Page linked to Business account + `catalog_management` permission
- Env vars: `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`
- Triggered when unit status set to "Available" in JAG Properties

### 3. SMS (Twilio)
- Used for: SMS broadcast of listing summary, fallback when WhatsApp undelivered
- Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Broadcast: `POST /api/v1/properties/sms-broadcast` — sends listing summary to contact list

### 4. AI Rent Pricing (Ollama — already on platform)
- Model: `llama3.2` (already running on main Windows workstation)
- Input: unit size (sqft), bedrooms, bathrooms, location, included utilities, comparable units from JAG Properties DB
- Output: suggested rent range (TTD min / max / recommended)
- Route: `POST /api/v1/properties/units/:id/suggest-price`

### 5. Calendar Booking (Google Calendar API)
- Robert manages his availability directly in Google Calendar — no slot configuration inside JAG
- Google Calendar API reads Robert's free/busy slots and presents them to prospects on the public booking page
- On booking: JAG creates a Google Calendar event with Robert + prospect as attendees; Google sends calendar invites automatically
- JAG also sends WhatsApp + email confirmation independently
- Requires: Google Cloud project, Calendar API enabled, OAuth 2.0 service account with domain-wide delegation OR Robert's personal OAuth token
- Env vars: `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 JSON), `GOOGLE_CALENDAR_LOOKAHEAD_DAYS` (default: 14)
- Public booking page: `https://jagcorporate.com/book/:unit-slug` — no auth required
- Slot display: show available 30-min windows within Robert's working hours (configurable, e.g. 09:00–17:00 Mon–Sat), excluding existing calendar events
- On booking confirmed: create Google Calendar event titled "Property Viewing — [Unit Address] — [Prospect Name]", add description with unit details and prospect phone

---

## DATABASE MIGRATIONS

### jag_properties database

#### Migration 013 — Enquiries & Lead Capture
```sql
-- prop_enquiries: one record per inbound prospect contact
CREATE TABLE prop_enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  unit_id UUID REFERENCES prop_units(id) ON DELETE SET NULL,
  property_id UUID REFERENCES prop_properties(id) ON DELETE SET NULL,
  -- Prospect info
  prospect_name VARCHAR(200),
  prospect_phone VARCHAR(30),
  prospect_email VARCHAR(200),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL','PHONE','WALK_IN','FACEBOOK')),
  -- Message
  initial_message TEXT,
  -- Pipeline stage
  stage VARCHAR(30) NOT NULL DEFAULT 'NEW_LEAD'
    CHECK (stage IN ('NEW_LEAD','VIEWING_SCHEDULED','VIEWED','APPLICATION_SENT','APPLICATION_RECEIVED','SCREENING','APPROVED','REJECTED','WITHDRAWN','CONVERTED')),
  -- Flags
  no_show BOOLEAN DEFAULT FALSE,
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  -- WhatsApp conversation thread ID
  wa_thread_id VARCHAR(100),
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ,
  owner_id_rls UUID -- for RLS (same as owner_id)
);

-- RLS
ALTER TABLE prop_enquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_enquiries_owner ON prop_enquiries
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_enquiries_unit ON prop_enquiries(unit_id);
CREATE INDEX idx_prop_enquiries_stage ON prop_enquiries(stage);
CREATE INDEX idx_prop_enquiries_phone ON prop_enquiries(prospect_phone);
```

#### Migration 014 — Scheduled Viewings
```sql
-- NOTE: No prop_viewing_slots table — availability is managed in Google Calendar directly.
-- JAG queries the Google Calendar API at booking time to get free slots.

-- prop_viewings: actual scheduled viewings (JAG record; Google Calendar is source of truth for the event)
CREATE TABLE prop_viewings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  enquiry_id UUID NOT NULL REFERENCES prop_enquiries(id) ON DELETE CASCADE,
  slot_id UUID REFERENCES prop_viewing_slots(id) ON DELETE SET NULL,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','CONFIRMED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED')),
  -- Confirmation & reminder flags
  confirmation_sent_at TIMESTAMPTZ,
  reminder_24h_sent_at TIMESTAMPTZ,
  reminder_1h_sent_at TIMESTAMPTZ,
  no_show_followup_sent_at TIMESTAMPTZ,
  post_viewing_app_link_sent_at TIMESTAMPTZ,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_viewings ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_viewings_owner ON prop_viewings
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_viewings_scheduled ON prop_viewings(scheduled_at);
CREATE INDEX idx_prop_viewings_status ON prop_viewings(status);
```

#### Migration 015 — Rental Applications
```sql
-- prop_applications: formal rental application per prospect
CREATE TABLE prop_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  enquiry_id UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  -- Applicant details
  full_name VARCHAR(200) NOT NULL,
  date_of_birth DATE,
  national_id VARCHAR(50),
  email VARCHAR(200),
  phone VARCHAR(30),
  -- Employment
  employer_name VARCHAR(200),
  employment_type VARCHAR(30) CHECK (employment_type IN ('EMPLOYED','SELF_EMPLOYED','CONTRACT','RETIRED','UNEMPLOYED','OTHER')),
  monthly_income_ttd NUMERIC(12,2),
  employment_letter_url TEXT,
  -- References
  reference_1_name VARCHAR(200),
  reference_1_phone VARCHAR(30),
  reference_1_relation VARCHAR(100),
  reference_2_name VARCHAR(200),
  reference_2_phone VARCHAR(30),
  reference_2_relation VARCHAR(100),
  prior_landlord_name VARCHAR(200),
  prior_landlord_phone VARCHAR(30),
  -- Documents (MinIO URLs)
  national_id_url TEXT,
  payslip_1_url TEXT,
  payslip_2_url TEXT,
  payslip_3_url TEXT,
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','WITHDRAWN')),
  rejection_reason TEXT,
  -- Reminders
  form_sent_at TIMESTAMPTZ,
  reminder_48h_sent_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  decision_at TIMESTAMPTZ,
  decided_by UUID,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_applications_owner ON prop_applications
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_applications_unit ON prop_applications(unit_id);
CREATE INDEX idx_prop_applications_status ON prop_applications(status);
```

#### Migration 016 — Security Deposits
```sql
-- prop_deposits: security deposit per tenancy (separate from rent income)
CREATE TABLE prop_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  lease_id UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  tenant_name VARCHAR(200) NOT NULL,
  -- Deposit details
  amount_ttd NUMERIC(12,2) NOT NULL,
  months_equivalent NUMERIC(4,1),
  payment_method VARCHAR(20) CHECK (payment_method IN ('BANK_TRANSFER','CHEQUE','CASH')),
  received_date DATE NOT NULL,
  reference_bank VARCHAR(100), -- Republic Bank / First Citizens
  reference_number VARCHAR(100),
  -- Holding account
  held_in_account VARCHAR(200),
  -- Receipt
  receipt_number VARCHAR(50) UNIQUE,
  receipt_pdf_url TEXT,
  receipt_sent_at TIMESTAMPTZ,
  -- Exit reconciliation
  status VARCHAR(20) NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD','PARTIALLY_RETURNED','RETURNED','FORFEITED')),
  deductions_ttd NUMERIC(12,2) DEFAULT 0,
  deduction_notes TEXT,
  refund_amount_ttd NUMERIC(12,2),
  refund_date DATE,
  reconciliation_statement_url TEXT,
  tenant_signed_off BOOLEAN DEFAULT FALSE,
  -- Idempotency
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_deposits_owner ON prop_deposits
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
```

#### Migration 017 — Rent Schedule
```sql
-- prop_rent_schedule: auto-generated monthly rent due dates per lease
CREATE TABLE prop_rent_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  lease_id UUID NOT NULL REFERENCES prop_lease_agreements(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  tenant_name VARCHAR(200) NOT NULL,
  tenant_phone VARCHAR(30),
  tenant_email VARCHAR(200),
  -- Period
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  due_date DATE NOT NULL,
  amount_due_ttd NUMERIC(12,2) NOT NULL,
  -- Payment
  status VARCHAR(20) NOT NULL DEFAULT 'UPCOMING'
    CHECK (status IN ('UPCOMING','REMINDER_SENT','PAID','PARTIAL','LATE','WAIVED')),
  paid_amount_ttd NUMERIC(12,2),
  paid_date DATE,
  payment_method VARCHAR(20) CHECK (payment_method IN ('BANK_TRANSFER','CHEQUE','CASH')),
  payment_reference VARCHAR(200),
  account_received VARCHAR(200),
  -- Late fees
  late_fee_applied BOOLEAN DEFAULT FALSE,
  late_fee_amount_ttd NUMERIC(12,2),
  late_fee_applied_at TIMESTAMPTZ,
  -- Reminders (track what was sent)
  reminder_d5_sent_at TIMESTAMPTZ,
  reminder_d1_sent_at TIMESTAMPTZ,
  reminder_d1_sms_sent_at TIMESTAMPTZ,
  overdue_d1_sent_at TIMESTAMPTZ,
  overdue_d3_sent_at TIMESTAMPTZ,
  overdue_d7_sent_at TIMESTAMPTZ,
  overdue_d14_flagged_at TIMESTAMPTZ,
  -- Receipt
  receipt_number VARCHAR(50),
  receipt_pdf_url TEXT,
  receipt_sent_at TIMESTAMPTZ,
  -- Idempotency
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lease_id, period_year, period_month)
);

ALTER TABLE prop_rent_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_rent_schedule_owner ON prop_rent_schedule
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_rent_due_date ON prop_rent_schedule(due_date);
CREATE INDEX idx_prop_rent_status ON prop_rent_schedule(status);
```

#### Migration 018 — Handover Checklists
```sql
-- prop_handover_checklists: entry and exit inspections
CREATE TABLE prop_handover_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  lease_id UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('ENTRY','EXIT')),
  -- Meter readings
  tec_meter_reading VARCHAR(50),
  tec_account_number VARCHAR(50),
  wasa_meter_reading VARCHAR(50),
  wasa_account_number VARCHAR(50),
  -- Condition fields (JSON for flexibility)
  condition_items JSONB NOT NULL DEFAULT '[]',
  -- e.g. [{"item": "Living Room Walls", "condition": "Good", "notes": "Minor scuff near door", "photo_urls": ["..."]}]
  -- Inventory
  inventory_items JSONB NOT NULL DEFAULT '[]',
  -- e.g. [{"item": "Stove", "qty": 1, "condition": "Good", "serial": "..."}]
  -- Keys
  keys_issued INT DEFAULT 0,
  keys_returned INT,
  gate_remotes_issued INT DEFAULT 0,
  gate_remotes_returned INT,
  -- Photos
  photo_urls JSONB NOT NULL DEFAULT '[]',
  -- Signatures
  tenant_signed BOOLEAN DEFAULT FALSE,
  tenant_signed_at TIMESTAMPTZ,
  manager_signed BOOLEAN DEFAULT FALSE,
  manager_signed_at TIMESTAMPTZ,
  handover_form_url TEXT,
  -- Notes
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_handover_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_handover_checklists_owner ON prop_handover_checklists
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
```

#### Migration 019 — Maintenance Tickets
```sql
-- prop_contractors: preferred contractor list
CREATE TABLE prop_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  trade VARCHAR(50) NOT NULL CHECK (trade IN ('PLUMBING','ELECTRICAL','STRUCTURAL','PEST_CONTROL','APPLIANCE','PAINTING','GENERAL','OTHER')),
  phone VARCHAR(30),
  whatsapp VARCHAR(30),
  email VARCHAR(200),
  rate_description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_contractors_owner ON prop_contractors
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

-- prop_maintenance_tickets: issue tracking
CREATE TABLE prop_maintenance_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  property_id UUID REFERENCES prop_properties(id) ON DELETE SET NULL,
  lease_id UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  -- Ticket ID (human-readable)
  ticket_ref VARCHAR(20) UNIQUE NOT NULL, -- e.g. MNT-2026-0001
  -- Reporter
  reported_by_name VARCHAR(200),
  reported_by_phone VARCHAR(30),
  report_channel VARCHAR(20) CHECK (report_channel IN ('WHATSAPP','SMS','PORTAL','PHONE','EMAIL')),
  -- Issue details
  category VARCHAR(30) NOT NULL CHECK (category IN ('PLUMBING','ELECTRICAL','STRUCTURAL','PEST','APPLIANCE','OTHER')),
  description TEXT NOT NULL,
  photo_urls JSONB DEFAULT '[]',
  -- Priority: P1=Emergency, P2=Urgent, P3=Routine, P4=Planned
  priority VARCHAR(2) NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
  priority_auto_suggested VARCHAR(2),
  priority_confirmed_by UUID,
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','PENDING_PARTS','RESOLVED','CLOSED','CANCELLED')),
  -- SLA (hours)
  sla_hours INT, -- P1=2, P2=24, P3=120, P4=null
  sla_breach_at TIMESTAMPTZ,
  sla_breached BOOLEAN DEFAULT FALSE,
  -- Contractor
  contractor_id UUID REFERENCES prop_contractors(id) ON DELETE SET NULL,
  contractor_notified_at TIMESTAMPTZ,
  estimated_visit_at TIMESTAMPTZ,
  -- Resolution
  resolution_notes TEXT,
  completion_photo_urls JSONB DEFAULT '[]',
  resolved_at TIMESTAMPTZ,
  cost_ttd NUMERIC(12,2),
  expense_id UUID, -- link to fin_expense once logged
  -- Satisfaction
  tenant_satisfied BOOLEAN,
  tenant_feedback TEXT,
  -- Acknowledgment
  ack_sent_at TIMESTAMPTZ,
  tenant_visit_notified_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_maintenance_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_maintenance_tickets_owner ON prop_maintenance_tickets
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_prop_tickets_status ON prop_maintenance_tickets(status);
CREATE INDEX idx_prop_tickets_unit ON prop_maintenance_tickets(unit_id);
CREATE INDEX idx_prop_tickets_priority ON prop_maintenance_tickets(priority);

-- prop_ticket_updates: status history log
CREATE TABLE prop_ticket_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  ticket_id UUID NOT NULL REFERENCES prop_maintenance_tickets(id) ON DELETE CASCADE,
  status_from VARCHAR(20),
  status_to VARCHAR(20),
  note TEXT,
  updated_by UUID,
  wa_notification_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_ticket_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_ticket_updates_owner ON prop_ticket_updates
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
```

#### Migration 020 — WhatsApp Message Log
```sql
-- prop_whatsapp_messages: all inbound and outbound WhatsApp messages
CREATE TABLE prop_whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  wa_message_id VARCHAR(200) UNIQUE, -- Meta's message ID
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  from_number VARCHAR(30),
  to_number VARCHAR(30),
  -- Linked records (nullable — message may not yet be linked)
  enquiry_id UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES prop_maintenance_tickets(id) ON DELETE SET NULL,
  -- Message content
  message_type VARCHAR(20) CHECK (message_type IN ('TEXT','TEMPLATE','INTERACTIVE','IMAGE','DOCUMENT','AUDIO')),
  body TEXT,
  template_name VARCHAR(100),
  media_url TEXT,
  -- Status (outbound)
  delivery_status VARCHAR(20) CHECK (delivery_status IN ('SENT','DELIVERED','READ','FAILED')),
  failed_reason TEXT,
  -- Timestamps
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_whatsapp_messages_owner ON prop_whatsapp_messages
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_wa_messages_from ON prop_whatsapp_messages(from_number);
CREATE INDEX idx_wa_messages_enquiry ON prop_whatsapp_messages(enquiry_id);
CREATE INDEX idx_wa_messages_ticket ON prop_whatsapp_messages(ticket_id);
```

#### Migration 021 — Renewal Tracking
```sql
-- prop_renewal_notices: lease renewal workflow
CREATE TABLE prop_renewal_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  lease_id UUID NOT NULL REFERENCES prop_lease_agreements(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES prop_units(id) ON DELETE CASCADE,
  -- Notice details
  notice_sent_at TIMESTAMPTZ,
  d60_sent_at TIMESTAMPTZ,
  d30_sent_at TIMESTAMPTZ,
  d14_sent_at TIMESTAMPTZ,
  -- Tenant decision
  tenant_response VARCHAR(20) CHECK (tenant_response IN ('RENEWING','VACATING','DISCUSSING','NO_RESPONSE')),
  tenant_responded_at TIMESTAMPTZ,
  -- New lease details (if renewing)
  new_rent_ttd NUMERIC(12,2),
  new_lease_id UUID REFERENCES prop_lease_agreements(id) ON DELETE SET NULL,
  -- Vacating
  vacating_date DATE,
  exit_inspection_scheduled_at TIMESTAMPTZ,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_renewal_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_renewal_notices_owner ON prop_renewal_notices
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);
```

#### Migration 022 — Unit enhancements
```sql
-- Add utility flags and listing fields to prop_units
ALTER TABLE prop_units
  ADD COLUMN IF NOT EXISTS wasa_included BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS electricity_included BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS internet_included BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS listing_status VARCHAR(20) DEFAULT 'VACANT'
    CHECK (listing_status IN ('VACANT','LISTED','OCCUPIED','MAINTENANCE')),
  ADD COLUMN IF NOT EXISTS facebook_listing_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS facebook_listed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suggested_rent_min_ttd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS suggested_rent_max_ttd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS suggested_rent_recommended_ttd NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS days_on_market INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_slug VARCHAR(100) UNIQUE; -- for public booking URL
```

---

## API ROUTES

All routes in `jag-api/src/routes/properties/`. Register in `src/app.ts`.

### routes/properties/enquiries.ts
```
GET    /api/v1/properties/enquiries                    — list all enquiries (filterable by unit, stage)
POST   /api/v1/properties/enquiries                    — create enquiry manually
GET    /api/v1/properties/enquiries/:id                — get single enquiry with WA message thread
PATCH  /api/v1/properties/enquiries/:id                — update stage, flag, notes
DELETE /api/v1/properties/enquiries/:id                — soft-delete / archive
POST   /api/v1/properties/enquiries/:id/send-reply     — send WhatsApp/SMS reply (click-to-send or auto)
POST   /api/v1/properties/enquiries/:id/send-app-link  — send application form link
```

### routes/properties/viewings.ts
```
GET    /api/v1/properties/viewings                     — list viewings (filterable by status, unit)
PATCH  /api/v1/properties/viewings/:id                 — update status (confirmed/no-show/completed)
GET    /api/v1/properties/viewings/available-slots     — proxy to Google Calendar API; returns free 30-min windows
                                                         query params: unitId, from (date), to (date)
GET    /api/v1/public/book/:slug                       — PUBLIC: get unit info + available slots from Google Calendar (no auth)
POST   /api/v1/public/book/:slug                       — PUBLIC: book a slot — creates Google Calendar event + prop_viewings record + sends WA/email confirmation (no auth)
```

#### Google Calendar integration logic (in `src/lib/google-calendar.ts`):
```typescript
// Get available slots
// 1. Call Google Calendar FreeBusy API for Robert's calendar over next GOOGLE_CALENDAR_LOOKAHEAD_DAYS
// 2. Generate all 30-min windows within working hours (e.g. 09:00–17:00 Mon–Sat)
// 3. Remove windows that overlap with busy periods
// 4. Return available slots array

// Create booking event
// 1. POST to Google Calendar Events API
// 2. Event title: "Property Viewing — {unit_address} — {prospect_name}"
// 3. Description: unit details, prospect phone, JAG enquiry ID
// 4. Attendees: [robert_email, prospect_email] — Google sends invites automatically
// 5. Duration: 30 minutes
// 6. Store returned Google event ID in prop_viewings.google_event_id
```

Add column to `prop_viewings`:
```sql
ALTER TABLE prop_viewings ADD COLUMN IF NOT EXISTS google_event_id VARCHAR(200);
```

### routes/properties/applications.ts
```
GET    /api/v1/properties/applications                 — list applications
POST   /api/v1/properties/applications                 — create application
GET    /api/v1/properties/applications/:id             — get application + documents
PATCH  /api/v1/properties/applications/:id             — update status / add notes
POST   /api/v1/properties/applications/:id/decide      — approve or reject (body: {decision, reason})
POST   /api/v1/properties/applications/:id/upload-doc  — presigned URL for document upload to MinIO
```

### routes/properties/deposits.ts
```
GET    /api/v1/properties/deposits                     — list all deposits
POST   /api/v1/properties/deposits                     — record deposit received
GET    /api/v1/properties/deposits/:id                 — get deposit detail
PATCH  /api/v1/properties/deposits/:id/reconcile       — record exit reconciliation + refund
GET    /api/v1/properties/deposits/:id/receipt         — download PDF receipt
```

### routes/properties/rent-schedule.ts
```
GET    /api/v1/properties/rent-schedule                — list rent periods (filterable by status, unit, year)
POST   /api/v1/properties/rent-schedule/generate       — generate schedule from lease (called on lease activation)
GET    /api/v1/properties/rent-schedule/:id            — single rent period detail
POST   /api/v1/properties/rent-schedule/:id/record-payment — record payment received
GET    /api/v1/properties/rent-schedule/:id/receipt    — download PDF receipt
POST   /api/v1/properties/rent-schedule/:id/waive      — waive a period (with reason)
```

### routes/properties/handover.ts
```
GET    /api/v1/properties/handover/:unitId              — get entry + exit checklists for unit
POST   /api/v1/properties/handover                     — create new checklist (entry or exit)
PATCH  /api/v1/properties/handover/:id                 — update checklist (add items, photos, sign off)
GET    /api/v1/properties/handover/:id/compare         — compare entry vs exit checklist (for deposit reconciliation)
```

### routes/properties/maintenance.ts
```
GET    /api/v1/properties/maintenance                  — list tickets (filterable by status, priority, unit)
POST   /api/v1/properties/maintenance                  — create ticket
GET    /api/v1/properties/maintenance/:id              — get ticket + updates log
PATCH  /api/v1/properties/maintenance/:id              — update status, assign contractor, add notes
POST   /api/v1/properties/maintenance/:id/resolve      — mark resolved + upload completion photo + log cost
POST   /api/v1/properties/maintenance/:id/satisfaction — record tenant satisfaction response
GET    /api/v1/properties/contractors                  — list contractors
POST   /api/v1/properties/contractors                  — add contractor
PATCH  /api/v1/properties/contractors/:id              — update contractor
```

### routes/properties/renewals.ts
```
GET    /api/v1/properties/renewals                     — list all renewal notices
POST   /api/v1/properties/renewals                     — create renewal notice for a lease
PATCH  /api/v1/properties/renewals/:id                 — record tenant response
POST   /api/v1/properties/renewals/:id/renew           — process renewal: generate new lease, extend schedule
POST   /api/v1/properties/renewals/:id/vacate          — process vacating: set dates, trigger exit flow
```

### routes/properties/listing.ts (new — extend existing)
```
POST   /api/v1/properties/units/:id/list               — set unit to Listed, auto-post to Facebook, generate SMS summary
POST   /api/v1/properties/units/:id/suggest-price      — AI rent suggestion via Ollama
POST   /api/v1/properties/units/:id/sms-broadcast      — send SMS listing summary to contact list
POST   /api/v1/properties/units/:id/unlist             — remove from listing, update Facebook
```

### routes/internal/whatsapp-webhook.ts
```
GET    /internal/whatsapp/webhook                      — Meta webhook verification (VERIFY_TOKEN check)
POST   /internal/whatsapp/webhook                      — inbound messages (X-Hub-Signature-256 validated)
                                                        — auto-creates or links to prop_enquiries
                                                        — auto-creates maintenance ticket if tenant detected
                                                        — stores in prop_whatsapp_messages
                                                        — no Keycloak auth (Docker-network-accessible — but this MUST be exposed to Meta's servers)
```

### routes/properties/whatsapp-send.ts (outbound helper)
```
POST   /api/v1/properties/whatsapp/send-template       — send a WhatsApp template message
POST   /api/v1/properties/whatsapp/send-text           — send a plain text WhatsApp message
POST   /api/v1/properties/whatsapp/send-interactive    — send button/list menu
GET    /api/v1/properties/whatsapp/conversations       — list conversations (grouped by phone number)
GET    /api/v1/properties/whatsapp/conversations/:phone — thread view for one number
```

---

## SCHEDULED JOBS (add to VM cron + Windows Task Scheduler)

### VM cron additions (`jag-infra/scripts/`)

#### `rent-reminders.sh` — runs daily at 07:00 UTC (03:00 TT)
Logic (implement in `scripts/rent-reminders/index.ts`, compiled and called by shell):
1. Query `prop_rent_schedule` WHERE `status IN ('UPCOMING','REMINDER_SENT')` AND `due_date BETWEEN NOW() AND NOW()+6 days`
2. For each record where `reminder_d5_sent_at IS NULL` AND `due_date = TODAY+5`: send D-5 WhatsApp reminder, update flag
3. For each record where `reminder_d1_sent_at IS NULL` AND `due_date = TODAY+1`: send D-1 WhatsApp, SMS fallback, update flag
4. For each record where `due_date < TODAY` AND `status NOT IN ('PAID','WAIVED')`:
   - D+1: send overdue notice (flag `overdue_d1_sent_at`)
   - D+3: apply late fee (5% per lease), send notice (flag `overdue_d3_sent_at`)
   - D+7: generate formal notice PDF via DocVault, send all channels (flag `overdue_d7_sent_at`)
   - D+14: flag `overdue_d14_flagged_at` — alert Robert via WhatsApp + email

#### `viewing-reminders.sh` — runs every hour
Logic:
1. Query `prop_viewings` WHERE `status='SCHEDULED'`
2. Send 24h reminder if `scheduled_at BETWEEN NOW()+23h AND NOW()+25h` AND `reminder_24h_sent_at IS NULL`
3. Send 1h reminder if `scheduled_at BETWEEN NOW()+55min AND NOW()+65min` AND `reminder_1h_sent_at IS NULL`
4. Flag no-show if `scheduled_at < NOW()-30min` AND `status='SCHEDULED'` — send follow-up, set `no_show=TRUE`

#### `application-reminders.sh` — runs daily at 08:00 UTC (04:00 TT)
Logic:
1. Query `prop_applications` WHERE `status='PENDING'` AND `submitted_at IS NULL` AND `form_sent_at < NOW()-48h` AND `reminder_48h_sent_at IS NULL`
2. Send 48h reminder, update flag

#### `renewal-notices.sh` — runs daily at 08:00 UTC (04:00 TT)
Logic:
1. Query `prop_lease_agreements` WHERE `status='ACTIVE'` AND `end_date BETWEEN NOW() AND NOW()+61 days`
2. For leases with no renewal notice: create `prop_renewal_notices` record, send D-60 notice
3. For existing notices with `tenant_response IS NULL`:
   - D-30: send follow-up, update flag
   - D-14: send final notice, update flag
4. Alert Robert when `tenant_response='NO_RESPONSE'` at D-14

#### `sla-monitor.sh` — runs every 30 min
Logic:
1. Query `prop_maintenance_tickets` WHERE `status NOT IN ('RESOLVED','CLOSED','CANCELLED')` AND `sla_breach_at < NOW()` AND `sla_breached=FALSE`
2. Set `sla_breached=TRUE`, send alert to Robert via WhatsApp

#### `post-viewing-app-link.sh` — runs every hour
Logic:
1. Query `prop_viewings` WHERE `status='COMPLETED'` AND `post_viewing_app_link_sent_at IS NULL`
2. Send application form link to prospect via WhatsApp/email
3. Update `post_viewing_app_link_sent_at`

---

## WHATSAPP TEMPLATE MESSAGES

Register all templates in Meta Business Manager before use. Templates require approval (~24h).

| Template Name | Trigger | Variables |
|---|---|---|
| `prop_enquiry_ack` | Inbound enquiry received | unit_address, rent, listing_link |
| `prop_viewing_confirmation` | Viewing booked | prospect_name, unit_address, date, time |
| `prop_viewing_reminder_24h` | 24h before viewing | prospect_name, date, time, address |
| `prop_viewing_reminder_1h` | 1h before viewing | prospect_name, time, address |
| `prop_viewing_noshow` | 30 min after no-show | prospect_name, reschedule_link |
| `prop_app_link` | Post-viewing | prospect_name, application_link |
| `prop_app_received` | Application submitted | applicant_name |
| `prop_app_approved` | Application approved | applicant_name, unit_address, deposit_amount |
| `prop_app_rejected` | Application rejected | applicant_name |
| `prop_lease_sent` | Lease generated | tenant_name, signing_link |
| `prop_deposit_receipt` | Deposit recorded | tenant_name, amount, receipt_number |
| `prop_welcome_pack` | Lease activated | tenant_name, unit_address, due_date, bank_details, maintenance_link |
| `prop_rent_reminder_d5` | D-5 before due | tenant_name, amount, due_date, bank_details |
| `prop_rent_reminder_d1` | D-1 before due | tenant_name, amount, due_date, bank_details |
| `prop_rent_receipt` | Payment recorded | tenant_name, amount, period, receipt_number |
| `prop_rent_overdue_d1` | D+1 overdue | tenant_name, amount, due_date |
| `prop_rent_late_fee` | D+3 late fee applied | tenant_name, original_amount, late_fee, total_due |
| `prop_ticket_ack` | Ticket created | tenant_name, ticket_ref, category, priority, sla_hours |
| `prop_ticket_update` | Status change | tenant_name, ticket_ref, new_status |
| `prop_ticket_resolved` | Ticket closed | tenant_name, ticket_ref |
| `prop_renewal_d60` | D-60 lease end | tenant_name, lease_end_date |
| `prop_renewal_follow_up` | D-30, D-14 | tenant_name, lease_end_date, days_remaining |

---

## WHATSAPP INBOUND BOT LOGIC

When a message is received on the JAG WhatsApp number (`/internal/whatsapp/webhook`):

### Step 1 — Identify sender
- Look up `prop_whatsapp_messages` by `from_number` → find linked `enquiry_id` or `ticket_id`
- If no match → new prospect → create `prop_enquiries` record with `channel='WHATSAPP'`, stage='NEW_LEAD'

### Step 2 — Intent detection (keyword matching via Ollama)
Send message body to Ollama with prompt:
```
Classify this WhatsApp message from a property tenant/prospect:
"{{message}}"
Return JSON: { "intent": "ENQUIRY|MAINTENANCE|PAYMENT_CONFIRM|RENEWAL_RESPONSE|OTHER", "keywords": [], "priority_suggestion": "P1|P2|P3|P4|null" }
P1 keywords: flood, burst, fire, no power, emergency, break-in, gas leak
P2 keywords: leak, no water, broken, not working, stuck
```

### Step 3 — Route by intent
- `ENQUIRY` → send `prop_enquiry_ack` template with interactive buttons: **Book Viewing** / **Ask a Question**
- `MAINTENANCE` → auto-create `prop_maintenance_tickets` with `report_channel='WHATSAPP'`, `priority=priority_suggestion`; send `prop_ticket_ack`
- `PAYMENT_CONFIRM` → flag the relevant `prop_rent_schedule` period for Robert to verify; notify Robert
- `RENEWAL_RESPONSE` → update `prop_renewal_notices.tenant_response`; notify Robert
- `OTHER` → forward notification to Robert via email + log message

### Step 4 — Log all messages
Always insert into `prop_whatsapp_messages` regardless of intent.

---

## FACEBOOK MARKETPLACE AUTO-POST

When `POST /api/v1/properties/units/:id/list` is called:

1. Pull unit data: address, bedrooms, bathrooms, size, rent, amenities, photos from MinIO
2. Build listing payload:
```json
{
  "name": "2-Bedroom Apartment — Barataria, Trinidad",
  "description": "...",
  "price": { "amount": 450000, "currency": "TTD" },
  "availability": "AVAILABLE",
  "images": [{ "url": "..." }],
  "location": { "address": "...", "city": "Barataria", "country": "TT" },
  "category_specific_fields": { "property_type": "APARTMENT", "num_beds": 2, "num_baths": 1 }
}
```
3. POST to `https://graph.facebook.com/v19.0/{page-id}/listings`
4. Store returned `facebook_listing_id` on `prop_units` record
5. On unlist: `DELETE https://graph.facebook.com/v19.0/{listing_id}`

---

## AI RENT PRICE SUGGESTION

Route: `POST /api/v1/properties/units/:id/suggest-price`

```typescript
// 1. Pull unit data
const unit = await db.query('SELECT * FROM prop_units WHERE id = $1', [unitId])

// 2. Pull comparable active units (same property type, similar size)
const comparables = await db.query(`
  SELECT u.bedrooms, u.bathrooms, u.size_sqft, l.rent_amount_ttd, u.wasa_included
  FROM prop_units u
  JOIN prop_lease_agreements l ON l.unit_id = u.id
  WHERE l.status = 'ACTIVE' AND u.bedrooms = $1
  LIMIT 5
`, [unit.bedrooms])

// 3. Send to Ollama
const prompt = `
You are a Trinidad real estate advisor. Suggest a monthly rent range in TTD for:
- Location: ${unit.address}
- Bedrooms: ${unit.bedrooms}, Bathrooms: ${unit.bathrooms}
- Size: ${unit.size_sqft} sqft
- WASA included: ${unit.wasa_included}, Electricity: tenant pays, Internet: tenant pays
- Comparable units renting at: ${comparables.map(c => `TTD ${c.rent_amount_ttd}`).join(', ')}

Return JSON only: { "min_ttd": number, "max_ttd": number, "recommended_ttd": number, "rationale": "string" }
`
// 4. Parse response, store on prop_units, return to frontend
```

---

## SMS BROADCAST

Route: `POST /api/v1/properties/units/:id/sms-broadcast`
Body: `{ contacts: ["+18681234567", ...] }` (or use saved broadcast list)

Message template (≤160 chars):
```
FOR RENT: {{bedrooms}}BR {{unit_type}} {{area}}. TTD${{rent}}/mo. WASA incl. Elec/Net excl. View: {{booking_link}} JAG Properties {{phone}}
```

---

## PDF RECEIPT GENERATION

Use existing `pdf` skill pattern for:
- **Deposit receipts** — Receipt No., date, tenant, unit, amount, method, account, "held until exit"
- **Rent receipts** — Receipt No., date, tenant, unit, period (Month YYYY), amount, method, balance outstanding
- **Deposit reconciliation statement** — Deposit held, itemised deductions with costs, net refund, tenant sign-off line

Store all PDFs in MinIO `jag-documents` bucket under `receipts/` prefix.

---

## RENT SCHEDULE GENERATION

Triggered automatically when `prop_lease_agreements.status` is set to `'ACTIVE'`.
Generate one `prop_rent_schedule` row per month from `start_date` to `end_date`:

```typescript
// Generate schedule rows
const start = new Date(lease.start_date)
const end = new Date(lease.end_date)
let current = new Date(start)

while (current <= end) {
  const dueDate = new Date(current.getFullYear(), current.getMonth(), lease.rent_due_day ?? 1)
  await db.query(`
    INSERT INTO prop_rent_schedule (owner_id, lease_id, unit_id, tenant_name, tenant_phone, tenant_email,
      period_year, period_month, due_date, amount_due_ttd, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (lease_id, period_year, period_month) DO NOTHING
  `, [ownerId, leaseId, unitId, tenantName, tenantPhone, tenantEmail,
      current.getFullYear(), current.getMonth()+1, dueDate, rent, `${leaseId}-${current.getFullYear()}-${current.getMonth()+1}`])
  current.setMonth(current.getMonth() + 1)
}
```

---

## TENANCY AGREEMENT TEMPLATE (v12)

Store as `jag-infra/templates/tenancy-agreement-v12.html` (or .docx).
Auto-filled fields (pulled from lease + tenant + unit records):
- `{{tenant_full_name}}`, `{{tenant_id_number}}`, `{{tenant_phone}}`, `{{tenant_email}}`
- `{{unit_address}}`, `{{unit_description}}` (e.g. "2-bedroom apartment, Ground Floor")
- `{{monthly_rent_ttd}}` (words + figures)
- `{{lease_start_date}}`, `{{lease_end_date}}`
- `{{deposit_amount_ttd}}`
- `{{rent_due_day}}` (e.g. "1st of each month")
- `{{wasa_clause}}` — "Water and Sewerage (WASA) charges are included in the monthly rent."
- `{{electricity_clause}}` — "Electricity is in the Tenant's name and at the Tenant's expense."
- `{{late_penalty_clause}}` — "A late penalty of 5% of the monthly rent shall apply after a grace period of 3 days."
- `{{landlord_name}}` = Robert Johnson-Attin
- `{{landlord_company}}` = JAG Properties Management Ltd
- `{{date_generated}}`

Generate two copies: landlord copy + tenant copy. Send both to tenant email with 48h signing deadline.

---

## MAINTENANCE TICKET REF GENERATION

Auto-generate human-readable ticket reference on creation:
```typescript
// Format: MNT-YYYY-NNNN (sequential per year)
const { rows } = await db.query(`
  SELECT COUNT(*) FROM prop_maintenance_tickets
  WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
`)
const seq = String(parseInt(rows[0].count) + 1).padStart(4, '0')
const ticketRef = `MNT-${new Date().getFullYear()}-${seq}`
```

SLA hours by priority:
- P1 (Emergency): 2 hours
- P2 (Urgent): 24 hours
- P3 (Routine): 120 hours (5 days)
- P4 (Planned): null (no SLA)

---

## PRIORITY KEYWORD DETECTION (maintenance tickets)

```typescript
const P1_KEYWORDS = ['flood','flooding','burst pipe','fire','no power','no electricity','power cut','break-in','break in','gas leak','roof collapse','no water','sewage','sewerage overflow']
const P2_KEYWORDS = ['leak','leaking','broken','not working','stuck','blocked drain','no hot water','pest','rats','roaches','ac not working']

function suggestPriority(description: string): 'P1' | 'P2' | 'P3' {
  const lower = description.toLowerCase()
  if (P1_KEYWORDS.some(k => lower.includes(k))) return 'P1'
  if (P2_KEYWORDS.some(k => lower.includes(k))) return 'P2'
  return 'P3'
}
```

---

## FRONTEND COMPONENTS (jag-web/)

All new tabs within the existing Properties page (`jag-web/src/pages/Properties.tsx`).

### New tabs to add to Properties page:

| Tab | Component File | Description |
|---|---|---|
| Enquiries | `PropertiesEnquiriesPanel.tsx` | Pipeline board: NEW_LEAD → VIEWING_SCHEDULED → VIEWED → APPLICATION → APPROVED/REJECTED. Click row to see WA thread + send reply |
| Viewings | `PropertiesViewingsPanel.tsx` | List of scheduled/completed/no-show viewings. No slot management UI — Robert manages his availability in Google Calendar directly. Status actions (mark completed, no-show, cancel) |
| Applications | `PropertiesApplicationsPanel.tsx` | List applications, view documents (from MinIO), approve/reject decision panel |
| Rent Schedule | `PropertiesRentSchedulePanel.tsx` | Monthly rent table per unit/lease. Record payment button. Status badges. PDF receipt download + WA send button |
| Deposits | `PropertiesDepositsPanel.tsx` | Deposit list. Record receipt. Exit reconciliation form |
| Maintenance | `PropertiesMaintenancePanel.tsx` | Ticket list with priority colour-coding. Create ticket. Assign contractor. Status update. Cost logging |
| Contractors | `PropertiesContractorsPanel.tsx` | Contractor directory CRUD |
| Handover | `PropertiesHandoverPanel.tsx` | Entry/exit checklist form. Photo upload. Meter readings. Side-by-side comparison for exit |
| Renewals | `PropertiesRenewalsPanel.tsx` | Upcoming lease expiries. Record tenant response. Trigger renew/vacate flow |
| WhatsApp | `PropertiesWhatsAppPanel.tsx` | Inbox: list conversations by phone. Thread view. Send message / template / interactive button |

### Listing enhancements (extend existing unit form):
- Add checkboxes: WASA included / Electricity included / Internet included
- Add "List This Unit" button → calls `/list` endpoint → posts to Facebook, generates SMS broadcast, shows AI price suggestion
- Show `days_on_market` counter on unit card
- Show `facebook_listing_id` badge when listed on Marketplace

### Public booking page (no auth):
- Route: `/book/:slug` (outside Keycloak-protected area)
- Shows: unit photos, description, rent, utility inclusions
- Calendar: available slots to select
- Form: name, phone, email
- On submit: `POST /api/v1/public/book/:slug`
- Confirmation screen with WhatsApp confirmation message sent automatically

---

## BUILD ORDER (recommended sequence)

1. **Migrations 022, 013, 014** — unit enhancements, enquiries, viewing slots (no dependencies)
2. **WhatsApp webhook** (`/internal/whatsapp/webhook`) — core inbound infrastructure
3. **WhatsApp send helper** + template registration in Meta
4. **Enquiries routes + EnquiriesPanel** — lead capture and pipeline
5. **Google Calendar lib** (`src/lib/google-calendar.ts`) + **Viewings routes + ViewingsPanel + Public booking page**
6. **Migration 015 + Applications routes + ApplicationsPanel**
7. **Migration 016 + Deposits routes + DepositsPanel**
8. **Tenancy Agreement v12 template + lease auto-fill route**
9. **Migration 017 + Rent Schedule routes + RentSchedulePanel** (includes PDF receipt)
10. **Migration 018 + Handover routes + HandoverPanel**
11. **Migration 019 + Maintenance routes + MaintenancePanel + ContractorsPanel**
12. **Migration 020 + WhatsApp conversation log + WhatsAppPanel**
13. **Migration 021 + Renewals routes + RenewalsPanel**
14. **Facebook Marketplace API integration**
15. **AI rent suggestion (Ollama)**
16. **SMS broadcast (Twilio)**
17. **All scheduled cron jobs** (rent reminders, viewing reminders, SLA monitor, renewal notices)
18. **i18n (zh-CN)** — translate all new UI strings as final batch

---

## ENV VARS TO ADD

Add to VM `.env` and `docker-compose.yml` (via Oracle Vault):

```bash
# WhatsApp Business API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=            # random string for webhook verification
WHATSAPP_BUSINESS_ACCOUNT_ID=

# Facebook Marketplace
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=

# SMS (Twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=

# Public booking base URL
PUBLIC_BOOKING_BASE_URL=https://jagcorporate.com/book

# Google Calendar API
GOOGLE_CALENDAR_ID=                    # Robert's Google Calendar ID (usually robertjohnsonattin@gmail.com)
GOOGLE_SERVICE_ACCOUNT_EMAIL=          # service account email from Google Cloud Console
GOOGLE_SERVICE_ACCOUNT_KEY=            # base64-encoded service account JSON key
GOOGLE_CALENDAR_LOOKAHEAD_DAYS=14      # how many days ahead to show available slots
GOOGLE_CALENDAR_SLOT_DURATION_MIN=30   # viewing duration in minutes
GOOGLE_CALENDAR_WORK_START=09:00       # earliest slot time (TT timezone)
GOOGLE_CALENDAR_WORK_END=17:00         # latest slot end time (TT timezone)
GOOGLE_CALENDAR_TIMEZONE=America/Port_of_Spain
```

---

## NOTES & CONSTRAINTS

- **WhatsApp webhook must be HTTPS and publicly accessible** — Caddy already handles this via `https://api.jagcorporate.com`. Add route: `/internal/whatsapp/webhook` to Caddyfile (currently Docker-network-only routes are blocked — this one must be public for Meta to reach it, but secured by `X-Hub-Signature-256` verification, NOT Keycloak)
- **Facebook Marketplace API** — requires a Facebook Business Page linked to the JAG Properties business. Page must be verified. Listings are subject to Meta's housing policies (no discriminatory language)
- **SMS broadcast contact list** — store in a simple `prop_broadcast_contacts` table (name, phone, category). Do NOT hardcode
- **Deposit is NOT income** — must never be posted to the P&L GL. It is a liability (money held). Post to a "Security Deposits Held" balance sheet account in the Chart of Accounts
- **Late fee (5%)** — applied at D+3 automatically. Amount = 5% × monthly rent. Posted to `fin_transactions` as income (late fee revenue). Must carry idempotency key keyed to `${rent_schedule_id}-late-fee`
- **Tenancy Agreement v12** — store template in DocVault / MinIO `jag-documents` bucket. Version the template — do not overwrite v12 if a v13 is created later
- **WhatsApp group creation** (tenant + property manager) — cannot be automated via API. Robert creates manually on his phone. Note this in the UI as a manual step prompt after welcome pack is sent
- **Digital signatures** — use existing JAG DocVault e-signature flow. If tenant prefers in-person: print 2 copies, sign physically, scan and upload via DocVault
- **All new tables use `NULLIF(current_setting('app.current_owner_id', true), '')::uuid` in RLS policies** — never raw `current_setting(...)::uuid`
- **STD-13** — if any existing `prop_*` columns need to be renamed as part of this build, use expand-and-contract. Do not rename in a single migration
- **`prop_lease_agreements.status`** — ensure 'ACTIVE' triggers rent schedule generation. Add a database trigger or handle in the PATCH route for leases
- Security deposit months: confirm with Robert — default is 1 month, maximum 2 months. Add `months_equivalent` field to deposit record and let Robert set at time of recording
