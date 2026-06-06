import type { EventHandler } from '../types';

export const familyHandlers = new Map<string, EventHandler>([
  [
    'vehicle.insurance_expiring',
    async (event) => {
      // TODO Phase 1: fire Tier 1 renewal alert with days-remaining and vehicle details in payload
      console.log(`[family] vehicle.insurance_expiring — vehicle_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'vehicle.registration_expiring',
    async (event) => {
      // TODO Phase 1: fire Tier 1 renewal alert
      console.log(`[family] vehicle.registration_expiring — vehicle_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'vehicle.service_due',
    async (event) => {
      // TODO Phase 1: fire Tier 2 service reminder
      console.log(`[family] vehicle.service_due — vehicle_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'loyalty.points_expiring',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert 60 days before expiry with programme details
      console.log(`[family] loyalty.points_expiring — programme_id=${event.aggregate_id}`, event.payload);
    },
  ],
  [
    'succession.document_updated',
    async (event) => {
      // TODO Phase 1: append to audit_log in jag_core, fire Tier 3 Owner digest entry
      console.log(`[family] succession.document_updated — document_id=${event.aggregate_id}`);
    },
  ],
  [
    'docvault.document_expiring',
    async (event) => {
      // TODO Phase 1: fire Tier 1 alert 90 days before document expiry
      console.log(`[family] docvault.document_expiring — file_id=${event.aggregate_id}`, event.payload);
    },
  ],
]);
