// GET    /api/v1/crm/companies
// POST   /api/v1/crm/companies
// PATCH  /api/v1/crm/companies/:id
// DELETE /api/v1/crm/companies/:id   (Owner only — hard delete if no contacts)
// GET    /api/v1/crm/contacts
// POST   /api/v1/crm/contacts
// DELETE /api/v1/crm/contacts/:id    (Owner only — hard delete if no interactions)
// POST   /api/v1/crm/interactions

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { withTenantRLS } from '../../middleware/rls';
import { commercialPool, corePool } from '../../db/index';
import { logger } from '../../lib/logger';
import { ok, err } from '../../lib/response';
import { createAllDayCalendarEvent } from '../../lib/google-calendar';

export const crmRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const CompaniesQuerySchema = z.object({
  search: z.string().max(100).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(500).default(20),
}).strict();

const ContactsQuerySchema = z.object({
  company_id: z.string().uuid().optional(),
  search:     z.string().max(100).optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const CreateCompanySchema = z.object({
  name:          z.string().min(1).max(200),
  industry:      z.string().max(100).optional(),
  country:       z.string().length(2).default('TT'),
  phone:         z.string().max(50).optional(),
  email:         z.string().email().optional(),
  website:       z.string().url().optional(),
  notes:         z.string().max(2000).optional(),
  address_line1: z.string().max(200).optional(),
  address_line2: z.string().max(200).optional(),
  city:          z.string().max(100).optional(),
  state_province:z.string().max(100).optional(),
  postal_code:   z.string().max(20).optional(),
}).strict();

const PatchCompanySchema = z.object({
  name:          z.string().min(1).max(200).optional(),
  industry:      z.string().max(100).nullable().optional(),
  country:       z.string().length(2).optional(),
  phone:         z.string().max(50).nullable().optional(),
  email:         z.string().email().nullable().optional(),
  website:       z.string().url().nullable().optional(),
  notes:         z.string().max(2000).nullable().optional(),
  address_line1: z.string().max(200).nullable().optional(),
  address_line2: z.string().max(200).nullable().optional(),
  city:          z.string().max(100).nullable().optional(),
  state_province:z.string().max(100).nullable().optional(),
  postal_code:   z.string().max(20).nullable().optional(),
}).strict().refine(b => Object.keys(b).length > 0, { message: 'At least one field required.' });

const CreateContactSchema = z.object({
  first_name:         z.string().min(1).max(200),
  last_name:          z.string().min(1).max(200),
  email:              z.string().email().optional(),
  phone:              z.string().max(50).optional(),
  phone2:             z.string().max(50).optional(),
  role:               z.string().max(100).optional(),
  company_id:         z.string().uuid().optional(),
  notes:              z.string().max(5000).optional(),
  preferred_language: z.string().max(5).default('en'),
  address_line1:      z.string().max(200).optional(),
  address_line2:      z.string().max(200).optional(),
  city:               z.string().max(100).optional(),
  state_province:     z.string().max(100).optional(),
  postal_code:        z.string().max(20).optional(),
  birthday:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const InteractionTypeEnum = z.enum(['CALL', 'WHATSAPP_CALL', 'WHATSAPP_MESSAGE', 'EMAIL', 'MEETING', 'SITE_VISIT', 'OTHER']);

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
                  c.address_line1, c.address_line2, c.city, c.state_province, c.postal_code,
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
             (tenant_id, name, industry, country, phone, email, website, notes,
              address_line1, address_line2, city, state_province, postal_code, last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
           RETURNING *`,
          [tenantId, body.name, body.industry ?? null, body.country,
           body.phone ?? null, body.email ?? null, body.website ?? null, body.notes ?? null,
           body.address_line1 ?? null, body.address_line2 ?? null, body.city ?? null,
           body.state_province ?? null, body.postal_code ?? null],
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
          `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.phone2, ct.role,
                  ct.notes, ct.address_line1, ct.address_line2, ct.city, ct.state_province,
                  ct.postal_code, ct.birthday, ct.preferred_language,
                  ct.last_modified_at, ct.created_at,
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

// ── POST /crm/contacts ────────────────────────────────────────────────────────

crmRouter.post('/contacts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateContactSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const newContact = await withTenantRLS(client, req.rlsCtx, async (c) => {
        if (body.company_id) {
          const co = await c.query<{ id: string }>(
            `SELECT id FROM crm_companies WHERE id = $1`, [body.company_id],
          );
          if (co.rows.length === 0) {
            throw Object.assign(new Error('COMPANY_NOT_FOUND'), { httpStatus: 404 });
          }
        }

        return c.query(
          `INSERT INTO crm_contacts
             (tenant_id, company_id, first_name, last_name, email, phone, phone2,
              role, notes, preferred_language,
              address_line1, address_line2, city, state_province, postal_code, birthday,
              last_modified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
           RETURNING *`,
          [tenantId, body.company_id ?? null, body.first_name, body.last_name,
           body.email ?? null, body.phone ?? null, body.phone2 ?? null,
           body.role ?? null, body.notes ?? null, body.preferred_language,
           body.address_line1 ?? null, body.address_line2 ?? null, body.city ?? null,
           body.state_province ?? null, body.postal_code ?? null, body.birthday ?? null],
        ).then(r => r.rows[0]);
      });

      logger.info({ entity: 'CRM', action: 'CONTACT_CREATED', user_id: userId, tenant_id: tenantId, record_id: newContact.id });
      await auditLog(tenantId, userId, 'CrmContact', 'CREATE', newContact.id, body);
      ok(res, newContact, 201);
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'COMPANY_NOT_FOUND', 'Company not found.'); return; }
    next(e);
  }
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
      let contactName = '';
      const newInteraction = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const contact = await c.query<{ id: string; first_name: string; last_name: string }>(
          `SELECT id, first_name, last_name FROM crm_contacts WHERE id = $1`, [body.contact_id],
        );
        if (contact.rows.length === 0) {
          throw Object.assign(new Error('CONTACT_NOT_FOUND'), { httpStatus: 404 });
        }
        contactName = `${contact.rows[0].first_name} ${contact.rows[0].last_name}`.trim();

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

      // Create Google Calendar all-day event for follow-up — non-blocking
      if (body.follow_up_date) {
        const rlsCtx = req.rlsCtx;
        createAllDayCalendarEvent({
          title: `Follow-up: ${contactName} — ${body.subject}`,
          description: [`Type: ${body.interaction_type}`, body.notes ? `Notes: ${body.notes}` : ''].filter(Boolean).join('\n'),
          date: body.follow_up_date,
        }).then(async (eventId) => {
          const c2 = await commercialPool.connect();
          try {
            await withTenantRLS(c2, rlsCtx, (c) =>
              c.query(`UPDATE crm_interactions SET calendar_event_id = $1 WHERE id = $2`, [eventId, newInteraction.id]),
            );
            logger.info({ entity: 'CRM', action: 'CALENDAR_EVENT_CREATED', record_id: newInteraction.id, event_id: eventId });
          } finally { c2.release(); }
        }).catch((calErr: Error) => {
          logger.error({ entity: 'CRM', action: 'CALENDAR_EVENT_ERROR', record_id: newInteraction.id, error_message: calErr.message });
        });
      }
    } finally { client.release(); }
  } catch (e) {
    if ((e as { httpStatus?: number }).httpStatus === 404) { err(res, 404, 'CONTACT_NOT_FOUND', 'Contact not found.'); return; }
    next(e);
  }
});

// ── PATCH /crm/companies/:id ──────────────────────────────────────────────────

crmRouter.patch('/companies/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Company ID must be a valid UUID.'); return; }
    const parsed = PatchCompanySchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const fields: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => { params.push(val); fields.push(`${col} = $${params.length}`); };

        if (body.name          !== undefined) set('name', body.name);
        if (body.industry      !== undefined) set('industry', body.industry);
        if (body.country       !== undefined) set('country', body.country);
        if (body.phone         !== undefined) set('phone', body.phone);
        if (body.email         !== undefined) set('email', body.email);
        if (body.website       !== undefined) set('website', body.website);
        if (body.notes         !== undefined) set('notes', body.notes);
        if (body.address_line1 !== undefined) set('address_line1', body.address_line1);
        if (body.address_line2 !== undefined) set('address_line2', body.address_line2);
        if (body.city          !== undefined) set('city', body.city);
        if (body.state_province!== undefined) set('state_province', body.state_province);
        if (body.postal_code   !== undefined) set('postal_code', body.postal_code);
        set('last_modified_at', 'now()');
        params.push(id);

        return c.query(
          `UPDATE crm_companies SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'COMPANY_NOT_FOUND', 'Company not found.'); return; }
      logger.info({ entity: 'CRM', action: 'COMPANY_UPDATED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmCompany', 'UPDATE', id, body);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /crm/companies/:id ─────────────────────────────────────────────────
// Owner only. Hard deletes if no contacts are linked.

const UUIDParam = z.object({ id: z.string().uuid() });

crmRouter.delete('/companies/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Company ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const company = await c.query(`SELECT id, name FROM crm_companies WHERE id = $1`, [id])
          .then(r => r.rows[0] ?? null);
        if (!company) throw Object.assign(new Error('Company not found.'), { status: 404, code: 'COMPANY_NOT_FOUND' });

        const contactCount = await c.query<{ count: string }>(
          `SELECT count(*) FROM crm_contacts WHERE company_id = $1`, [id],
        ).then(r => Number(r.rows[0].count));

        if (contactCount > 0) {
          throw Object.assign(
            new Error('Company has linked contacts and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking: { contacts: contactCount } },
          );
        }

        await c.query(`DELETE FROM crm_companies WHERE id = $1`, [id]);
        return company.name;
      }).then(async (name) => {
        logger.info({ entity: 'CRM', action: 'COMPANY_DELETED', user_id: userId, tenant_id: tenantId, record_id: id });
        await auditLog(tenantId, userId, 'CrmCompany', 'DELETE', id, { name });
      });

      ok(res, { deleted: true, id });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'COMPANY_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking }); return; }
    next(e);
  }
});

// ── PATCH /crm/contacts/:id ───────────────────────────────────────────────────

const PatchContactSchema = z.object({
  first_name:         z.string().min(1).max(200).optional(),
  last_name:          z.string().min(1).max(200).optional(),
  email:              z.string().email().nullable().optional(),
  phone:              z.string().max(50).nullable().optional(),
  phone2:             z.string().max(50).nullable().optional(),
  role:               z.string().max(100).nullable().optional(),
  company_id:         z.string().uuid().nullable().optional(),
  notes:              z.string().max(5000).nullable().optional(),
  preferred_language: z.string().max(5).optional(),
  address_line1:      z.string().max(200).nullable().optional(),
  address_line2:      z.string().max(200).nullable().optional(),
  city:               z.string().max(100).nullable().optional(),
  state_province:     z.string().max(100).nullable().optional(),
  postal_code:        z.string().max(20).nullable().optional(),
  birthday:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().refine(b => Object.keys(b).length > 0, { message: 'At least one field required.' });

crmRouter.patch('/contacts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Contact ID must be a valid UUID.'); return; }
    const parsed = PatchContactSchema.safeParse(req.body);
    if (!parsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Request body validation failed.'); return; }

    const { id } = idParsed.data;
    const body = parsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      const updated = await withTenantRLS(client, req.rlsCtx, async (c) => {
        const fields: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => { params.push(val); fields.push(`${col} = $${params.length}`); };

        if (body.first_name         !== undefined) set('first_name', body.first_name);
        if (body.last_name          !== undefined) set('last_name', body.last_name);
        if (body.email              !== undefined) set('email', body.email);
        if (body.phone              !== undefined) set('phone', body.phone);
        if (body.phone2             !== undefined) set('phone2', body.phone2);
        if (body.role               !== undefined) set('role', body.role);
        if (body.company_id         !== undefined) set('company_id', body.company_id);
        if (body.notes              !== undefined) set('notes', body.notes);
        if (body.preferred_language !== undefined) set('preferred_language', body.preferred_language);
        if (body.address_line1      !== undefined) set('address_line1', body.address_line1);
        if (body.address_line2      !== undefined) set('address_line2', body.address_line2);
        if (body.city               !== undefined) set('city', body.city);
        if (body.state_province     !== undefined) set('state_province', body.state_province);
        if (body.postal_code        !== undefined) set('postal_code', body.postal_code);
        if (body.birthday           !== undefined) set('birthday', body.birthday);

        set('last_modified_at', 'now()');
        params.push(id);

        return c.query(
          `UPDATE crm_contacts SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        ).then(r => r.rows[0] ?? null);
      });

      if (!updated) { err(res, 404, 'CONTACT_NOT_FOUND', 'Contact not found.'); return; }

      logger.info({ entity: 'CRM', action: 'CONTACT_UPDATED', user_id: userId, tenant_id: tenantId, record_id: id });
      await auditLog(tenantId, userId, 'CrmContact', 'UPDATE', id, body);
      ok(res, updated);
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── GET /crm/contacts/:id ────────────────────────────────────────────────────

crmRouter.get('/contacts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Contact ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const client = await commercialPool.connect();
    try {
      const contact = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.phone2, ct.role,
                  ct.notes, ct.address_line1, ct.address_line2, ct.city, ct.state_province,
                  ct.postal_code, ct.birthday, ct.preferred_language,
                  ct.last_modified_at, ct.created_at,
                  co.id   AS company_id,
                  co.name AS company_name
           FROM   crm_contacts ct
           LEFT JOIN crm_companies co ON co.id = ct.company_id
           WHERE  ct.id = $1`,
          [id],
        ).then(r => r.rows[0] ?? null),
      );

      if (!contact) { err(res, 404, 'CONTACT_NOT_FOUND', 'Contact not found.'); return; }

      const interactions = await withTenantRLS(client, req.rlsCtx, (c) =>
        c.query(
          `SELECT id, interaction_type, subject, notes, occurred_at, follow_up_date, calendar_event_id, created_at
           FROM   crm_interactions
           WHERE  contact_id = $1
           ORDER  BY occurred_at DESC
           LIMIT  20`,
          [id],
        ).then(r => r.rows),
      );

      ok(res, { ...contact, interactions });
    } finally { client.release(); }
  } catch (e) { next(e); }
});

// ── DELETE /crm/contacts/:id ──────────────────────────────────────────────────
// Owner only. Hard deletes if no interactions are logged.

crmRouter.delete('/contacts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.rlsCtx.isOwner) { err(res, 403, 'FORBIDDEN', 'This action requires Owner role.'); return; }

    const idParsed = UUIDParam.safeParse(req.params);
    if (!idParsed.success) { err(res, 422, 'VALIDATION_ERROR', 'Contact ID must be a valid UUID.'); return; }

    const { id } = idParsed.data;
    const { userId, tenantId } = req.rlsCtx;

    const client = await commercialPool.connect();
    try {
      await withTenantRLS(client, req.rlsCtx, async (c) => {
        const contact = await c.query(
          `SELECT id, first_name, last_name FROM crm_contacts WHERE id = $1`, [id],
        ).then(r => r.rows[0] ?? null);
        if (!contact) throw Object.assign(new Error('Contact not found.'), { status: 404, code: 'CONTACT_NOT_FOUND' });

        const interactionCount = await c.query<{ count: string }>(
          `SELECT count(*) FROM crm_interactions WHERE contact_id = $1`, [id],
        ).then(r => Number(r.rows[0].count));

        if (interactionCount > 0) {
          throw Object.assign(
            new Error('Contact has logged interactions and cannot be deleted.'),
            { status: 409, code: 'DEPENDENCY_EXISTS', blocking: { interactions: interactionCount } },
          );
        }

        await c.query(`DELETE FROM crm_contacts WHERE id = $1`, [id]);
        return contact;
      }).then(async (contact) => {
        logger.info({ entity: 'CRM', action: 'CONTACT_DELETED', user_id: userId, tenant_id: tenantId, record_id: id });
        await auditLog(tenantId, userId, 'CrmContact', 'DELETE', id, { first_name: contact.first_name, last_name: contact.last_name });
      });

      ok(res, { deleted: true, id });
    } finally { client.release(); }
  } catch (e: unknown) {
    const ex = e as { status?: number; code?: string; blocking?: Record<string, number>; message: string };
    if (ex.status === 404) { err(res, 404, 'CONTACT_NOT_FOUND', ex.message); return; }
    if (ex.status === 409) { res.status(409).json({ success: false, data: null, error: ex.message, code: ex.code, blocking: ex.blocking }); return; }
    next(e);
  }
});
