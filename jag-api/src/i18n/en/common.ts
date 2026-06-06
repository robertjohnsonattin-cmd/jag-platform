// JAG Platform — English (en) common strings
// This is the baseline locale. All other locales must cover every key defined here.
// Rule: manual translation for financial/legal/compliance/alert strings.
//       Machine translation is acceptable for navigation labels only.

// LocaleCommon is the structural contract all locales must satisfy (string leaves, not literals).
// Defined here so zh/common.ts can import it without a circular reference.
export interface LocaleCommon {
  errors: Record<string, string>;
  status: Record<string, string>;
  finance: {
    currency: Record<string, string>;
    accountType: Record<string, string>;
    transactionType: Record<string, string>;
    loanType: Record<string, string>;
    netWorth: string;
    totalAssets: string;
    totalLiabilities: string;
  };
  notifications: {
    tier1: Record<string, { title: string; body: string }>;
    tier2: Record<string, { title: string; body: string }>;
    tier3: Record<string, { title: string; body: string }>;
  };
  alerts: Record<string, string>;
  family: {
    relationship: Record<string, string>;
    documentType: Record<string, string>;
  };
}

export const en_common: LocaleCommon = {

  // ── API error messages ────────────────────────────────────────────────────────
  errors: {
    UNAUTHORIZED:         'Authentication required. Please sign in.',
    FORBIDDEN:            'You do not have permission to perform this action.',
    NOT_FOUND:            'The requested record was not found.',
    VALIDATION_ERROR:     'One or more fields failed validation. Please check your input.',
    CONFLICT:             'This record already exists or conflicts with existing data.',
    SERVER_ERROR:         'An unexpected error occurred. Please try again or contact support.',
    IDEMPOTENCY_CONFLICT: 'A duplicate submission was detected and ignored.',
    TENANT_MISMATCH:      'Access denied: record does not belong to your organisation.',
    RATE_LIMITED:         'Too many requests. Please wait and try again.',
    MIGRATION_PENDING:    'A database migration is in progress. Please try again shortly.',
  },

  // ── Common status labels (used across multiple modules) ───────────────────────
  status: {
    ACTIVE:          'Active',
    INACTIVE:        'Inactive',
    PENDING:         'Pending',
    PENDING_REVIEW:  'Pending Review',
    APPROVED:        'Approved',
    REJECTED:        'Rejected',
    CANCELLED:       'Cancelled',
    COMPLETED:       'Completed',
    IN_PROGRESS:     'In Progress',
    DRAFT:           'Draft',
    PAID:            'Paid',
    OVERDUE:         'Overdue',
    FAILED:          'Failed',
    PROCESSING:      'Processing',
  },

  // ── Financial labels ──────────────────────────────────────────────────────────
  finance: {
    currency: {
      TTD: 'Trinidad and Tobago Dollar',
      USD: 'US Dollar',
      CNY: 'Chinese Yuan Renminbi',
      GBP: 'British Pound Sterling',
      EUR: 'Euro',
      CAD: 'Canadian Dollar',
    },
    accountType: {
      CHEQUE:      'Chequing Account',
      SAVINGS:     'Savings Account',
      CREDIT_CARD: 'Credit Card',
      MORTGAGE:    'Mortgage',
      LOAN:        'Loan',
      INVESTMENT:  'Investment Account',
      PENSION:     'Pension / Retirement Account',
      CRYPTO:      'Cryptocurrency',
      CASH:        'Cash',
      OTHER:       'Other',
    },
    transactionType: {
      DEBIT:          'Debit',
      CREDIT:         'Credit',
      TRANSFER_OUT:   'Transfer Out',
      TRANSFER_IN:    'Transfer In',
      FX_CONVERSION:  'Foreign Exchange Conversion',
    },
    loanType: {
      MORTGAGE:      'Mortgage',
      BUSINESS_LOAN: 'Business Loan',
      PERSONAL_LOAN: 'Personal Loan',
      CREDIT_CARD:   'Credit Card',
      OVERDRAFT:     'Overdraft Facility',
    },
    netWorth:    'Net Worth',
    totalAssets: 'Total Assets',
    totalLiabilities: 'Total Liabilities',
  },

  // ── Notification content — Tier 1 (immediate / critical) ─────────────────────
  // {{double-braces}} are runtime interpolation placeholders.
  notifications: {
    tier1: {
      SUCCESSION_ACTIVATED: {
        title:   'Succession Plan Activated',
        body:    'The JAG platform succession plan has been activated. Emergency designate access has been provisioned.',
      },
      AUTH_FAILED_REPEATED: {
        title:   'Repeated Sign-In Failures',
        body:    '{{count}} consecutive failed sign-in attempts detected for account {{email}}.',
      },
      BACKUP_FAILED: {
        title:   'Backup Failure',
        body:    'The nightly backup job failed at {{time}}. Immediate attention required.',
      },
      MIGRATION_FAILED: {
        title:   'Database Migration Failed',
        body:    'Migration {{file}} failed on {{database}}. Deployment has been halted.',
      },
      PAYMENT_FAILED: {
        title:   'Payment Processing Failed',
        body:    'Payment of {{amount}} {{currency}} on account {{account}} could not be processed.',
      },
      EVENT_DISPATCH_FAILED: {
        title:   'Event Dispatch Failure',
        body:    '{{count}} events have failed delivery after 3 retries. Manual review required.',
      },
    },

    // ── Notification content — Tier 2 (daily 7am digest) ─────────────────────
    tier2: {
      RENT_DUE_REMINDER: {
        title:   'Rent Due Reminder',
        body:    'Rent of {{amount}} TTD is due from {{tenant}} on {{date}}.',
      },
      DOCUMENT_EXPIRING: {
        title:   'Document Expiring Soon',
        body:    '{{document_title}} expires on {{expiry_date}}. Please review and renew.',
      },
      LOW_STOCK_ALERT: {
        title:   'Low Stock Alert',
        body:    'Item "{{item_name}}" at {{location}} is below minimum stock level ({{qty}} remaining).',
      },
      INVOICE_OVERDUE: {
        title:   'Invoice Overdue',
        body:    'Invoice {{invoice_number}} for {{amount}} TTD from {{vendor}} is {{days}} days overdue.',
      },
      AI_REVIEW_PENDING: {
        title:   'Bank Statement Review Required',
        body:    '{{count}} extracted transaction(s) from {{bank}} require your review before posting.',
      },
    },

    // ── Notification content — Tier 3 (weekly Monday digest) ─────────────────
    tier3: {
      WEEKLY_SUMMARY: {
        title:   'Weekly Platform Summary',
        body:    'Week ending {{date}}: {{transaction_count}} transactions posted, {{review_count}} items pending review.',
      },
      SUCCESSION_RENEWAL_DUE: {
        title:   'Annual Succession Credential Renewal Due',
        body:    'The annual succession plan credential renewal is due by {{due_date}}. Please complete the renewal process.',
      },
      LICENCE_RENEWAL_DUE: {
        title:   'Licence Renewal Reminder',
        body:    '{{licence_name}} for {{entity}} is due for renewal by {{due_date}}.',
      },
    },
  },

  // ── Alert strings (compliance / legal / financial) ────────────────────────────
  alerts: {
    SUCCESSION_RENEWAL_OVERDUE:
      'The succession plan annual renewal is overdue. Please review and confirm credentials.',
    DOCUMENT_CLASSIFIED:
      'This document is classified. Handle in accordance with the JAG data classification policy.',
    AI_CONFIDENCE_LOW:
      'This transaction was extracted with low confidence ({{score}}%). Please verify before approving.',
    FX_RATE_STALE:
      'The FX rate for {{pair}} is {{days}} days old. Results may not reflect current market rates.',
    MORTGAGE_PAYMENT_DUE:
      'Mortgage payment of {{amount}} {{currency}} is due on {{date}} for {{property}}.',
    OFFLINE_SYNC_CONFLICT:
      'A conflict was detected during offline sync for record {{record_id}}. Manual review required.',
    EXTERNAL_ESCALATION_CONSENT:
      'This document will be sent to an external AI service for processing. Bank data will not leave your infrastructure without your approval.',
  },

  // ── Family / succession labels ────────────────────────────────────────────────
  family: {
    relationship: {
      SELF:     'Self',
      WIFE:     'Wife',
      DAUGHTER: 'Daughter',
      FATHER:   'Father',
      BROTHER:  'Brother',
      OTHER:    'Other',
    },
    documentType: {
      WILL:                'Will',
      TRUST:               'Trust Deed',
      POWER_OF_ATTORNEY:   'Power of Attorney',
      INSURANCE_POLICY:    'Insurance Policy',
      TITLE_DEED:          'Title Deed',
      SHARE_CERTIFICATE:   'Share Certificate',
      BANK_MANDATE:        'Bank Mandate',
      COMPANY_RESOLUTION:  'Company Resolution',
      ADVANCE_DIRECTIVE:   'Advance Directive / Living Will',
      OTHER:               'Other Legal Document',
    },
  },

};
