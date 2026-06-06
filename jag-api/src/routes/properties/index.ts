import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { propertiesRouter as propRoutes }  from './properties';
import { pipelineRouter }                  from './pipeline';
import { maintenanceRouter }               from './maintenance';
import { propTenantsRouter, propMortgageRouter } from './tenants-mortgage';
import { utilitiesRouter }                 from './utilities';
import { vendorInvoicesRouter }            from './vendor-invoices';

export const propertiesRouter = Router();

propertiesRouter.use(requireAuth());
propertiesRouter.use(brianPortalGate('PROPERTIES'));

// ── Named sub-paths BEFORE the catch-all /:id routes ─────────────────────────
// Express matches routes in registration order. /pipeline and /tenants must be
// registered before the propRoutes which contains GET /:id (which would capture
// "pipeline" and "tenants" as UUID params and return 422).

propertiesRouter.use('/pipeline', pipelineRouter);
propertiesRouter.use('/tenants',  propTenantsRouter);

// ── Portfolio, review-queue, and /:id routes ──────────────────────────────────
propertiesRouter.use('/', propRoutes);

// ── Nested property-level sub-routes ─────────────────────────────────────────
propertiesRouter.use('/:propertyId/maintenance',     maintenanceRouter);
propertiesRouter.use('/:propertyId/mortgage',        propMortgageRouter);
propertiesRouter.use('/:propertyId/utilities',       utilitiesRouter);
propertiesRouter.use('/:propertyId/vendor-invoices', vendorInvoicesRouter);
