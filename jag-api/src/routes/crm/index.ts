import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { crmRouter as crmRoutes } from './crm';

export const crmRouter = Router();

crmRouter.use(requireAuth());
crmRouter.use(brianPortalGate('CRM'));
crmRouter.use('/', crmRoutes);
