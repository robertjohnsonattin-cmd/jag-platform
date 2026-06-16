CREATE TABLE IF NOT EXISTS jabco_bid_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  log_type            VARCHAR(20) NOT NULL
    CHECK (log_type IN ('NO_GO','LOST_BID','RATE_VARIANCE','POST_MORTEM','WON')),
  pipeline_id         UUID REFERENCES crm_sales_pipeline(id) ON DELETE SET NULL,
  project_id          UUID REFERENCES jabco_projects(id) ON DELETE SET NULL,
  client_company_id   UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  reason_category     VARCHAR(30)
    CHECK (reason_category IN ('RESOURCE_CONSTRAINTS','HIGH_RISK','LOW_MARGIN','STRATEGIC_MISFIT','CLIENT_RELATIONSHIP','SCHEDULE_CONFLICT','OTHER')),
  reason_text         TEXT,
  competitor_name     VARCHAR(200),
  winning_total_price NUMERIC,
  our_total_price     NUMERIC,
  technical_score     NUMERIC,
  financial_score     NUMERIC,
  work_package_tag    VARCHAR(100),
  our_rate            NUMERIC,
  market_rate         NUMERIC,
  variance_pct        NUMERIC,
  idempotency_key     UUID UNIQUE,
  logged_by           UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jabco_bid_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY jabco_bid_log_tenant ON jabco_bid_log
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX IF NOT EXISTS idx_bid_log_tenant   ON jabco_bid_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bid_log_client   ON jabco_bid_log (client_company_id);
CREATE INDEX IF NOT EXISTS idx_bid_log_type     ON jabco_bid_log (log_type);
CREATE INDEX IF NOT EXISTS idx_bid_log_package  ON jabco_bid_log (work_package_tag);
CREATE INDEX IF NOT EXISTS idx_bid_log_created  ON jabco_bid_log (created_at DESC);
