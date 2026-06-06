import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { clubTiersRouter }       from './tiers';
import { clubMembersRouter }     from './members';
import { clubMembershipsRouter } from './memberships';
import { clubCreditsRouter }     from './credits';
import { clubEventsRouter }      from './events';
import { clubVisitorLogRouter }  from './visitor-log';
import { clubChipFloatRouter }   from './chip-float';
import { makeUtilitiesRouter }        from '../entertainment/utilities';
import { makeSupplierInvoicesRouter } from '../entertainment/supplier-invoices';

export const clubRouter = Router();
clubRouter.use(requireAuth());
clubRouter.use(brianPortalGate('CLUB'));

clubRouter.use('/tiers',             clubTiersRouter);
clubRouter.use('/events',            clubEventsRouter);
clubRouter.use('/visitor-log',       clubVisitorLogRouter);
clubRouter.use('/chip-float',        clubChipFloatRouter);
clubRouter.use('/utilities',         makeUtilitiesRouter('CLUB'));
clubRouter.use('/supplier-invoices', makeSupplierInvoicesRouter('CLUB'));

// Member sub-resources (mergeParams so :id is visible in sub-routers)
clubRouter.use('/members', clubMembersRouter);
clubRouter.use('/members/:id/memberships', clubMembershipsRouter);
clubRouter.use('/members/:id/credits',     clubCreditsRouter);
