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
// Tenancy lifecycle modules
import { enquiriesRouter }                from './enquiries';
import { viewingsRouter }                 from './viewings';
import { applicationsRouter }             from './applications';
import { depositsRouter }                 from './deposits';
import { rentScheduleRouter }             from './rent-schedule';
import { handoverRouter }                 from './handover';
import { maintenanceTicketsRouter, contractorsRouter } from './maintenance-tickets';
import { renewalsRouter }                 from './renewals';
import { whatsappSendRouter }             from './whatsapp-send';
import { listingRouter }                  from './listing';

export const propertiesRouter = Router();

propertiesRouter.use(requireAuth());
propertiesRouter.use(brianPortalGate('PROPERTIES'));

// ── Tenancy lifecycle flat routes (BEFORE '/' catch-all) ─────────────────────
// These must precede propRoutes (which has GET /:id) to avoid UUID mismatch.
propertiesRouter.use('/enquiries',      enquiriesRouter);
propertiesRouter.use('/viewings',       viewingsRouter);
propertiesRouter.use('/applications',   applicationsRouter);
propertiesRouter.use('/deposits',       depositsRouter);
propertiesRouter.use('/rent-schedule',  rentScheduleRouter);
propertiesRouter.use('/handover',       handoverRouter);
propertiesRouter.use('/maintenance',    maintenanceTicketsRouter);
propertiesRouter.use('/contractors',    contractorsRouter);
propertiesRouter.use('/renewals',       renewalsRouter);
propertiesRouter.use('/whatsapp',       whatsappSendRouter);

// ── Named sub-paths BEFORE the catch-all /:id routes ─────────────────────────
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

// ── Unit-level listing actions ────────────────────────────────────────────────
// Mounted after /units so /:propertyId/units/:id/* does not intercept these.
propertiesRouter.use('/units/:id',                    listingRouter);
