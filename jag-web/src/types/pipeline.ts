export type PipelineStage = 'LEAD' | 'QUALIFIED' | 'PROPOSAL' | 'SUBMITTED' | 'NEGOTIATION' | 'WON' | 'LOST' | 'NO_GO'
export type PipelineType  = 'JABCO_TENDER' | 'DRAGONBRIDGE_DEAL'

export interface PipelineOpportunity {
  id: string
  title: string
  stage: PipelineStage
  pipeline_type: PipelineType
  company_id: string | null
  company_name: string | null
  estimated_value: string | null
  bid_deadline: string | null
  assigned_to: string | null
  assigned_estimator_id: string | null
  linked_project_id: string | null
  submitted_at: string | null
  proposal_document_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ReasonCategory =
  | 'RESOURCE_CONSTRAINTS' | 'HIGH_RISK' | 'LOW_MARGIN'
  | 'STRATEGIC_MISFIT' | 'CLIENT_RELATIONSHIP' | 'SCHEDULE_CONFLICT' | 'OTHER'

export interface BidLogEntry {
  id: string
  log_type: 'NO_GO' | 'LOST_BID' | 'RATE_VARIANCE' | 'POST_MORTEM' | 'WON'
  reason_category: ReasonCategory | null
  reason_text: string | null
  competitor_name: string | null
  winning_total_price: string | null
  our_total_price: string | null
  work_package_tag: string | null
  variance_pct: string | null
  created_at: string
}

export interface IntelligenceResult {
  win_loss_ratio: { won: number; lost: number; ratio: number }
  no_go_history: { reason_category: string; reason_text: string | null; created_at: string }[]
  lost_bid_history: { competitor_name: string | null; winning_total_price: string | null; our_total_price: string | null; created_at: string }[]
  package_rate_warnings: { work_package_tag: string; avg_variance_pct: number; sample_size: number; warning: string }[]
}

export interface PackageVariance {
  work_package_tag: string
  our_rate: number
  market_rate: number
}
