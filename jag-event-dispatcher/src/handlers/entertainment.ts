import type { EventHandler } from '../types';

export const entertainmentHandlers = new Map<string, EventHandler>([
  [
    'bar.session_closed',
    async (event) => {
      // TODO Phase 1: push reconciliation summary to Finance, fire Tier 3 weekly digest entry
      console.log(`[entertainment] bar.session_closed — session_id=${event.aggregate_id}`);
    },
  ],
  [
    'bar.cash_variance',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert if variance exceeds threshold
      console.log(`[entertainment] bar.cash_variance — recon_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'member.suspended',
    async (event) => {
      // TODO Phase 1: revoke member access, notify club manager
      console.log(`[entertainment] member.suspended — member_id=${event.aggregate_id}`);
    },
  ],
  [
    'member.expiry_approaching',
    async (event) => {
      // TODO Phase 1: fire Tier 2 membership renewal reminder
      console.log(`[entertainment] member.expiry_approaching — member_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'license.expiring',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert with days-remaining in payload
      console.log(`[entertainment] license.expiring — license_id=${event.aggregate_id}`, event.payload);
    },
  ],
]);
