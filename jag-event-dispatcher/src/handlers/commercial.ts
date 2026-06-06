import type { EventHandler } from '../types';

export const commercialHandlers = new Map<string, EventHandler>([
  [
    'ims.stock_low',
    async (event) => {
      // TODO Phase 1: fire Tier 2 low-stock notification to Domain Admin
      console.log(`[commercial] ims.stock_low — item_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'jabco.claim_certified',
    async (event) => {
      // TODO Phase 1: notify project manager, push certified amount to Finance ledger
      console.log(`[commercial] jabco.claim_certified — claim_id=${event.aggregate_id}`);
    },
  ],
  [
    'jabco.vo_approved',
    async (event) => {
      // TODO Phase 1: notify project manager, update contract value
      console.log(`[commercial] jabco.vo_approved — vo_id=${event.aggregate_id}`);
    },
  ],
  [
    'jabco.retention_due',
    async (event) => {
      // TODO Phase 1: fire Tier 2 retention release reminder
      console.log(`[commercial] jabco.retention_due — retention_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'crm.lead_won',
    async (event) => {
      // TODO Phase 1: trigger JABCO project creation prompt, notify assigned user
      console.log(`[commercial] crm.lead_won — pipeline_id=${event.aggregate_id}`);
    },
  ],
  [
    'crm.follow_up_due',
    async (event) => {
      // TODO Phase 1: fire Tier 2 follow-up reminder to assigned user
      console.log(`[commercial] crm.follow_up_due — contact_id=${event.aggregate_id}`, event.payload);
    },
  ],
]);
