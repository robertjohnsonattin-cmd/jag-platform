import type { EventHandler } from '../types';

export const coreHandlers = new Map<string, EventHandler>([
  [
    'user.created',
    async (event) => {
      // TODO Phase 1: provision Keycloak account sync, send welcome IN_APP notification
      console.log(`[core] user.created — user_id=${event.aggregate_id}`);
    },
  ],
  [
    'tenant.suspended',
    async (event) => {
      // TODO Phase 1: revoke all active sessions for tenant, notify Owner
      console.log(`[core] tenant.suspended — tenant_id=${event.aggregate_id}`);
    },
  ],
  [
    'role.grant_expired',
    async (event) => {
      // TODO Phase 1: confirm External Advisor access revoked in Keycloak
      console.log(`[core] role.grant_expired — grant_id=${event.aggregate_id}`);
    },
  ],
]);
