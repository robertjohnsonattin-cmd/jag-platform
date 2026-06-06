import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { imsItemsRouter }     from './items';
import { imsMovementsRouter } from './movements';
import { imsVehiclesRouter }  from './vehicles';

export const imsRouter = Router();

imsRouter.use(requireAuth());
imsRouter.use(brianPortalGate('IMS'));

imsRouter.use('/', imsItemsRouter);             // locations, categories, items
imsRouter.use('/movements', imsMovementsRouter);
imsRouter.use('/vehicles',  imsVehiclesRouter);
