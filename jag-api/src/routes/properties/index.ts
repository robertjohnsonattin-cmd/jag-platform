import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { propertiesRouter as propRoutes }  from './properties';
import { pipelineRouter }                  from './pipeline';
import { maintenanceRouter }               from './maintenance';
import { propTenantsRouter, propMortgageRouter } from './tenants-mortgage';
import { utilitiesRouter }                 from './utilities';
import { vendorInvoicesRouter }            from './vendor-invoices';
import { insuranceRouter }                 from './insurance';
import { propertyTaxRouter }               from './property-tax';
import { inspectionsRouter }               from './inspections';
import { documentsRouter }                 from './documents';
import { utilityAccountsRouter }          from './utility-accounts';
import { unitsRouter }                    from './units';

export const propertiesRouter = Router();

propertiesRouter.use(requireAuth());
propertiesRouter.use(brianPortalGate('PROPERTIES'));

// ── Named sub-paths BEFORE the catch-all /:id routes ─────────────────────────
// Express matches routes in registration order. Named paths (/pipeline, /tenants,
// /arrears, /lease-expiry) must come before propRoutes which has GET /:id.

propertiesRouter.use('/pipeline',      pipelineRouter);
propertiesRouter.use('/tenants',       propTenantsRouter);

// ── Portfolio, review-queue, arrears, lease-expiry and /:id routes ────────────
propertiesRouter.use('/', propRoutes);

// ── Nested property-level sub-routes ─────────────────────────────────────────
propertiesRouter.use('/:propertyId/maintenance',     maintenanceRouter);
propertiesRouter.use('/:propertyId/mortgage',        propMortgageRouter);
propertiesRouter.use('/:propertyId/utilities',       utilitiesRouter);
propertiesRouter.use('/:propertyId/vendor-invoices', vendorInvoicesRouter);
propertiesRouter.use('/:propertyId/insurance',       insuranceRouter);
propertiesRouter.use('/:propertyId/tax',             propertyTaxRouter);
propertiesRouter.use('/:propertyId/inspections',     inspectionsRouter);
propertiesRouter.use('/:propertyId/documents',       documentsRouter);
propertiesRouter.use('/:propertyId/utility-accounts', utilityAccountsRouter);
propertiesRouter.use('/:propertyId/units',            unitsRouter);
