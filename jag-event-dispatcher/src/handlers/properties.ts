import type { EventHandler } from '../types';

export const propertiesHandlers = new Map<string, EventHandler>([
  [
    'rent.payment_received',
    async (event) => {
      // TODO Phase 1: update arrears status on lease, fire Tier 3 receipt digest entry for Owner
      console.log(`[properties] rent.payment_received — payment_id=${event.aggregate_id}`);
    },
  ],
  [
    'rent.payment_late',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert to Owner with tenant and lease details
      console.log(`[properties] rent.payment_late — lease_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'lease.expiry_approaching',
    async (event) => {
      // TODO Phase 1: fire Tier 2 renewal reminder with days-remaining in payload
      console.log(`[properties] lease.expiry_approaching — lease_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'maintenance.completed',
    async (event) => {
      // TODO Phase 1: notify reporting tenant via IN_APP notification if tenant has platform access
      console.log(`[properties] maintenance.completed — request_id=${event.aggregate_id}`);
    },
  ],
  [
    'maintenance.overdue',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert for URGENT requests, Tier 2 for others
      console.log(`[properties] maintenance.overdue — request_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'mortgage.payment_due',
    async (event) => {
      // TODO Phase 1: fire Tier 2 reminder with days-remaining
      console.log(`[properties] mortgage.payment_due — mortgage_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'wipay.webhook_received',
    async (event) => {
      // TODO PRE-5/Phase 1: correlate wipay_reference to rent payment, update payment status
      // See pending_review_queue gap in PRE-2 design decisions
      console.log(`[properties] wipay.webhook_received — payment_id=${event.aggregate_id}`, event.payload);
    },
  ],
]);
