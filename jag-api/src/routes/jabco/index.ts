import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { jabcoProjectsRouter }     from './projects';
import { jabcoSiteDiaryRouter }    from './site-diary';
import { jabcoRetentionRouter }    from './retention';
import { jabcoGanttRouter }        from './gantt';
import { jabcoPaymentCertsRouter, jabcoVOActionRouter } from './payment-certs';
import { jabcoVendorInvoicesRouter }      from './vendor-invoices';
import { jabcoProjectTasksRouter }        from './project-tasks';
import { jabcoPunchListRouter }           from './punch-list';
import { jabcoSiteIncidentsRouter }       from './site-incidents';
import { jabcoQualityInspectionsRouter }  from './quality-inspections';

export const jabcoRouter = Router();

jabcoRouter.use(requireAuth());
jabcoRouter.use(brianPortalGate('JABCO'));

// Core project CRUD + BOQ + VOs (list/create) + progress claims
jabcoRouter.use('/projects', jabcoProjectsRouter);

// VO approval/rejection (PATCH action on a specific VO)
jabcoRouter.use('/projects/:projectId/variation-orders', jabcoVOActionRouter);

// Nested project resources
jabcoRouter.use('/projects/:projectId/site-diary',              jabcoSiteDiaryRouter);
jabcoRouter.use('/projects/:projectId/subcontractor-retention', jabcoRetentionRouter);
jabcoRouter.use('/projects/:projectId/gantt',                   jabcoGanttRouter);
jabcoRouter.use('/projects/:projectId/payment-certificates',    jabcoPaymentCertsRouter);
jabcoRouter.use('/projects/:projectId/vendor-invoices',         jabcoVendorInvoicesRouter);
jabcoRouter.use('/projects/:projectId/tasks',               jabcoProjectTasksRouter);
jabcoRouter.use('/projects/:projectId/punch-list',          jabcoPunchListRouter);
jabcoRouter.use('/projects/:projectId/incidents',           jabcoSiteIncidentsRouter);
jabcoRouter.use('/projects/:projectId/quality-inspections', jabcoQualityInspectionsRouter);
