import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { brianPortalGate } from '../../middleware/brian';
import { nlcbConfigRouter }               from './config';
import { nlcbGamesRouter }                from './games';
import { nlcbScratchGamesRouter }         from './scratch-games';
import { nlcbScratchPackPurchasesRouter } from './scratch-pack-purchases';
import { nlcbBillersRouter }              from './billers';
import { nlcbSessionsRouter }             from './sessions';
import { nlcbScratchSessionRouter }       from './scratch-session';
import { nlcbSettlementsRouter }          from './settlements';
import { nlcbExpensesRouter }             from './expenses';

export const nlcbRouter = Router();

nlcbRouter.use(requireAuth());
nlcbRouter.use(brianPortalGate('NLCB'));

nlcbRouter.use('/config',                nlcbConfigRouter);
nlcbRouter.use('/games',                 nlcbGamesRouter);
nlcbRouter.use('/scratch-games',         nlcbScratchGamesRouter);
nlcbRouter.use('/scratch-pack-purchases', nlcbScratchPackPurchasesRouter);
nlcbRouter.use('/billers',               nlcbBillersRouter);
nlcbRouter.use('/sessions',              nlcbSessionsRouter);
// Scratch sales, scratch winnings, and bill payments nested under sessions
nlcbRouter.use('/sessions/:id',          nlcbScratchSessionRouter);
nlcbRouter.use('/settlements',           nlcbSettlementsRouter);
nlcbRouter.use('/expenses',              nlcbExpensesRouter);
