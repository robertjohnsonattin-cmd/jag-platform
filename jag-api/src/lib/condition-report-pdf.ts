// Generates a Move-In / Move-Out Condition Report PDF from a
// prop_handover_checklists row's condition_items JSONB — the digital
// equivalent of the paper template's Schedule B, split into two separate
// signable documents (one per ENTRY/EXIT event) since each handover row only
// ever records ONE point-in-time condition per item, not move-in AND
// move-out together. Signed via Documenso (see routes/properties/handover.ts
// send-for-signing route) — both parties sign in the same on-site sitting.
import PDFDocument from 'pdfkit';

export interface ConditionItem {
  item: string;
  condition: string;
  notes?: string;
}

export interface ConditionReportData {
  type: 'ENTRY' | 'EXIT';
  property_address: string;
  unit_number: string | null;
  tenant_name: string;
  event_date: string | Date; // the handover's created_at (TIMESTAMPTZ, arrives as a Date from pg) or a supplied ISO date
  condition_items: ConditionItem[];
}

export interface ConditionSignField {
  name: string;
  type: 'signature' | 'date';
  role: 'LANDLORD' | 'TENANT';
  page: number;
  x: number; y: number; w: number; h: number;
}

type PDFDoc = InstanceType<typeof PDFDocument>;

// node-postgres returns DATE/TIMESTAMPTZ columns as native Date objects, not
// strings — read UTC getters (never local getters, Trinidad is UTC-4) to
// avoid shifting the calendar day back by one.
function parseYMD(iso: string | Date): { y: number; m: number; d: number } {
  if (iso instanceof Date) {
    return { y: iso.getUTCFullYear(), m: iso.getUTCMonth() + 1, d: iso.getUTCDate() };
  }
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

function fmtDate(iso: string | Date): string {
  const { y, m, d } = parseYMD(iso);
  return new Date(y, m - 1, d).toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function generateConditionReportPdf(d: ConditionReportData, fieldSink?: ConditionSignField[]): PDFDoc {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });

  let pageIndex = 0;
  doc.on('pageAdded', () => { pageIndex += 1; });

  const recordField = (name: string, type: ConditionSignField['type'], role: ConditionSignField['role'], x: number, y: number, w: number, h: number) => {
    if (!fieldSink) return;
    fieldSink.push({
      name, type, role, page: pageIndex,
      x: x / doc.page.width, y: y / doc.page.height, w: w / doc.page.width, h: h / doc.page.height,
    });
  };

  const title = d.type === 'ENTRY' ? 'MOVE-IN CONDITION REPORT' : 'MOVE-OUT CONDITION REPORT';
  const unitDesc = d.unit_number ? `Unit ${d.unit_number}` : 'the premises';

  doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
  doc.font('Helvetica').fontSize(9).text('Schedule B — Property Condition & Inventory Checklist', { align: 'center' });
  doc.moveDown(1);

  doc.font('Helvetica').fontSize(10);
  doc.text(`Property: ${d.property_address}${d.unit_number ? `, ${unitDesc}` : ''}`);
  doc.text(`Tenant: ${d.tenant_name}`);
  doc.text(`Date: ${fmtDate(d.event_date)}`);
  doc.moveDown(1);

  // ── Condition table (Item / Condition / Notes) ──────────────────────────────
  const COL_ITEM_X = 56, COL_ITEM_W = 240;
  const COL_COND_X = 300, COL_COND_W = 70;
  const COL_NOTES_X = 375, COL_NOTES_W = 164;
  const ROW_H = 22;

  const drawHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Item / Area', COL_ITEM_X, y, { width: COL_ITEM_W });
    doc.text('Condition', COL_COND_X, y, { width: COL_COND_W });
    doc.text('Notes', COL_NOTES_X, y, { width: COL_NOTES_W });
    doc.y = y + 16;
    doc.moveTo(COL_ITEM_X, doc.y).lineTo(COL_NOTES_X + COL_NOTES_W, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.3);
  };
  drawHeader();

  for (const row of d.condition_items) {
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + ROW_H > pageBottom) { doc.addPage(); drawHeader(); }
    const y = doc.y;
    doc.font('Helvetica').fontSize(9);
    doc.text(row.item, COL_ITEM_X, y, { width: COL_ITEM_W });
    doc.text(row.condition || '—', COL_COND_X, y, { width: COL_COND_W });
    doc.text(row.notes || '', COL_NOTES_X, y, { width: COL_NOTES_W });
    doc.y = y + ROW_H;
  }

  // ── Signatures ───────────────────────────────────────────────────────────────
  doc.moveDown(1.5);
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + 130 > pageBottom) doc.addPage();

  doc.font('Helvetica').fontSize(10).text(
    'Both parties confirm the above accurately reflects the condition of the Premises on the date stated.',
    { align: 'justify' },
  );
  doc.moveDown(1.5);

  // Field boxes need real headroom above the underline they sit on — a box
  // anchored exactly at the line's y and only 16pt tall renders squashed/
  // struck-through in Documenso (same bug found and fixed in lease-pdf.ts
  // during the session-43 lease-signing walkthrough). Float a 34pt box
  // between the label line and the underline instead.
  const sigBlock = (label: string, role: ConditionSignField['role']) => {
    doc.font('Helvetica-Bold').fontSize(10).text(`SIGNED by the ${label}`);
    doc.moveDown(2.4);
    const sigY = doc.y - 30;
    doc.font('Helvetica').fontSize(10).text('_________________________________');
    recordField(`${role}_SIGNATURE`, 'signature', role, 56, sigY, 220, 34);
    doc.text('Signature');
    doc.moveDown(1.6);
    const dateY = doc.y - 30;
    doc.text('_________________________________');
    recordField(`${role}_DATE`, 'date', role, 56, dateY, 220, 34);
    doc.text('Date');
    doc.moveDown(1.2);
  };
  sigBlock('LANDLORD', 'LANDLORD');
  sigBlock('TENANT', 'TENANT');

  doc.end();
  return doc;
}
