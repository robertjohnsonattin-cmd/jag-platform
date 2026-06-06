import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { barProductsRouter } from './products';
import { barTabsRouter }     from './tabs';
import { barConfigRouter }   from './config';
import { makeUtilitiesRouter }        from '../entertainment/utilities';
import { makeSupplierInvoicesRouter } from '../entertainment/supplier-invoices';

export const barRouter = Router();
barRouter.use(requireAuth());
barRouter.use(brianPortalGate('BAR'));
barRouter.use('/products',          barProductsRouter);
barRouter.use('/tabs',              barTabsRouter);
barRouter.use('/config',            barConfigRouter);
barRouter.use('/utilities',         makeUtilitiesRouter('BAR'));
barRouter.use('/supplier-invoices', makeSupplierInvoicesRouter('BAR'));
