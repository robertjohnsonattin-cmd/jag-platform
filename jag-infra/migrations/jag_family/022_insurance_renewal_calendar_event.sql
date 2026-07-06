-- Adds a dedicated Google Calendar event id for the renewal-reminder alert
-- (distinct from calendar_event_id, which already tracks the expiry-date
-- event). Created when the standard renewal notice first fires; deleted and
-- reset to NULL when the policy is renewed (expiry_date changes), so the
-- next expiry cycle gets a fresh reminder event.

ALTER TABLE fin_insurance_policies
  ADD COLUMN renewal_notice_calendar_event_id TEXT;
