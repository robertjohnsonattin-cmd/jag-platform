// Generates a standard Trinidad & Tobago residential/commercial lease agreement
// PDF from data already on file (Enter Once) — no clause text or party details
// are ever typed twice; everything comes from prop_lease_agreements + the
// linked tenant/unit/property rows.
import PDFDocument from 'pdfkit';

export interface LeasePdfData {
  lease_type: string;
  start_date: string;
  end_date: string | null;
  monthly_rent: string;
  currency: string;
  security_deposit: string;
  payment_due_day: number;
  late_fee_type: string;
  late_fee_value: string | null;
  late_fee_grace_days: number | null;
  landlord_name: string;
  tenant_first_name: string | null;
  tenant_last_name: string | null;
  tenant_company_name: string | null;
  tenant_is_company: boolean;
  tenant_identification_type: string | null;
  tenant_identification_number: string | null;
  property_name: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  unit_number: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area_sqft: number | null;
}

function tenantName(d: LeasePdfData): string {
  if (d.tenant_is_company && d.tenant_company_name) return d.tenant_company_name;
  return `${d.tenant_first_name ?? ''} ${d.tenant_last_name ?? ''}`.trim();
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'N/A';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoney(v: string, currency: string): string {
  return `${currency} $${parseFloat(v).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ORDINAL_DAY: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 21: '21st', 22: '22nd', 23: '23rd', 31: '31st' };
function ordinalDay(n: number): string {
  return ORDINAL_DAY[n] ?? `${n}th`;
}

export function generateLeaseAgreementPdf(d: LeasePdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });

  const propertyDesc = d.property_name ? `${d.property_name}, ${d.address_line1}` : d.address_line1;
  const fullAddress = [propertyDesc, d.address_line2, d.city].filter(Boolean).join(', ');
  const unitDesc = d.unit_number ? `Unit ${d.unit_number}` : 'the premises';
  const tName = tenantName(d);
  const isMonthToMonth = !d.end_date;

  const h1 = (text: string) => doc.font('Helvetica-Bold').fontSize(16).text(text, { align: 'center' }).moveDown(1);
  const h2 = (text: string) => doc.font('Helvetica-Bold').fontSize(11).text(text).moveDown(0.3);
  const body = (text: string) => doc.font('Helvetica').fontSize(10).text(text, { align: 'justify' }).moveDown(0.8);

  h1(`${d.lease_type === 'COMMERCIAL' ? 'COMMERCIAL' : 'RESIDENTIAL'} LEASE AGREEMENT`);

  body(
    `This Lease Agreement ("Agreement") is made and entered into on ${fmtDate(d.start_date)}, ` +
    `by and between ${d.landlord_name} ("Landlord"), and ${tName}` +
    `${d.tenant_identification_number ? ` (${d.tenant_identification_type ?? 'ID'}: ${d.tenant_identification_number})` : ''} ("Tenant"), ` +
    `collectively referred to as the "Parties".`
  );

  h2('1. PREMISES');
  body(
    `The Landlord agrees to lease to the Tenant ${unitDesc} located at ${fullAddress}` +
    `${d.bedrooms != null ? `, comprising ${d.bedrooms} bedroom(s)` : ''}` +
    `${d.bathrooms != null ? ` and ${d.bathrooms} bathroom(s)` : ''}` +
    `${d.floor_area_sqft != null ? `, with an approximate floor area of ${d.floor_area_sqft} sq. ft.` : ''} ` +
    `(the "Premises"), for residential/commercial use only, together with the fixtures and fittings therein.`
  );

  h2('2. TERM');
  body(
    isMonthToMonth
      ? `This Agreement shall commence on ${fmtDate(d.start_date)} and shall continue on a month-to-month basis until terminated by either Party in accordance with Clause 8 below.`
      : `This Agreement shall commence on ${fmtDate(d.start_date)} and shall terminate on ${fmtDate(d.end_date)}, unless renewed or terminated earlier in accordance with this Agreement.`
  );

  h2('3. RENT');
  body(
    `The Tenant shall pay to the Landlord rent of ${fmtMoney(d.monthly_rent, d.currency)} per month, due in advance on or before the ${ordinalDay(d.payment_due_day)} day of each month, ` +
    `payable by such method as the Landlord may direct.`
  );

  if (d.late_fee_type && d.late_fee_type !== 'NONE') {
    const feeDesc = d.late_fee_type === 'PERCENT'
      ? `${d.late_fee_value}% of the monthly rent`
      : fmtMoney(d.late_fee_value ?? '0', d.currency);
    body(
      `Should rent remain unpaid ${d.late_fee_grace_days ?? 0} day(s) after the due date, a late fee of ${feeDesc} shall apply for each month or part thereof that rent remains outstanding.`
    );
  }

  h2('4. SECURITY DEPOSIT');
  body(
    `The Tenant shall pay to the Landlord a security deposit of ${fmtMoney(d.security_deposit, d.currency)} prior to occupancy, held by the Landlord as security against damage to the Premises, unpaid rent, or breach of this Agreement. ` +
    `The deposit (less any lawful deductions) shall be refunded to the Tenant within a reasonable time after the Tenant vacates the Premises and returns possession to the Landlord in good condition, fair wear and tear excepted.`
  );

  h2('5. UTILITIES AND MAINTENANCE');
  body(
    `Unless otherwise agreed in writing, the Tenant shall be responsible for all utility accounts (electricity, water, internet, and similar services) arising during the tenancy. ` +
    `The Tenant shall keep the Premises in good and clean condition and shall promptly notify the Landlord of any defect or damage requiring repair. The Landlord shall be responsible for structural repairs and major mechanical/electrical systems, save where damage is caused by the Tenant's negligence or misuse.`
  );

  h2('6. USE OF PREMISES');
  body(
    `The Tenant shall use the Premises solely for lawful residential/commercial purposes and shall not sublet, assign, or share occupancy of the Premises without the prior written consent of the Landlord. ` +
    `The Tenant shall not carry out any alteration or addition to the Premises without the Landlord's prior written consent.`
  );

  h2('7. INSPECTION');
  body(
    `The Landlord, or the Landlord's authorised agent, may enter the Premises at reasonable times, upon reasonable prior notice to the Tenant, to inspect the condition of the Premises or to carry out repairs.`
  );

  h2('8. TERMINATION AND RENEWAL');
  body(
    isMonthToMonth
      ? `Either Party may terminate this Agreement by giving the other Party not less than thirty (30) days' written notice.`
      : `Upon expiry of the Term, this Agreement may be renewed by mutual written agreement of the Parties. Either Party intending not to renew shall give the other Party not less than thirty (30) days' written notice prior to expiry. The Landlord may terminate this Agreement earlier upon material breach by the Tenant, including non-payment of rent, subject to any notice required by law.`
  );

  h2('9. GOVERNING LAW');
  body(`This Agreement shall be governed by and construed in accordance with the laws of the Republic of Trinidad and Tobago.`);

  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(10).text('IN WITNESS WHEREOF, the Parties have executed this Agreement on the date first written above.', { align: 'justify' });
  doc.moveDown(2);

  // Reserve the whole signature block as one unit — absolute-coordinate .text()
  // calls each trigger their own page break if they don't fit individually,
  // which scatters the block across several near-blank pages. Forcing a single
  // page break up front (if needed) guarantees every line below lands together.
  const blockHeight = 100;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + blockHeight > pageBottom) doc.addPage();

  const sigY = doc.y;
  doc.font('Helvetica').fontSize(10);
  doc.text('_______________________________', 56, sigY);
  doc.text('Landlord', 56, sigY + 16);
  doc.text(d.landlord_name, 56, sigY + 30);

  doc.text('_______________________________', 320, sigY);
  doc.text('Tenant', 320, sigY + 16);
  doc.text(tName, 320, sigY + 30);

  doc.text('_______________________________', 56, sigY + 64);
  doc.text('Witness', 56, sigY + 80);

  doc.end();
  return doc;
}
