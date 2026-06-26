import { Router } from 'express';
import { hrDepartmentsRouter }  from './departments';
import { hrPositionsRouter }    from './positions';
import { hrEmployeesRouter }    from './employees';
import { hrLeaveRouter }        from './leave';
import { hrPayrollRouter }      from './payroll';
import { hrPerformanceRouter }  from './performance';
import { hrTrainingRouter }     from './training';
import { hrDisciplinaryRouter } from './disciplinary';
import { hrRecruitmentRouter }  from './recruitment';
import { hrAttendanceRouter }   from './attendance';

export const hrRouter = Router();

hrRouter.use('/departments',  hrDepartmentsRouter);
hrRouter.use('/positions',    hrPositionsRouter);
hrRouter.use('/employees',    hrEmployeesRouter);
hrRouter.use('/leave',        hrLeaveRouter);
hrRouter.use('/payroll',      hrPayrollRouter);
hrRouter.use('/performance',  hrPerformanceRouter);
hrRouter.use('/training',     hrTrainingRouter);
hrRouter.use('/disciplinary', hrDisciplinaryRouter);
hrRouter.use('/recruitment',  hrRecruitmentRouter);
hrRouter.use('/attendance',   hrAttendanceRouter);
