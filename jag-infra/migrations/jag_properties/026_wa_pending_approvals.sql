-- Migration 026 (jag_properties)
-- Approval queue for manual-approve WhatsApp templates
-- JAG_RENT_006 (D+7 formal demand), JAG_RENT_007 (D+14 legal notice), JAG_REN_003 (deposit recon)
-- Robert reviews drafts here and clicks Send to dispatch

CREATE TABLE prop_wa_pending_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  approval_type   VARCHAR(50) NOT NULL CHECK (approval_type IN (
                    'RENT_FORMAL_DEMAND',
                    'RENT_LEGAL_NOTICE',
                    'DEPOSIT_RECON'
                  )),
  template_name   VARCHAR(100) NOT NULL,
  to_phone        VARCHAR(30) NOT NULL,
  components      JSONB NOT NULL DEFAULT '[]',
  -- Human-readable context shown in the approval UI
  context_label   TEXT NOT NULL,            -- e.g. "Unit 3A — Maria Thomas — 42 days overdue"
  related_id      UUID,                      -- rent_schedule.id / deposit.id
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SENT','DISMISSED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  sent_by         UUID
);

ALTER TABLE prop_wa_pending_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY prop_wa_pending_approvals_owner ON prop_wa_pending_approvals
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_wa_approvals_pending ON prop_wa_pending_approvals(owner_id, status)
  WHERE status = 'PENDING';
