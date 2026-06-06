import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { entertainmentReportsRouter } from './reports';

export const entertainmentRouter = Router();
entertainmentRouter.use(requireAuth());
entertainmentRouter.use(brianPortalGate('ENTERTAINMENT'));
entertainmentRouter.use('/reports', entertainmentReportsRouter);
