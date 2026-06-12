import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { imsItemsRouter }     from './items';
import { imsMovementsRouter } from './movements';
import { imsVehiclesRouter }  from './vehicles';
import { imsSuppliersRouter }    from './suppliers';
import { imsStockTakesRouter }   from './stocktakes';
import { imsDepreciationRouter } from './depreciation';

export const imsRouter = Router();

imsRouter.use(requireAuth());
imsRouter.use(brianPortalGate('IMS'));

imsRouter.use('/', imsItemsRouter);             // locations, categories, items, photos, barcodes, valuation
imsRouter.use('/movements',    imsMovementsRouter);
imsRouter.use('/vehicles',     imsVehiclesRouter);
imsRouter.use('/',             imsSuppliersRouter);    // suppliers, purchase-orders
imsRouter.use('/',             imsStockTakesRouter);   // stock-takes
imsRouter.use('/',             imsDepreciationRouter); // depreciation/schedules
