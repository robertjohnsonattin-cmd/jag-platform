// Self-hosted DocuSeal e-signature client — server-to-server only. Tenants and
// the landlord never see DocuSeal's own login/dashboard, only the embed_src
// signing page returned per submitter (used both as a WhatsApp link and as an
// embedded iframe on-site — see PropertiesPanel / Handover UI).
//
// NOTE: field/response shapes below follow DocuSeal's documented
// POST /submissions/pdf contract (per-role fields with pixel `areas`,
// `X-Auth-Token` auth header, embed_src per submitter). Not yet exercised
// against a live instance — verify field placement + response parsing on the
// first real send-for-signing call once DOCUSEAL_API_KEY is configured.
import { logger } from './logger';

const BASE_URL = process.env['DOCUSEAL_BASE_URL'] ?? 'http://docuseal:3000';

function getApiKey(): string {
  const key = process.env['DOCUSEAL_API_KEY'];
  if (!key) throw new Error('DOCUSEAL_API_KEY not configured');
  return key;
}

export interface DocusealFieldArea {
  page: number; // 0-indexed page number within the uploaded PDF
  x: number;    // 0-1 fraction of page width (DocuSeal areas are relative, not pixel-absolute)
  y: number;    // 0-1 fraction of page height
  w: number;
  h: number;
}

export interface DocusealField {
  name: string;
  type: 'text' | 'date' | 'signature' | 'checkbox' | 'select';
  role: string;
  required?: boolean;
  areas: DocusealFieldArea[];
  options?: string[]; // for type: 'select'
}

export interface DocusealSubmitter {
  role: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface CreateSubmissionParams {
  pdf: Buffer;
  fileName: string;
  fields: DocusealField[];
  submitters: DocusealSubmitter[];
  /** We deliver signing links ourselves via WhatsApp — DocuSeal should not also email them. */
  sendEmail?: boolean;
}

export interface CreateSubmissionResult {
  submissionId: string;
  /** Keyed by submitter role, e.g. { LANDLORD: 'https://sign.../s/abc', TENANT: '...' } */
  embedUrls: Record<string, string>;
}

interface DocusealSubmitterResponse {
  submission_id: number | string;
  role: string;
  embed_src: string;
}

export async function createSigningSubmission(params: CreateSubmissionParams): Promise<CreateSubmissionResult> {
  const res = await fetch(`${BASE_URL}/api/submissions/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getApiKey() },
    body: JSON.stringify({
      name: params.fileName,
      documents: [{ name: params.fileName, file: params.pdf.toString('base64') }],
      submitters: params.submitters.map(s => ({ role: s.role, name: s.name, email: s.email, phone: s.phone })),
      fields: params.fields.map(f => ({
        name: f.name,
        type: f.type,
        role: f.role,
        required: f.required ?? true,
        areas: f.areas,
        options: f.options,
      })),
      send_email: params.sendEmail ?? false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'DOCUSEAL', action: 'CREATE_SUBMISSION_FAILED', status: res.status, body });
    throw new Error(`DocuSeal API error ${res.status}: ${body}`);
  }

  const submitters = (await res.json()) as DocusealSubmitterResponse[];
  if (!submitters.length) throw new Error('DocuSeal returned no submitters');

  const embedUrls: Record<string, string> = {};
  for (const s of submitters) embedUrls[s.role] = s.embed_src;

  return { submissionId: String(submitters[0].submission_id), embedUrls };
}

export async function getSubmission(submissionId: string): Promise<{ status: string; documentUrl?: string }> {
  const res = await fetch(`${BASE_URL}/api/submissions/${submissionId}`, {
    headers: { 'X-Auth-Token': getApiKey() },
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ entity: 'DOCUSEAL', action: 'GET_SUBMISSION_FAILED', status: res.status, body });
    throw new Error(`DocuSeal API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { status?: string; documents?: Array<{ url?: string }> };
  return { status: data.status ?? 'unknown', documentUrl: data.documents?.[0]?.url };
}

export async function downloadSignedPdf(documentUrl: string): Promise<Buffer> {
  const res = await fetch(documentUrl, { headers: { 'X-Auth-Token': getApiKey() } });
  if (!res.ok) throw new Error(`Failed to download signed PDF: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
