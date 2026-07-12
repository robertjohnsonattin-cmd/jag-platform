// Central source of the rent-collection bank details used across WhatsApp
// templates (rent reminders, missed-payment, demands, welcome pack). Kept in
// env vars (STD-07 — no secrets/config in code) so the account can change in
// one place without a code deploy. Values live in the VM /opt/jag/jag-infra/.env
// and MUST be wired into docker-compose.yml's api `environment:` block.
export interface PaymentDetails {
  payee: string;    // account holder name
  bank: string;     // bank name
  acctType: string; // e.g. Chequing / Savings
  acctNo: string;   // account number
}

export function getPaymentDetails(): PaymentDetails {
  return {
    payee:    process.env.JAG_BANK_ACCOUNT_NAME ?? 'Robert Johnson-Attin',
    bank:     process.env.JAG_BANK_NAME         ?? 'First Citizens Bank',
    acctType: process.env.JAG_BANK_ACCOUNT_TYPE ?? 'Chequing',
    acctNo:   process.env.JAG_BANK_ACCOUNT_NO   ?? '',
  };
}
