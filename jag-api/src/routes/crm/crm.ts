// GET  /api/v1/crm/companies
// POST /api/v1/crm/companies
// GET  /api/v1/crm/contacts
// POST /api/v1/crm/interactions

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';

export const crmRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const CompaniesQuerySchema = z.object({
  search: z.string().max(100).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const ContactsQuerySchema = z.object({
  company_id: z.string().uuid().optional(),
  search:     z.string().max(100).optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const CreateCompanySchema = z.object({
  name:     z.string().min(1).max(200),
  industry: z.string().max(100).optional(),
  country:  z.string().length(2).default('TT'),
  phone:    z.string().max(30).optional(),
  email:    z.string().email().optional(),
  website:  z.string().url().optional(),
  notes:    z.string().max(2000).optional(),
}).strict();

const InteractionTypeEnum = z.enum(['CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER']);

const CreateInteractionSchema = z.object({
  contact_id:       z.string().uuid(),
  interaction_type: InteractionTypeEnum,
  subject:          z.string().min(1).max(200),
  notes:            z.string().max(5000).optional(),
  occurred_at:      z.string().datetime(),
  follow_up_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

// ── Shared audit helper ───────────────────────────────────────────────────────

async function auditLog(
  tenantId: string, userId: string,
  entity: string, action: string,
  recordId: string, newValues: unknown,
): Promise<void> {
  const client = await corePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity, action, record_id, new_values, source)
       VALUES ($1,$2,$3,$4,$5,$6,'API')`,
      [tenantId, userId, entity, action, recordId, JSON.stringify(newValues)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.warn({ entity: 'CRM', action: 'AUDIT_LOG_FAILED', error_message: (e as Error).message });
  } finally { client.release(); }
}

// ── GET /crm/companies ────────────────────────────────────────────────────────

crmRouter.get('/companies', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CompaniesQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { search, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];
        if (search) conditions.push(`c.name ILIKE ${push(`%${search}%`)}`);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM crm_companies c ${where}`, params,
        );
        const dataResult = await c.query(
          `SELECT c.id, c.name, c.industry, c.country, c.phone, c.email, c.website,
                  c.last_modified_at, c.created_at,
                  count(ct.id) AS contact_count
           FROM   crm_companies c
           LEFT JOIN crm_contacts ct ON ct.company_id = c.id
           ${where}
           GROUP BY c.id
           ORDER BY c.name ASC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'CRM', action: 'COMPANIES_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, { companies: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /crm/companies ───────────────────────────────────────────────────────

crmRouter.post('/companies', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateCompanySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newCompany = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `INSERT INTO crm_companies
             (tenant_id, name, industry, country, phone, email, website, notes, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
           RETURNING *`,
          [tenantId, body.name, body.industry ?? null, body.country,
           body.phone ?? null, body.email ?? null, body.website ?? null, body.notes ?? null],
        ).then(r => r.rows[0]),
      );

      logger.info({ entity: 'CRM', action: 'COMPANY_CREATED', user_id: userId, tenant_id: tenantId, record_id: newCompany.id });
      await auditLog(tenantId, userId, 'CrmCompany', 'CREATE', newCompany.id, body);
      ok(res, newCompany, 201);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /crm/contacts ─────────────────────────────────────────────────────────

crmRouter.get('/contacts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = ContactsQuerySchema.safeParse(req.query);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters.'); return; }

    const { company_id, search, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const client = await commercialPool.connect();
    try {
      const { rows, total } = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const params: unknown[] = [];
        const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
        const conditions: string[] = [];

        if (company_id) conditions.push(`ct.company_id = ${push(company_id)}`);
        if (search) {
          const s = push(`%${search}%`);
          conditions.push(`(ct.first_name ILIKE ${s} OR ct.last_name ILIKE ${s} OR ct.email ILIKE ${s})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await c.query<{ count: string }>(
          `SELECT count(*) FROM crm_contacts ct ${where}`, params,
        );
        const dataResult = await c.query(
          `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.role,
                  ct.preferred_language, ct.last_modified_at, ct.created_at,
                  co.id   AS company_id,
                  co.name AS company_name
           FROM   crm_contacts ct
           LEFT JOIN crm_companies co ON co.id = ct.company_id
           ${where}
           ORDER BY ct.last_name ASC, ct.first_name ASC
           LIMIT  ${push(limit)} OFFSET ${push(offset)}`,
          params,
        );
        return { rows: dataResult.rows, total: Number(countResult.rows[0].count) };
      });

      logger.info({ entity: 'CRM', action: 'CONTACTS_LIST', user_id: req.rlsCtx.userId, tenant_id: req.rlsCtx.tenantId, count: rows.length });
      ok(res, { contacts: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── POST /crm/interactions ────────────────────────────────────────────────────

crmRouter.post('/interactions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateInteractionSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newInteraction = await withTenantRLS(client, req.rlsCtx, async (c) => {
        // Verify contact exists and belongs to this tenant.
        const contact = await c.query<{ id: string }>(
          `SELECT id FROM crm_contacts WHERE id = $1`, [body.contact_id],
        );
        if (contact.rows.length === 0) {
          throw Object.assign(new Error('CONTACT_NOT_FOUND'), { httpStatus: 404 });
        }

        return c.query(
          `INSERT INTO crm_interactions
             (tenant_id, contact_id, user_id, interaction_type,
              subject, notes, occurred_at, follow_up_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [tenantId, body.contact_id, userId, body.interaction_type,
           body.subject, body.notes ?? null, body.occurred_at,
           body.follow_up_date ?? null],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'CRM', action: 'INTERACTION_LOGGED', user_id: userId, tenant_id: tenantId, record_id: newInteraction.id });
      await auditLog(tenantId, userId, 'CrmInteraction', 'CREATE', newInteraction.id, body);
      ok(res, newInteraction, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'CONTACT_NOT_FOUND', 'Contact not found.'); return; }
    next(e);
  }
});
