-- Migration 020: WhatsApp Message Log

CREATE TABLE prop_whatsapp_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  wa_message_id   VARCHAR(200) UNIQUE,
  direction       VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  from_number     VARCHAR(30),
  to_number       VARCHAR(30),
  enquiry_id      UUID REFERENCES prop_enquiries(id) ON DELETE SET NULL,
  ticket_id       UUID REFERENCES prop_maintenance_tickets(id) ON DELETE SET NULL,
  message_type    VARCHAR(20) CHECK (message_type IN ('TEXT','TEMPLATE','INTERACTIVE','IMAGE','DOCUMENT','AUDIO')),
  body            TEXT,
  template_name   VARCHAR(100),
  media_url       TEXT,
  delivery_status VARCHAR(20) CHECK (delivery_status IN ('SENT','DELIVERED','READ','FAILED')),
  failed_reason   TEXT,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY prop_whatsapp_messages_owner ON prop_whatsapp_messages
  USING (owner_id = NULLIF(current_setting('app.current_owner_id', true), '')::uuid);

CREATE INDEX idx_wa_messages_from    ON prop_whatsapp_messages(from_number);
CREATE INDEX idx_wa_messages_enquiry ON prop_whatsapp_messages(enquiry_id);
CREATE INDEX idx_wa_messages_ticket  ON prop_whatsapp_messages(ticket_id);
