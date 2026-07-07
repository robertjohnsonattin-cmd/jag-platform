// Generates the JAG standard Trinidad & Tobago Tenancy Agreement PDF from
// data already on file (Enter Once) — party/premises/rent/deposit terms are
// never typed twice; everything comes from prop_lease_agreements + the linked
// tenant/unit/property rows. Clause text mirrors the firm's approved template
// "Tenancy_Agreement_Template_Final" verbatim; only the bracketed particulars
// (parties, dates, amounts) are filled in per lease.
import PDFDocument from 'pdfkit';

// Fixed particulars that never vary per lease — the template names Robert
// personally as Landlord (Driver's Permit number, distress-for-rent clauses
// etc. are drafted for an individual landlord, not the corporate entity).
const LANDLORD_NAME = 'Robert Johnson-Attin';
const LANDLORD_ID_NUMBER = 'DP# 643036';
const LANDLORD_EMAIL = 'robertjohnsonattin@gmail.com';
const LANDLORD_WHATSAPP = '(868) 277-3726';
const BANK_NAME = 'First Citizens Bank';
const BANK_ACCOUNT_NAME = 'Robert Johnson-Attin';
const BANK_ACCOUNT_NUMBER = '2503082';
const BANK_ACCOUNT_TYPE = 'Chequing';
const MINOR_REPAIR_CAP = 500;
const TERMINATION_ADMIN_FEE = 500;
const KEY_CHARGE_PER_SET = 300;
const RENT_RESTRICTION_THRESHOLD_UNFURNISHED = 1500;

export interface LeasePdfData {
  lease_type: string;
  start_date: string | Date;
  end_date: string | Date | null;
  monthly_rent: string;
  currency: string;
  security_deposit: string;
  payment_due_day: number;
  late_fee_type: string;
  late_fee_value: string | null;
  late_fee_grace_days: number | null;
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

// node-postgres returns DATE columns as native Date objects (UTC midnight for
// that calendar date), not strings — despite most of the rest of the codebase
// only ever having seen the ISO-string shape from JSON API responses. Handle
// both: for a Date, read UTC getters (never local getters — Trinidad is
// UTC-4, so local getters on a UTC-midnight Date shift the day back one).
function parseYMD(iso: string | Date): { y: number; m: number; d: number } {
  if (iso instanceof Date) {
    return { y: iso.getUTCFullYear(), m: iso.getUTCMonth() + 1, d: iso.getUTCDate() };
  }
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

function fmtDate(iso: string | Date | null): string {
  if (!iso) return 'N/A';
  const { y, m, d } = parseYMD(iso);
  return new Date(y, m - 1, d).toLocaleDateString('en-TT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoney(v: string | number, currency: string): string {
  return `${currency} $${parseFloat(String(v)).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ORDINAL_DAY: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 21: '21st', 22: '22nd', 23: '23rd', 31: '31st' };
function ordinalDay(n: number): string {
  return ORDINAL_DAY[n] ?? `${n}th`;
}

function monthName(m: number): string {
  return new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' });
}

function monthsBetween(startIso: string | Date, endIso: string | Date): number {
  const s = parseYMD(startIso);
  const e = parseYMD(endIso);
  let months = (e.y - s.y) * 12 + (e.m - s.m);
  if (e.d >= s.d) months += 1;
  return Math.max(months, 1);
}

type PDFDoc = InstanceType<typeof PDFDocument>;

// One entry per fillable/signable spot in the PDF — collected only when a
// `fieldSink` array is passed in (used by the DocuSeal send-for-signing route;
// the plain draft-download path leaves this undefined and pays no extra cost).
// Coordinates are fractions (0-1) of the page's own width/height, top-left
// origin (matches PDFKit's own coordinate system) — convert to DocuSeal's
// `areas` format at the call site.
export interface LeaseSignField {
  name: string;
  type: 'text' | 'date' | 'signature';
  role: 'LANDLORD' | 'TENANT';
  page: number;
  x: number; y: number; w: number; h: number;
}

export function generateLeaseAgreementPdf(d: LeasePdfData, fieldSink?: LeaseSignField[]): PDFDoc {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });

  // PDFKit fires 'pageAdded' for every new page — manual (doc.addPage()) or
  // automatic (text overflow) — so this stays accurate even though the exact
  // page count varies with lease data (longer names/addresses can push a
  // clause across a page boundary).
  let pageIndex = 0;
  doc.on('pageAdded', () => { pageIndex += 1; });

  const recordField = (name: string, type: LeaseSignField['type'], role: LeaseSignField['role'], x: number, y: number, w: number, h: number) => {
    if (!fieldSink) return;
    fieldSink.push({
      name, type, role, page: pageIndex,
      x: x / doc.page.width, y: y / doc.page.height, w: w / doc.page.width, h: h / doc.page.height,
    });
  };

  const fullAddress = [d.address_line1, d.address_line2, d.city].filter(Boolean).join(', ');
  const tName = tenantName(d);
  const isMonthToMonth = !d.end_date;
  const start = parseYMD(d.start_date);
  const lateFeePercent = d.late_fee_type === 'PERCENT' && d.late_fee_value ? parseFloat(d.late_fee_value) : 0;
  const lateFeeAmount = lateFeePercent > 0 ? (parseFloat(d.monthly_rent) * lateFeePercent) / 100 : 0;
  const graceDays = d.late_fee_grace_days ?? 0;

  let clauseNum = 0;
  const clause = (title: string, text: string) => {
    clauseNum += 1;
    doc.font('Helvetica-Bold').fontSize(10).text(`${clauseNum}. ${title}.  `, { continued: true, align: 'justify' });
    doc.font('Helvetica').fontSize(10).text(text, { align: 'justify' });
    doc.moveDown(0.6);
  };
  const partHeader = (text: string) => {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).text(text, { align: 'center' });
    doc.moveDown(0.5);
  };
  const ensureSpace = (needed: number) => {
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + needed > pageBottom) doc.addPage();
  };

  // ── Header ────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(16).text('TENANCY AGREEMENT', { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).text('THE REPUBLIC OF TRINIDAD AND TOBAGO', { align: 'center' });
  doc.font('Helvetica').fontSize(9).text(
    'Governed by the Landlord and Tenant Ordinance, the Finance Act 2025, and the general law of Trinidad and Tobago',
    { align: 'center' },
  );
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('PARTIES TO THIS AGREEMENT');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).text(
    `THIS AGREEMENT is made in duplicate this ${ordinalDay(start.d)} day of ${monthName(start.m)} in the Year of Our Lord ${start.y}, between:`,
  );
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(10).text('LANDLORD:');
  doc.font('Helvetica').fontSize(10).text(
    `${LANDLORD_NAME}, ID/DP No. ${LANDLORD_ID_NUMBER} (hereinafter "the Landlord") of the ONE PART;`,
  );
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).text('TENANT:');
  doc.font('Helvetica').fontSize(10).text(
    `${tName}${d.tenant_identification_number ? `, ${d.tenant_identification_type ?? 'ID'} No. ${d.tenant_identification_number}` : ''} (hereinafter "the Tenant") of the OTHER PART.`,
  );
  doc.moveDown(0.8);

  doc.font('Helvetica').fontSize(10).text(
    'WHEREAS the Landlord is entitled to and in possession of the property described herein.  WHEREBY IT IS AGREED as follows:',
    { align: 'justify' },
  );
  doc.moveDown(1);

  // ── PART I — GENERAL CONDITIONS ─────────────────────────────────────────────
  partHeader('PART I — GENERAL CONDITIONS');
  clause('PREMISES', `The Tenant agrees to rent the unfurnished property located at ${fullAddress}${d.unit_number ? `, Apartment/Unit ${d.unit_number}` : ''} (hereinafter "the Premises"), together with all fixtures and fittings forming part thereof.`);
  clause('COMMENCEMENT DATE', `This Agreement commences on ${ordinalDay(start.d)} day of ${monthName(start.m)} ${start.y}.`);
  clause(
    'DURATION',
    isMonthToMonth
      ? `This Agreement shall be on a month-to-month basis commencing on the date stated in Clause 2 above, unless sooner determined in accordance with the terms herein.`
      : `This Agreement shall be in full force and effect for a term of ${monthsBetween(d.start_date, d.end_date as string | Date)} month(s), commencing on the date stated in Clause 2 above, and shall expire on ${fmtDate(d.end_date)} ("the Expiry Date"), unless sooner determined in accordance with the terms herein.`,
  );

  // ── PART II — RENT & PAYMENTS ───────────────────────────────────────────────
  partHeader('PART II — RENT & PAYMENTS');
  clause(
    'RENT PAYMENT',
    `The Tenant shall pay to the Landlord a monthly rental of ${fmtMoney(d.monthly_rent, d.currency)} in advance on or before the ${ordinalDay(d.payment_due_day)} day of each calendar month, without any deduction whatsoever, unless prior written consent is given by the Landlord.  A grace period of ${graceDays} day(s) applies; rent received after the ${graceDays}th day of the month shall be deemed late.  ${lateFeePercent > 0 ? `A late payment penalty of ${lateFeePercent}% of the monthly rent (${fmtMoney(lateFeeAmount, d.currency)}) shall be applied automatically on the day immediately following the grace period.` : 'No automatic late payment penalty applies to this tenancy.'}  The Tenant shall settle all outstanding rent and penalties directly.  Only where such sums remain unpaid may the Landlord, as a last resort, deduct them from the Security Deposit, in which case the Tenant shall replenish the deposit to its full original amount within fourteen (14) days of written notice from the Landlord.`,
  );
  clause(
    'PAYMENT METHOD & NOTICE',
    `Rent shall be paid by bank deposit, bank transfer, or such other method as the Landlord designates in writing.  Upon each payment the Tenant shall immediately notify the Landlord via WhatsApp message or email, stating the Tenant's full name, the period covered, and the method and amount of payment.  Such notification does not constitute receipt; the Landlord shall confirm receipt in writing.  Payment details are set out in Schedule A.`,
  );
  clause(
    'RENT RECEIPTS',
    `The Landlord shall furnish the Tenant with a written or electronic receipt upon each payment of rent, specifying the amount received and the period to which it relates.  The Tenant shall retain all receipts as evidence of payment.`,
  );
  clause(
    'NON-WAIVER',
    `No acceptance by the Landlord of a late, partial, or irregular payment of rent, and no failure or delay by the Landlord to exercise any right under this Agreement, shall constitute a waiver of the Landlord's right to enforce strict compliance at any subsequent time.  All rights of the Landlord shall remain fully preserved unless expressly waived in writing signed by the Landlord.`,
  );

  // ── PART III — SECURITY DEPOSIT ─────────────────────────────────────────────
  partHeader('PART III — SECURITY DEPOSIT');
  clause(
    'SECURITY DEPOSIT',
    `On or before execution of this Agreement, the Tenant shall pay to the Landlord a Security Deposit of ${fmtMoney(d.security_deposit, d.currency)} as security against damage to the Premises, fixtures, fittings, against any unpaid rent or utilities, and against any breach by the Tenant of any covenant, condition, or other term of this Agreement.  The deposit shall be refunded within thirty (30) days after the Expiry Date or earlier lawful termination, less any deductions properly made hereunder, accompanied by a written itemised statement of deductions.`,
  );
  clause(
    'DEPOSIT NOT RENT',
    `The Security Deposit shall not be applied as a substitute for rent for any month, nor as the final month's rent, and shall in no way limit the Landlord's right to recover damages exceeding the deposit amount.`,
  );
  clause(
    'CONDITION REPORT',
    `On the commencement date, both parties shall complete and sign the Property Condition & Inventory Checklist at Schedule B, which shall be the definitive reference for assessing damage at the end of the tenancy, distinguishing damage from fair wear and tear.  A failure by the Tenant to attend and sign shall not prevent the Landlord from completing Schedule B unilaterally and serving a copy on the Tenant.`,
  );

  // ── PART IV — STATUTORY MATTERS ─────────────────────────────────────────────
  partHeader('PART IV — STATUTORY MATTERS');
  clause(
    'RENT RESTRICTION ACTS — NOT APPLICABLE',
    `The parties acknowledge that the monthly rental payable under this Agreement exceeds the statutory thresholds prescribed under the Rent Restriction Acts (Chapters 59:50–59:55) — being TT$${RENT_RESTRICTION_THRESHOLD_UNFURNISHED.toLocaleString()} per month for unfurnished premises and TT$1,000 per month for furnished premises.  Accordingly, the rent control and eviction restriction provisions of the Rent Restriction Acts do not apply to this tenancy.  This Agreement is governed solely by the Landlord and Tenant Ordinance, the general law of contract, and the common law of Trinidad and Tobago, together with any other applicable legislation.  Should the rent payable under any future renewal fall at or below the applicable statutory threshold, the parties shall seek legal advice as to whether those Acts then apply.`,
  );
  clause(
    'LANDLORD BUSINESS SURCHARGE',
    `The Tenant acknowledges that the Landlord is subject to the Landlord Business Surcharge introduced by the Finance Act 2025 and administered by the Board of Inland Revenue.  That surcharge is solely the Landlord's statutory obligation.  The rental amount stated in this Agreement is the gross amount payable by the Tenant and shall not be reduced by reason of any tax or surcharge levied upon the Landlord.`,
  );

  // ── PART V — TERMINATION & LAWFUL REMEDIES ──────────────────────────────────
  partHeader('PART V — TERMINATION & LAWFUL REMEDIES');
  clause(
    `LANDLORD'S RIGHT TO FORFEIT & RECOVER POSSESSION`,
    `If: (a) the rent or any part thereof remains unpaid for fourteen (14) days after becoming due, whether formally demanded or not; or (b) any covenant or condition of this Agreement is not performed or observed by the Tenant; then it shall be lawful for the Landlord to elect to forfeit this tenancy and to take all lawful steps to recover possession of the Premises, including applying to a court of competent jurisdiction for an order for possession.  The Landlord reserves all other lawful remedies, including damages and injunctive relief, without prejudice to any right of action for breach of covenant.`,
  );
  clause(
    'DISTRESS FOR RENT',
    `Without prejudice to any other remedy, and in accordance with the Landlord and Tenant Ordinance, the Landlord shall be entitled to levy distress for arrears of rent by instructing a licensed Private Bailiff to enter the Premises and seize and sell the Tenant's goods and chattels found thereon, subject to all applicable legal requirements governing distress.  The right to distrain shall survive the termination or expiry of this Agreement to the extent permitted by law.`,
  );
  clause(
    'RECOVERY OF RENT AFTER POSSESSION',
    `The Landlord's recovery of possession of the Premises shall not extinguish the Tenant's liability for rent, penalties, or damages outstanding as at the date of recovery.  The Landlord may sue for such sums in a court of competent jurisdiction after regaining possession.`,
  );
  clause(
    'EARLY TERMINATION BY TENANT',
    `The Tenant may terminate this Agreement before the Expiry Date by giving the Landlord not less than two (2) calendar months' prior written notice.  A termination administration fee of TT$${TERMINATION_ADMIN_FEE.toFixed(2)} shall be deducted from the Security Deposit as compensation for re-letting costs.  In lieu of serving the notice period, the Tenant may terminate forthwith upon written notice accompanied by: (i) payment of a sum equivalent to one (1) month's rent; and (ii) forfeiture of the full Security Deposit.  The Tenant shall remain liable for all rent and charges accrued to the actual date of vacation.`,
  );
  clause(
    'EARLY TERMINATION BY LANDLORD',
    `The Landlord may terminate this Agreement for reasonable cause by giving the Tenant not less than two (2) calendar months' written notice.  This clause does not affect the Landlord's right to forfeit the tenancy for breach under Clause 13.`,
  );
  clause(
    'HOLDING OVER',
    `If the Tenant remains in occupation after the Expiry Date without the Landlord's written consent, the Tenant shall be deemed a tenant at will only.  The Landlord's acceptance of any further payment shall not constitute the grant of a new tenancy unless evidenced by a fresh written agreement signed by both parties.  A tenancy at will may be terminated by the Landlord on one (1) calendar month's written notice.  All covenants and conditions of this Agreement shall remain binding during any holding-over period.`,
  );
  clause(
    'RENEWAL & FIRST OPTION',
    `Upon expiry, provided the Tenant has: (a) paid all rent without default; (b) performed all covenants; and (c) given the Landlord not more than three (3) months' and not less than one (1) month's written notice of the desire to renew, the Tenant shall have first option to enter into a fresh written tenancy agreement.  The rent and conditions for the renewed term shall be determined solely by the Landlord, at not less than the rent for the expiring term.`,
  );
  clause(
    'RENT INCREASE NOTICE',
    `Where the Landlord proposes to increase the rent upon renewal, the Landlord shall give the Tenant a minimum of two (2) calendar months' written notice of the proposed new rent prior to the Expiry Date.  If the Tenant fails to serve a renewal notice within the period stipulated in Clause 17, the Tenant's first option to renew shall lapse and the Landlord shall be free to re-let the Premises on such terms as the Landlord sees fit.`,
  );

  // ── PART VI — FORCE MAJEURE & LIABILITY ─────────────────────────────────────
  partHeader('PART VI — FORCE MAJEURE & LIABILITY');
  clause(
    'DAMAGE BY ACT OF GOD',
    `If the Premises are destroyed or rendered wholly uninhabitable by fire, flood, storm, earthquake, or other cause beyond the control of either party and through no default of the Tenant, either party may terminate this Agreement upon fourteen (14) days' written notice to the other, without compensation.  For the avoidance of doubt, no automatic suspension or abatement of rent shall arise by reason of any such event.  Any reduction in rent during a period of partial uninhabitability shall be at the Landlord's sole discretion and shall only take effect if agreed in writing by the Landlord.`,
  );
  clause(
    `LANDLORD'S EXCLUSION OF LIABILITY`,
    `The Landlord shall not be responsible to the Tenant or any person on the Premises for any accident, personal injury, or loss of or damage to property, save where such loss arises directly and solely from the Landlord's own proven negligence or material breach of this Agreement.`,
  );
  clause(
    `TENANT'S INDEMNITY`,
    `The Tenant shall indemnify, defend, and hold harmless the Landlord from and against all claims, actions, losses, damages, costs, and expenses (including legal fees on a full indemnity basis) arising out of or in connection with: (a) any injury to any person; (b) loss of or damage to any property; or (c) any breach of applicable law, occurring on the Premises and attributable to the act, omission, negligence, or default of the Tenant, household members, invitees, or guests.`,
  );

  // ── PART VII — NOTICES & COMMUNICATIONS ─────────────────────────────────────
  partHeader('PART VII — NOTICES & COMMUNICATIONS');
  clause(
    'FORM OF NOTICE',
    `All formal notices required under this Agreement shall be in writing and deemed properly served if: (a) delivered personally; (b) left at the Premises or at the receiving party's last known address; (c) sent by registered post (deemed served two (2) business days after posting); or (d) sent by WhatsApp message or email to the contact details in Schedule C, where a delivery or read receipt is obtained and retained by the sender.  Day-to-day communications may be conducted informally but shall not constitute formal notice for the purposes of any clause requiring written notice, including termination and breach.`,
  );

  // ── PART VIII — TENANT'S COVENANTS ──────────────────────────────────────────
  partHeader(`PART VIII — TENANT'S COVENANTS`);
  doc.font('Helvetica').fontSize(10).text('The Tenant hereby covenants with the Landlord as follows:');
  doc.moveDown(0.6);
  clause(
    'UTILITIES',
    `The Tenant shall, at the Tenant's sole expense, arrange for the electricity account for the Premises to be transferred into or registered in the Tenant's own name with the relevant authority within fourteen (14) days of the commencement date, and shall pay all electricity charges as and when they fall due throughout the tenancy.  Water and WASA charges for the Premises are included in the monthly rent and shall remain the Landlord's responsibility.  Internet, cable television, and all other communication or subscription services are entirely for the Tenant's own account and shall be contracted in the Tenant's name.  The Tenant shall ensure that no utility arrears remain outstanding on the Premises at the date of vacation.`,
  );
  clause(
    'NO ASSIGNMENT OR SUB-LETTING',
    `Not to assign, sub-let, or in any way part with possession of the Premises or any part thereof without the Landlord's prior written consent, which may be withheld at the Landlord's absolute discretion.  Any purported assignment or sub-letting without such consent shall be void and shall constitute a material breach of this Agreement.`,
  );
  clause(
    'MAINTENANCE',
    `To maintain and keep the Premises, all fixtures, and all fittings in good tenantable repair and condition throughout the tenancy, fair wear and tear excepted.`,
  );
  clause(
    'RESIDENTIAL USE ONLY',
    `Not to carry on any profession, trade, or business at the Premises; not to receive paying guests; not to display any notice board or signage; and to use the Premises solely as a strictly private residence.`,
  );
  clause(
    'MINOR REPAIRS',
    `To carry out, at the Tenant's sole expense, all minor interior repairs to fixtures and fittings up to TT$${MINOR_REPAIR_CAP.toFixed(2)} per individual repair occurrence.  Any single repair estimated to exceed TT$${MINOR_REPAIR_CAP.toFixed(2)} shall be reported to the Landlord in writing before any works are commenced.`,
  );
  clause(
    'NO STRUCTURAL ALTERATIONS',
    `Not to alter any electrical wiring, plumbing, sewage, or other installed equipment; not to remove any partitions, doors, or cupboards; and not to cut, maim, or injure any walls, without the Landlord's prior written consent.`,
  );
  clause(
    'ACCESS FOR INSPECTION & REPAIRS',
    `To permit the Landlord, or any duly authorised agent or workman, at all reasonable hours and upon reasonable prior notice (except in genuine emergencies), to enter the Premises to inspect, carry out works, or show the Premises to prospective tenants or purchasers.  Where defects for which the Tenant is liable are discovered, the Tenant shall make them good within thirty (30) days of written notice, failing which the Landlord may carry out the works and recover the reasonable cost as if it were rent in arrears.`,
  );
  clause(
    'DAMAGE & BREAKAGE',
    `Any loss in value due to damage, breakage, cigarette burns, writing on walls, or similar causes attributable to the Tenant, to the Premises or any fixtures, fittings, locks, doors, windows, glass, or counter-tops, shall be entirely for the Tenant's account.  The Tenant shall reimburse the Landlord the reasonable cost of repair or replacement, excepting only fair wear and tear and damage caused by insured risks beyond the Tenant's control.`,
  );
  clause(
    'NO PAINTING OR RENOVATIONS',
    `Not to apply any paint, wallpaper, or coating to, or carry out any renovation of, the interior or exterior of the Premises, including gates, railings, and fencing, without the Landlord's prior written consent.`,
  );
  clause(
    'NO PETS',
    `Not to keep any pets, live animals, poultry, livestock, or reptiles on the Premises without the Landlord's prior written consent, which may be withheld at the Landlord's absolute discretion.  Any consent granted may be revoked on fourteen (14) days' written notice if the Landlord reasonably determines that a nuisance or damage has resulted.`,
  );
  clause(
    'NUISANCE & QUIET ENJOYMENT OF NEIGHBOURS',
    `Not to do, suffer, or permit anything that constitutes a nuisance, annoyance, or disturbance to the Landlord or to the owners or occupiers of neighbouring properties.  Noise shall be kept at a reasonable minimum, particularly between 10:00 p.m. and 7:00 a.m.`,
  );
  clause(
    'VISITORS & OVERNIGHT GUESTS',
    `The Premises are let for the exclusive occupation of the Tenant and persons listed in Schedule C.  Overnight guests are permitted for periods not exceeding seven (7) consecutive nights without the Landlord's prior written consent.  No person shall take up de facto residence without the Landlord's prior written consent.  The Tenant shall be fully and personally responsible for the conduct of all visitors and guests on the Premises or in common areas.`,
  );
  clause(
    'COMMON AREAS, PARKING & WASTE',
    `To keep all common areas, corridors, stairwells, and car park areas clear of the Tenant's belongings at all times.  The Tenant is assigned parking space _______ (if applicable) and shall not use any other space.  All refuse shall be properly bagged and placed in the designated collection area on the days stipulated by the relevant municipal authority.  The Tenant shall not dispose of any item in a manner that may cause blockage to drains, pipes, or sewage systems.`,
  );
  clause(
    'VIEWING BY PROSPECTIVE TENANTS',
    `To permit the Landlord or the Landlord's agents, at reasonable daytime hours and upon prior notice, within the last twenty-eight (28) days before the Expiry Date or any notice of termination, to enter and view the Premises with prospective tenants or purchasers.`,
  );
  clause(
    'REINSTATEMENT ON VACATING',
    `Upon expiry or earlier termination, to repair or replace at the Tenant's sole expense, to the satisfaction of the Landlord, all walls, fixtures, fittings, locks, doors, windows, glass, counter-tops, tiles, and woodwork that have been damaged or broken during the tenancy, fair wear and tear excepted.  The Tenant shall return all sets of keys issued on commencement; a charge of TT$${KEY_CHARGE_PER_SET.toFixed(2)} per set shall be deducted from the Security Deposit for any unreturned keys.`,
  );
  clause(
    'COMPLIANCE WITH LAWS',
    `To comply with all applicable laws, by-laws, and regulations in the Tenant's use and occupation of the Premises, including those relating to public health, fire safety, and waste management.`,
  );

  // ── PART IX — LANDLORD'S COVENANTS ──────────────────────────────────────────
  partHeader(`PART IX — LANDLORD'S COVENANTS`);
  doc.font('Helvetica').fontSize(10).text('The Landlord hereby covenants with the Tenant as follows:');
  doc.moveDown(0.6);
  clause('PERFORMANCE', `To perform and observe all covenants and conditions of this Agreement on the Landlord's part.`);
  clause(
    'CONDITION OF PREMISES',
    `To provide the Premises in good repair and order at commencement, ensuring plumbing, drainage, and electrical installations comply with applicable local authority standards.`,
  );
  clause(
    'STRUCTURAL REPAIRS',
    `To effect all necessary structural repairs to the roof and fabric of the Premises and to comply with all lawful notices of the relevant local authority for the abatement of nuisances not caused by the Tenant requiring structural works.`,
  );
  clause(
    'QUIET ENJOYMENT',
    `That the Tenant, paying the rent and performing all covenants herein, shall peaceably hold and enjoy the Premises during the term without interruption by the Landlord or any person lawfully claiming under or in trust for the Landlord.`,
  );
  clause(
    'RATES & TAXES',
    `To pay all land rates, property taxes, and statutory charges levied upon the property.  For the avoidance of doubt, the Landlord Business Surcharge (Finance Act 2025) is solely the Landlord's obligation.`,
  );

  // ── PART X — GENERAL PROVISIONS ─────────────────────────────────────────────
  partHeader('PART X — GENERAL PROVISIONS');
  clause(
    'ENTIRE AGREEMENT',
    `This Agreement, together with its Schedules, constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, or agreements, whether oral or written, relating to the Premises.`,
  );
  clause(
    'SEVERABILITY',
    `If any provision is held invalid or unenforceable under the laws of Trinidad and Tobago, the remaining provisions shall continue in full force and effect.`,
  );
  clause(
    'GOVERNING LAW & JURISDICTION',
    `This Agreement shall be governed by and construed in accordance with the laws of the Republic of Trinidad and Tobago.  The parties submit to the exclusive jurisdiction of the courts of Trinidad and Tobago.`,
  );
  clause('AMENDMENTS', `No amendment, modification, or variation shall be valid unless made in writing and signed by both parties.`);
  clause(
    'COUNTERPARTS',
    `This Agreement is executed in duplicate.  Each party shall retain one original executed copy, both of which together shall constitute one and the same instrument.`,
  );
  clause('TIME OF THE ESSENCE', `Time is of the essence in relation to all dates, payment obligations, and notice periods specified in this Agreement.`);
  clause('COSTS', `Each party shall bear their own legal costs in connection with the preparation and execution of this Agreement, unless otherwise agreed in writing.`);

  // ── EXECUTION ────────────────────────────────────────────────────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('EXECUTION', { align: 'center' });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10).text(
    'IN WITNESS WHEREOF the Landlord and Tenant have hereunto set their respective hands the day and year first above written.',
    { align: 'justify' },
  );
  doc.moveDown(2);

  const sigBlock = (label: string, name: string, role: LeaseSignField['role']) => {
    ensureSpace(130);
    doc.font('Helvetica-Bold').fontSize(10).text(`SIGNED by the ${label}`);
    doc.moveDown(1.2);
    const sigLineY = doc.y;
    doc.font('Helvetica').fontSize(10).text('_________________________________');
    recordField(`${role}_SIGNATURE`, 'signature', role, 56, sigLineY, 220, 16);
    doc.text('Signature');
    doc.moveDown(0.8);
    doc.text('_________________________________');
    doc.text(`Full Name (Print): ${name}`);
    doc.moveDown(0.8);
    const dateLineY = doc.y;
    doc.text('_________________________________');
    recordField(`${role}_DATE`, 'date', role, 56, dateLineY, 220, 16);
    doc.text('Date');
    doc.moveDown(0.8);
    doc.text('Witness (optional):  _________________________________');
    doc.text('Witness Name & Signature');
    doc.moveDown(1.5);
  };
  sigBlock('LANDLORD', LANDLORD_NAME, 'LANDLORD');
  sigBlock('TENANT', tName, 'TENANT');

  // ── SCHEDULE A — PAYMENT DETAILS ────────────────────────────────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('SCHEDULE A — PAYMENT DETAILS', { align: 'center' });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10).text(
    `Rent shall be paid to the following account. The Tenant must include their full name and the rental period as the deposit reference (e.g. "RENT — ${tName.toUpperCase()} — ${monthName(start.m).toUpperCase()} ${start.y}") and shall notify the Landlord via WhatsApp immediately upon each deposit:`,
    { align: 'justify' },
  );
  doc.moveDown(1);
  const fieldRow = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fontSize(10).text(`${label}:  `, { continued: true });
    doc.font('Helvetica').fontSize(10).text(value);
    doc.moveDown(0.5);
  };
  fieldRow('Bank Name', BANK_NAME);
  fieldRow('Account Name', BANK_ACCOUNT_NAME);
  fieldRow('Account Number', BANK_ACCOUNT_NUMBER);
  fieldRow('Account Type', BANK_ACCOUNT_TYPE);
  fieldRow('Branch', '_______________________________');
  fieldRow('Landlord WhatsApp', LANDLORD_WHATSAPP);
  fieldRow('Landlord Email', LANDLORD_EMAIL);

  // ── SCHEDULE B — PROPERTY CONDITION & INVENTORY CHECKLIST ───────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('SCHEDULE B — PROPERTY CONDITION & INVENTORY CHECKLIST', { align: 'center' });
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(9).text(
    'To be completed and signed by BOTH parties on the commencement date and again on the vacating date. This Schedule is binding evidence of the condition of the Premises at each date.',
    { align: 'justify' },
  );
  doc.font('Helvetica').fontSize(9).text('Condition Ratings:  E = Excellent   |   G = Good   |   F = Fair   |   P = Poor   |   N/A = Not Applicable');
  doc.moveDown(0.8);

  const CHECKLIST_ITEMS = [
    'Living Room — walls, ceiling, floor',
    'Living Room — doors & windows',
    'Living Room — light fixtures & switches',
    'Living Room — ceiling fan(s)',
    'Dining Area — walls, ceiling, floor',
    'Kitchen — cabinets & counter-tops',
    'Kitchen — sink & taps',
    'Kitchen — light fixtures & switches',
    'Kitchen — appliances (if any)',
    'Bedroom(s) — walls, ceiling, floor',
    'Bedroom(s) — doors & windows',
    'Bedroom(s) — light fixtures & switches',
    'Bedroom(s) — ceiling fan(s)',
    'Bathroom — toilet bowl & cistern',
    'Bathroom — toilet seat & cover',
    'Bathroom — basin & taps',
    'Bathroom — shower/tub & fittings',
    'Bathroom — tiles & grouting',
    'Bathroom — light fixture & extractor',
    'Electrical — switches, sockets & panel',
    'Plumbing — taps & water pressure',
    'Air-conditioning unit(s)',
    'Locks & keys (sets issued: ___)',
    'Gallery / Balcony',
    'Parking space',
    'Common area / stairwell',
    'Other: ______________________',
  ];

  const COL_LABEL_X = 56;
  const COL_LABEL_W = 200;
  const COL_W = 68;
  const cols = [COL_LABEL_X + COL_LABEL_W, COL_LABEL_X + COL_LABEL_W + COL_W, COL_LABEL_X + COL_LABEL_W + COL_W * 2, COL_LABEL_X + COL_LABEL_W + COL_W * 3];
  const ROW_H = 30;
  const drawChecklistHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5);
    doc.text('Item / Area', COL_LABEL_X, y, { width: COL_LABEL_W });
    doc.text('Move-In\nCondition', cols[0], y, { width: COL_W });
    doc.text('Move-In\nNotes', cols[1], y, { width: COL_W });
    doc.text('Move-Out\nCondition', cols[2], y, { width: COL_W });
    doc.text('Move-Out\nNotes', cols[3], y, { width: COL_W });
    doc.y = y + 22;
    doc.moveTo(COL_LABEL_X, doc.y).lineTo(COL_LABEL_X + COL_LABEL_W + COL_W * 4, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.3);
  };
  drawChecklistHeader();
  for (const item of CHECKLIST_ITEMS) {
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + ROW_H > pageBottom) {
      doc.addPage();
      drawChecklistHeader();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(8).text(item, COL_LABEL_X, y + 6, { width: COL_LABEL_W });
    doc.rect(cols[0], y, COL_W - 6, ROW_H).stroke();
    doc.rect(cols[1], y, COL_W - 6, ROW_H).stroke();
    doc.rect(cols[2], y, COL_W - 6, ROW_H).stroke();
    doc.rect(cols[3], y, COL_W - 6, ROW_H).stroke();
    doc.y = y + ROW_H + 4;
  }
  doc.moveDown(1);
  ensureSpace(80);
  doc.font('Helvetica').fontSize(9);
  doc.text('MOVE-IN     Landlord Signature: ________________________  Date: ___________');
  doc.moveDown(0.4);
  doc.text('                    Tenant Signature: ________________________  Date: ___________');
  doc.moveDown(0.6);
  doc.text('MOVE-OUT  Landlord Signature: ________________________  Date: ___________');
  doc.moveDown(0.4);
  doc.text('                    Tenant Signature: ________________________  Date: ___________');

  // ── SCHEDULE C — TENANT INFORMATION ─────────────────────────────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('SCHEDULE C — TENANT INFORMATION', { align: 'center' });
  doc.moveDown(1);
  const TENANT_INFO_FIELDS = [
    'Full Legal Name',
    `ID / Driver's Permit / Passport No.`,
    'Date of Birth',
    'Nationality',
    'Permanent / Family Address',
    'Occupation',
    'Employer / Place of Work',
    'Work Address',
    'Mobile Number',
    'Work Telephone',
    'Email Address',
    'WhatsApp No. (if different from mobile)',
    'No. of Authorised Occupants',
    `Occupants' Full Names & Relation to Tenant`,
  ];
  doc.font('Helvetica').fontSize(10);
  for (const label of TENANT_INFO_FIELDS) {
    ensureSpace(26);
    doc.font('Helvetica-Bold').fontSize(9).text(`${label}:`);
    const lineY = doc.y;
    doc.font('Helvetica').fontSize(9).text('_______________________________________________________________');
    recordField(label, 'text', 'TENANT', 56, lineY, 483, 14);
    doc.moveDown(0.4);
  }

  doc.moveDown(0.8);
  ensureSpace(90);
  doc.font('Helvetica-Bold').fontSize(10).text('Emergency Contacts');
  doc.moveDown(0.4);
  const ECOLS = [56, 200, 320, 410];
  const ecHeaderY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Full Name', ECOLS[0], ecHeaderY, { width: 140 });
  doc.text('Relation', ECOLS[1], ecHeaderY, { width: 110 });
  doc.text('Mobile No.', ECOLS[2], ecHeaderY, { width: 85 });
  doc.text('Address', ECOLS[3], ecHeaderY, { width: 130 });
  doc.y = ecHeaderY + 16;
  for (let i = 0; i < 3; i++) {
    const y = doc.y;
    doc.rect(ECOLS[0], y, 480, 24).stroke();
    doc.moveTo(ECOLS[1], y).lineTo(ECOLS[1], y + 24).stroke();
    doc.moveTo(ECOLS[2], y).lineTo(ECOLS[2], y + 24).stroke();
    doc.moveTo(ECOLS[3], y).lineTo(ECOLS[3], y + 24).stroke();
    doc.y = y + 24;
  }

  // ── ACKNOWLEDGEMENT ──────────────────────────────────────────────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('ACKNOWLEDGEMENT OF RECEIPT & UNDERSTANDING', { align: 'center' });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10).text(
    `Both parties confirm that they have read, understood, and agreed to all terms and conditions of this Agreement and Schedules A, B, and C; that Schedule B was completed at move-in; and that the Tenant has received _____ set(s) of keys to the Premises.`,
    { align: 'justify' },
  );
  doc.moveDown(0.8);
  doc.text(
    `The Tenant further acknowledges that: (a) no representations have been made by the Landlord or the Landlord's agents other than those expressly stated in this Agreement; and (b) the Tenant has had a reasonable opportunity to read and seek independent legal advice before signing.`,
    { align: 'justify' },
  );
  doc.moveDown(2);
  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(10).text('LANDLORD');
  doc.font('Helvetica').fontSize(10).text('_________________________________');
  doc.text('Signature & Date');
  doc.moveDown(1.5);
  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(10).text('TENANT');
  doc.font('Helvetica').fontSize(10).text('_________________________________');
  doc.text('Signature & Date');

  doc.end();
  return doc;
}
