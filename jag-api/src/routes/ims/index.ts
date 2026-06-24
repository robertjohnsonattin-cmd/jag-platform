import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { imsItemsRouter }     from './items';
import { imsMovementsRouter } from './movements';
import { imsVehiclesRouter }  from './vehicles';
import { imsSuppliersRouter }    from './suppliers';
import { imsStockTakesRouter }   from './stocktakes';
import { imsDepreciationRouter } from './depreciation';
import { vmsMaintenanceRouter }  from './vms-maintenance';
import { vmsCostsRouter }        from './vms-costs';
import { vmsComplianceRouter }   from './vms-compliance';
import { vmsDisposalRouter }     from './vms-disposal';

export const imsRouter = Router();

imsRouter.use(requireAuth());
imsRouter.use(brianPortalGate('IMS'));

imsRouter.use('/', imsItemsRouter);             // locations, categories, items, photos, barcodes, valuation
imsRouter.use('/movements',    imsMovementsRouter);
imsRouter.use('/vehicles',     imsVehiclesRouter);
imsRouter.use('/vehicles',     vmsMaintenanceRouter); // work orders + PM schedules
imsRouter.use('/vehicles',     vmsCostsRouter);       // fuel logs + operating costs + TCO
imsRouter.use('/vehicles',     vmsComplianceRouter);  // compliance document vault
imsRouter.use('/vehicles',     vmsDisposalRouter);    // disposal workflow + GL posting
imsRouter.use('/',             imsSuppliersRouter);    // suppliers, purchase-orders
imsRouter.use('/',             imsStockTakesRouter);   // stock-takes
imsRouter.use('/',             imsDepreciationRouter); // depreciation/schedules
