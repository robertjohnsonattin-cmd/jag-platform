// Self-hosted Documenso e-signature client — server-to-server only. Tenants and
// the landlord never see Documenso's own dashboard/login, only the `/sign/<token>`
// signing page for their own recipient (used both as a WhatsApp link and as an
// embedded iframe on-site — see PropertiesPanel / Handover UI).
//
// Replaces the earlier DocuSeal integration: DocuSeal's free self-hosted edition
// turned out to 404 "Pro Edition" on the exact call needed (create submission
// from a raw PDF via API) — verified live before this was built, see
// project-esignature-docuseal memory. Documenso's Community Edition (AGPL-3.0)
// was smoke-tested end-to-end (create-from-PDF → recipient → field → distribute)
// against a throwaway instance and confirmed to work with no license gate.
//
// Documenso's data model differs from DocuSeal's in three ways this file has to
// bridge:
//   1. Fields attach to a numeric `recipientId`, not a free-text `role` string —
//      we still expose `role` (LANDLORD/TENANT) at our own API boundary and
//      resolve it to a recipientId internally after creating the document.
//   2. Field coordinates are 0-100 percentages of the page (`pageX/pageY/width/
//      height`), not 0-1 fractions — converted at the call site here, not by
//      callers (lease-pdf.ts / condition-report-pdf.ts stay in 0-1 fraction terms).
//   3. Every recipient needs an email (Documenso's whole model is email-based,
//      even for direct/magic-link signing) — synthesized when a tenant has only
//      a phone on file, since we deliver the actual link via WhatsApp ourselves.
//
// NOTE: field type mapping below (TEXT/DATE/SIGNATURE) matches Documenso's
// documented field type enum but has only been exercised for SIGNATURE in the
// live smoke test — verify TEXT/DATE placement on the first real send-for-signing
// call once DOCUMENSO_API_KEY is configured for real leases.
import { logger } from './logger';

// Internal Docker hostname — correct for server-to-server API calls, but never
// reachable from a browser. Same class of bug as the MinIO presigned-URL issue
// (session 36): the API base and the public signing-link base must be separate.
const BASE_URL = process.env['DOCUMENSO_BASE_URL'] ?? 'http://documenso:3000';
// Public domain — used only to build the /sign/<token> links handed to
// tenants/landlord (WhatsApp text, browser tab). Caught live 2026-07-07 when
// the first real send-for-signing call opened http://documenso:3000/sign/...
// in Robert's browser instead of https://sign.jagcorporate.com/sign/....
const PUBLIC_BASE_URL = process.env['DOCUMENSO_PUBLIC_BASE_URL'] ?? 'https://sign.jagcorporate.com';

function getApiKey(): string {
  const key = process.env['DOCUMENSO_API_KEY'];
  if (!key) throw new Error('DOCUMENSO_API_KEY not configured');
  return key;
}

export interface DocumensoFieldArea {
  page: number; // 0-indexed page number within the uploaded PDF
  x: number;    // 0-1 fraction of page width
  y: number;    // 0-1 fraction of page height
  w: number;
  h: number;
}

export interface DocumensoField {
  name: string;
  type: 'text' | 'date' | 'signature' | 'checkbox' | 'select';
  role: string; // logical role used only to resolve a recipientId — not sent to Documenso as-is
  required?: boolean;
  areas: DocumensoFieldArea[]; // callers only ever push one area per field; [0] is used
  options?: string[]; // for type: 'select' (unused currently — no DROPDOWN fields defined yet)
}

export interface DocumensoSubmitter {
  role: string; // logical role, e.g. LANDLORD / TENANT
  name?: string;
  email?: string;
  phone?: string; // kept for interface parity with the old DocuSeal shape; unused by Documenso
}

export interface CreateSubmissionParams {
  pdf: Buffer;
  fileName: string;
  fields: DocumensoField[];
  submitters: DocumensoSubmitter[];
  /** We deliver signing links ourselves via WhatsApp — kept for interface parity; Documenso may still email its own invite (no confirmed way to suppress it via this API endpoint). */
  sendEmail?: boolean;
}

export interface CreateSubmissionResult {
  submissionId: string;
  /** Keyed by submitter role, e.g. { LANDLORD: 'https://sign.../sign/abc', TENANT: '...' } */
  embedUrls: Record<string, string>;
}

const FIELD_TYPE_MAP: Record<DocumensoField['type'], string> = {
  text: 'TEXT',
  date: 'DATE',
  signature: 'SIGNATURE',
  checkbox: 'CHECKBOX',
  select: 'DROPDOWN',
};

// fieldMeta.type must match Documenso's lowercase per-type enum (confirmed against
// this instance's live /api/v2-beta/openapi.json) — same names as our own
// DocumensoField['type'] except 'select' -> 'dropdown'.
const FIELD_META_TYPE_MAP: Record<DocumensoField['type'], string> = {
  text: 'text',
  date: 'date',
  signature: 'signature',
  checkbox: 'checkbox',
  select: 'dropdown',
};

interface DocumensoRecipient {
  id: number;
  email: string;
  token: string;
}

interface DocumensoDocument {
  id: number;
  status: string;
  recipients: DocumensoRecipient[];
}

function authHeaders(): Record<string, string> {
  return { Authorization: getApiKey() };
}

function syntheticEmail(role: string, fileName: string): string {
  const slug = `${role}-${fileName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return `${slug}@no-reply.jagcorporate.com`;
}

async function getDocument(documentId: string): Promise<DocumensoDocument> {
  const res = await fetch(`${BASE_URL}/api/v2-beta/document/${documentId}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'DOCUMENSO', action: 'GET_DOCUMENT_FAILED', status: res.status, body });
    throw new Error(`Documenso API error ${res.status}: ${body}`);
  }
  return (await res.json()) as DocumensoDocument;
}

export async function createSigningSubmission(params: CreateSubmissionParams): Promise<CreateSubmissionResult> {
  const recipientPayload = params.submitters.map(s => ({
    email: s.email ?? syntheticEmail(s.role, params.fileName),
    name: s.name ?? s.role,
    role: 'SIGNER',
  }));

  const form = new FormData();
  form.append('payload', JSON.stringify({ title: params.fileName, recipients: recipientPayload }));
  form.append('file', new Blob([new Uint8Array(params.pdf)], { type: 'application/pdf' }), params.fileName);

  const createRes = await fetch(`${BASE_URL}/api/v2-beta/document/create`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    logger.error({ entity: 'DOCUMENSO', action: 'CREATE_DOCUMENT_FAILED', status: createRes.status, body });
    throw new Error(`Documenso API error ${createRes.status}: ${body}`);
  }
  const { id: documentIdNum } = (await createRes.json()) as { id: number };
  const documentId = String(documentIdNum);

  // Documenso auto-fills DATE fields at signing time using the document's own
  // meta.timezone/dateFormat — left unset this defaulted to server time (UTC,
  // since the container runs UTC) in whatever format Documenso picked, which
  // showed as a 4-hour-ahead timestamp for Trinidad (UTC-4) signers. Set both
  // explicitly; "yyyy-MM-dd hh:mm a" is Documenso's 12-hour (AM/PM) format.
  const metaRes = await fetch(`${BASE_URL}/api/v2-beta/document/update`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentId: documentIdNum,
      meta: { timezone: 'America/Port_of_Spain', dateFormat: 'yyyy-MM-dd hh:mm a' },
    }),
  });
  if (!metaRes.ok) {
    const body = await metaRes.text();
    logger.warn({ entity: 'DOCUMENSO', action: 'SET_META_FAILED', status: metaRes.status, body, document_id: documentId });
  }

  // Resolve each logical role to the recipientId Documenso assigned, matching by
  // the email we just sent (order is preserved but email match is normally more
  // robust) — EXCEPT when two submitters share the same email (e.g. a test
  // tenant using the landlord's own address, or any real household reusing one
  // inbox): matching by email then collapses both roles onto whichever
  // recipient the .find() happens to return first, leaving the other with zero
  // fields attached and Documenso's distribute step rejecting the whole
  // submission ("recipient X missing required fields"). Only trust the email
  // match when that email is unique among this submission's recipients;
  // otherwise fall back to positional order, which Documenso preserves from
  // the request payload.
  const doc = await getDocument(documentId);
  const emailCounts = new Map<string, number>();
  for (const r of recipientPayload) emailCounts.set(r.email, (emailCounts.get(r.email) ?? 0) + 1);
  const roleToRecipientId = new Map<string, number>();
  params.submitters.forEach((s, i) => {
    const email = recipientPayload[i].email;
    const emailIsUnique = (emailCounts.get(email) ?? 0) === 1;
    const match = (emailIsUnique ? doc.recipients.find(r => r.email === email) : undefined) ?? doc.recipients[i];
    if (match) roleToRecipientId.set(s.role, match.id);
  });

  for (const f of params.fields) {
    const area = f.areas[0];
    if (!area) continue;
    const recipientId = roleToRecipientId.get(f.role);
    if (recipientId === undefined) {
      logger.warn({ entity: 'DOCUMENSO', action: 'FIELD_NO_RECIPIENT', document_id: documentId, role: f.role, field_name: f.name });
      continue;
    }
    const fieldRes = await fetch(`${BASE_URL}/api/v2-beta/document/field/create`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: documentIdNum,
        field: {
          recipientId,
          type: FIELD_TYPE_MAP[f.type],
          pageNumber: area.page + 1, // Documenso pages are 1-indexed; PDFKit page tracking here is 0-indexed
          pageX: area.x * 100,
          pageY: area.y * 100,
          width: area.w * 100,
          height: area.h * 100,
          // required/label were computed on our side (see f.required) but never
          // actually reached Documenso — its API nests both under fieldMeta, not
          // top-level. Without this, no field is enforced before a recipient can
          // mark themselves complete, so entire schedules could be skipped silently.
          fieldMeta: {
            type: FIELD_META_TYPE_MAP[f.type],
            required: f.required ?? false,
            label: f.name,
          },
        },
      }),
    });
    if (!fieldRes.ok) {
      const body = await fieldRes.text();
      logger.error({ entity: 'DOCUMENSO', action: 'CREATE_FIELD_FAILED', status: fieldRes.status, body, field_name: f.name });
      throw new Error(`Documenso API error ${fieldRes.status}: ${body}`);
    }
  }

  const distributeRes = await fetch(`${BASE_URL}/api/v2-beta/document/distribute`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId: documentIdNum }),
  });
  if (!distributeRes.ok) {
    const body = await distributeRes.text();
    logger.error({ entity: 'DOCUMENSO', action: 'DISTRIBUTE_FAILED', status: distributeRes.status, body });
    throw new Error(`Documenso API error ${distributeRes.status}: ${body}`);
  }

  const finalDoc = await getDocument(documentId);
  const embedUrls: Record<string, string> = {};
  for (const [role, recipientId] of roleToRecipientId) {
    const recipient = finalDoc.recipients.find(r => r.id === recipientId);
    if (recipient?.token) embedUrls[role] = `${PUBLIC_BASE_URL}/sign/${recipient.token}`;
  }

  return { submissionId: documentId, embedUrls };
}

export async function getSubmission(documentId: string): Promise<{ status: string }> {
  const doc = await getDocument(documentId);
  return { status: doc.status };
}

export async function downloadSignedPdf(documentId: string): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/api/v2-beta/document/${documentId}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to download signed PDF: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
