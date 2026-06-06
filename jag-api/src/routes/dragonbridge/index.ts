import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { dbConfigRouter }           from './config';
import { dbPricingTiersRouter }     from './pricing-tiers';
import { dbSuppliersRouter }        from './suppliers';
import { dbProductsRouter }         from './products';
import { dbClientsRouter }          from './clients';
import { dbQuotesRouter }           from './quotes';
import { dbOrdersRouter }           from './orders';
import { dbShipmentsRouter }        from './shipments';
import { dbReconciliationsRouter }  from './reconciliations';

export const dragonbridgeRouter = Router();

dragonbridgeRouter.use(requireAuth());
dragonbridgeRouter.use(brianPortalGate('DRAGONBRIDGE'));

dragonbridgeRouter.use('/config',           dbConfigRouter);
dragonbridgeRouter.use('/pricing-tiers',    dbPricingTiersRouter);
dragonbridgeRouter.use('/suppliers',        dbSuppliersRouter);
dragonbridgeRouter.use('/products',         dbProductsRouter);
dragonbridgeRouter.use('/clients',          dbClientsRouter);
dragonbridgeRouter.use('/quotes',           dbQuotesRouter);
dragonbridgeRouter.use('/orders',           dbOrdersRouter);
dragonbridgeRouter.use('/shipments',        dbShipmentsRouter);
dragonbridgeRouter.use('/reconciliations',  dbReconciliationsRouter);
