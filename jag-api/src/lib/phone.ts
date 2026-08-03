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
