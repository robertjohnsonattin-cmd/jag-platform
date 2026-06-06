export interface WiPayWebhookPayload {
  wipay_reference: string;
  status: 'success' | 'failed' | 'pending' | 'refunded';
  amount: number;
  currency: string;
  payer_name?: string | null;
  payer_email?: string | null;
  transaction_date?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ApiResponse<T = null> {
  success: boolean;
  data: T;
  error: string | null;
  code: string | null;
}

export interface WebhookResult {
  received: boolean;
  idempotency_key: string;
}
