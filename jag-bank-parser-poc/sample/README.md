# Sample Statements

Place test bank statement files in this directory:

```
sample/
├── republic_bank_sample.pdf      ← Republic Bank statement (PDF export)
├── first_citizens_sample.pdf     ← First Citizens statement
├── rbc_sample.csv                ← RBC CSV export
└── statement_sample.txt          ← Plain text (paste from any format)
```

**Note:** `.pdf`, `.csv`, and `.txt` files in this directory are git-ignored
to prevent accidental commit of real financial data.

## Running

```bash
npm run parse sample/republic_bank_sample.pdf
npm run parse sample/republic_bank_sample.pdf > parsed.json
```

## Sample plain-text format (for testing without a real statement)

Create `sample/test.txt` with content like:

```
Republic Bank Limited
Account Statement
Account Number: XXXXXXXXXX1234
Period: 01/01/2026 to 31/01/2026

Date        Description                        Ref          Debit       Credit      Balance
02/01/2026  Opening Balance                                                          12,450.00
05/01/2026  RENT CREDIT - BARATARIA            CHQ0012                  3,500.00    15,950.00
07/01/2026  ONLINE TRANSFER - MORTGAGE PMT     TXN8821      2,100.00                13,850.00
12/01/2026  UTILITY PAYMENT - T&TEC            UT3301       450.00                  13,400.00
15/01/2026  RENT CREDIT - FYZABAD              CHQ0013                  2,800.00    16,200.00
20/01/2026  ATM WITHDRAWAL                     ATM001       500.00                  15,700.00
31/01/2026  Closing Balance                                                          15,700.00
```

Expected output: 6 transactions, account_reference `****1234`, parsing_confidence `high`.
