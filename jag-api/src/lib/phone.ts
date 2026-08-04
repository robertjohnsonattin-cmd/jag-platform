// Canonical phone key used to link records about the same person whatever
// format the number was entered in ('+1-868-555-1234', '18685551234',
// '555-1234'). Convention already used by the enquiries routes: strip all
// non-digits, keep the last 7 — the local subscriber number in Trinidad &
// Tobago. The key is a dedupe/grouping aid only, never something we dial or
// display.
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(-7);
}

// Normalizes a phone number before it's stored/dialled. Trinidad numbers are
// commonly typed as just the 7-digit local subscriber number, missing the
// 868 country/area code — that gap let an unusable number ("4702435")
// through unvalidated on 2026-08-02, and every WhatsApp send to it then
// failed silently (see docs/rules/properties.md). Auto-prefixes the 868/1
// country code for a bare 7 or 10-digit TT number; leaves anything longer
// alone (other countries), and rejects anything too short to be real.
export function normalizePhone(phone: string): { ok: true; value: string } | { ok: false; reason: string } {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 7) return { ok: true, value: `1868${digits}` };
  if (digits.length === 10 && digits.startsWith('868')) return { ok: true, value: `1${digits}` };
  if (digits.length >= 10 && digits.length <= 15) return { ok: true, value: digits };
  return { ok: false, reason: 'Phone number looks incomplete — include the country code (e.g. 868 for Trinidad).' };
}
