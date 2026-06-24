import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { financeApi } from '../api/finance'
import { fmtTTD, fmtDate, entityName } from '../lib/entities'
import { toCsv, downloadCsv, type CsvColumn } from '../lib/csv'
import type { ExportGlEntry } from '../types/finance'

// Entity options — same 7 tenant entities the Reports page exposes.
const ENTITY_IDS = [
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0001-000000000003',
  '00000000-0000-0000-0001-000000000004',
  '00000000-0000-0000-0001-000000000005',
  '00000000-0000-0000-0001-000000000006',
  '00000000-0000-0000-0001-000000000007',
]

const curYear   = new Date().getFullYear()
const yearStart = `${curYear}-01-01`
const today     = new Date().toISOString().slice(0, 10)

type TabId = 'trial-balance' | 'gl-entries' | 'expenses' | 'insurance' | 'premiums' | 'claims' | 'intercompany'
type Fmt   = 'money' | 'date' | 'entity' | 'bool' | 'text'

interface Col { key: string; label: string; fmt?: Fmt }

const TAB_META: Record<TabId, { controls: ('entity' | 'period' | 'dates' | 'status')[]; statusOptions: string[] }> = {
  'trial-balance': { controls: ['entity', 'period'],          statusOptions: [] },
  'gl-entries':    { controls: ['entity', 'dates', 'status'], statusOptions: ['DRAFT', 'POSTED', 'VOID'] },
  'expenses':      { controls: ['dates', 'status'],           statusOptions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] },
  'insurance':     { controls: [],                            statusOptions: [] },
  'premiums':      { controls: ['dates', 'status'],           statusOptions: ['DUE', 'PAID', 'OVERDUE', 'WAIVED'] },
  'claims':        { controls: ['status'],                    statusOptions: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SETTLED', 'WITHDRAWN'] },
  'intercompany':  { controls: ['dates', 'status'],           statusOptions: ['DRAFT', 'POSTED', 'ELIMINATED'] },
}

// ── Column definitions (English headers — accountant-facing, like TransactionsPanel) ──
const COLS: Record<Exclude<TabId, 'gl-entries'>, Col[]> = {
  'trial-balance': [
    { key: 'account_code', label: 'Code' },
    { key: 'account_name', label: 'Account' },
    { key: 'account_type', label: 'Type' },
    { key: 'normal_balance', label: 'Normal' },
    { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
    { key: 'total_debit_ttd', label: 'Debit TTD', fmt: 'money' },
    { key: 'total_credit_ttd', label: 'Credit TTD', fmt: 'money' },
    { key: 'net_ttd', label: 'Net TTD', fmt: 'money' },
    { key: 'entry_count', label: 'Entries' },
  ],
  expenses: [
    { key: 'expense_date', label: 'Date', fmt: 'date' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
    { key: 'amount', label: 'Amount', fmt: 'money' },
    { key: 'currency', label: 'CCY' },
    { key: 'amount_ttd', label: 'TTD', fmt: 'money' },
    { key: 'payment_method', label: 'Method' },
    { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
    { key: 'debit_account_code', label: 'Dr Acct' },
    { key: 'debit_account_name', label: 'Dr Acct Name' },
    { key: 'approved_at', label: 'Approved', fmt: 'date' },
  ],
  insurance: [
    { key: 'policy_number', label: 'Policy #' },
    { key: 'insurer_name', label: 'Insurer' },
    { key: 'policy_type', label: 'Type' },
    { key: 'coverage_amount_ttd', label: 'Coverage TTD', fmt: 'money' },
    { key: 'premium_amount_ttd', label: 'Premium TTD', fmt: 'money' },
    { key: 'premium_frequency', label: 'Frequency' },
    { key: 'start_date', label: 'Start', fmt: 'date' },
    { key: 'expiry_date', label: 'Expiry', fmt: 'date' },
    { key: 'is_active', label: 'Active', fmt: 'bool' },
    { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
    { key: 'overdue_premiums', label: 'Overdue' },
    { key: 'total_paid_ttd', label: 'Paid TTD', fmt: 'money' },
    { key: 'open_claims', label: 'Open Claims' },
    { key: 'total_settled_ttd', label: 'Settled TTD', fmt: 'money' },
  ],
  premiums: [
    { key: 'due_date', label: 'Due', fmt: 'date' },
    { key: 'paid_date', label: 'Paid', fmt: 'date' },
    { key: 'amount_ttd', label: 'Amount TTD', fmt: 'money' },
    { key: 'status', label: 'Status' },
    { key: 'payment_method', label: 'Method' },
    { key: 'policy_number', label: 'Policy #' },
    { key: 'insurer_name', label: 'Insurer' },
    { key: 'policy_type', label: 'Type' },
    { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
  ],
  claims: [
    { key: 'claim_reference', label: 'Reference' },
    { key: 'claim_date', label: 'Claim Date', fmt: 'date' },
    { key: 'incident_date', label: 'Incident', fmt: 'date' },
    { key: 'description', label: 'Description' },
    { key: 'claimed_amount_ttd', label: 'Claimed TTD', fmt: 'money' },
    { key: 'settled_amount_ttd', label: 'Settled TTD', fmt: 'money' },
    { key: 'status', label: 'Status' },
    { key: 'settlement_date', label: 'Settled', fmt: 'date' },
    { key: 'policy_number', label: 'Policy #' },
    { key: 'insurer_name', label: 'Insurer' },
    { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
  ],
  intercompany: [
    { key: 'charge_date', label: 'Date', fmt: 'date' },
    { key: 'description', label: 'Description' },
    { key: 'charge_type', label: 'Type' },
    { key: 'amount_ttd', label: 'Amount TTD', fmt: 'money' },
    { key: 'currency', label: 'CCY' },
    { key: 'status', label: 'Status' },
    { key: 'from_entity_id', label: 'From', fmt: 'entity' },
    { key: 'to_entity_id', label: 'To', fmt: 'entity' },
    { key: 'created_at', label: 'Created', fmt: 'date' },
  ],
}

// GL on-screen columns (entry-level); CSV is flattened to line level separately.
const GL_DISPLAY_COLS: Col[] = [
  { key: 'entry_date', label: 'Date', fmt: 'date' },
  { key: 'reference_number', label: 'Reference' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status' },
  { key: 'owner_entity_id', label: 'Entity', fmt: 'entity' },
  { key: 'total_debit_ttd', label: 'Debit TTD', fmt: 'money' },
  { key: 'total_credit_ttd', label: 'Credit TTD', fmt: 'money' },
  { key: 'line_count', label: 'Lines' },
]

const GL_CSV_COLS: CsvColumn[] = [
  { key: 'entry_date', label: 'Entry Date' },
  { key: 'reference_number', label: 'Reference' },
  { key: 'entry_description', label: 'Entry Description' },
  { key: 'status', label: 'Status' },
  { key: 'entity', label: 'Entity' },
  { key: 'account_code', label: 'Account Code' },
  { key: 'account_name', label: 'Account Name' },
  { key: 'debit_ttd', label: 'Debit TTD' },
  { key: 'credit_ttd', label: 'Credit TTD' },
  { key: 'line_description', label: 'Line Description' },
]

function glCsvRows(entries: ExportGlEntry[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const e of entries) {
    const base = {
      entry_date: e.entry_date,
      reference_number: e.reference_number ?? '',
      entry_description: e.description ?? '',
      status: e.status,
      entity: entityName(e.owner_entity_id),
    }
    if (e.lines.length === 0) {
      out.push({ ...base, account_code: '', account_name: '', debit_ttd: '', credit_ttd: '', line_description: '' })
      continue
    }
    for (const ln of e.lines) {
      out.push({
        ...base,
        account_code: ln.account_code,
        account_name: ln.account_name,
        debit_ttd: ln.debit_ttd ?? '',
        credit_ttd: ln.credit_ttd ?? '',
        line_description: ln.description ?? '',
      })
    }
  }
  return out
}

// Display formatting for a table cell.
function cell(row: Record<string, unknown>, col: Col): string {
  const v = row[col.key]
  switch (col.fmt) {
    case 'money':  return fmtTTD(v as string | number | null)
    case 'date':   return v ? fmtDate(v as string) : '—'
    case 'entity': return v ? entityName(String(v)) : '—'
    case 'bool':   return v ? '✓' : '—'
    default:       return v === null || v === undefined || v === '' ? '—' : String(v)
  }
}

// Raw-ish value for CSV: entity → name, bool → YES/NO, everything else raw.
function csvCell(row: Record<string, unknown>, col: Col): unknown {
  const v = row[col.key]
  if (v === null || v === undefined) return ''
  if (col.fmt === 'entity') return entityName(String(v))
  if (col.fmt === 'bool')   return v ? 'YES' : 'NO'
  return v
}

const isRight = (col: Col) => col.fmt === 'money'

// ── Generic table + CSV download ───────────────────────────────────────────────

function ExportTable({ rows, columns, filename, csvColumns, csvRows, note }: {
  rows: Record<string, unknown>[]
  columns: Col[]
  filename: string
  csvColumns?: CsvColumn[]
  csvRows?: Record<string, unknown>[]
  note?: string | null
}) {
  const { t } = useTranslation()

  const handleDownload = () => {
    const cols = csvColumns ?? columns.map(col => ({ key: col.key, label: col.label }))
    const data = csvRows ?? rows.map(row => {
      const o: Record<string, unknown> = {}
      for (const col of columns) o[col.key] = csvCell(row, col)
      return o
    })
    downloadCsv(filename, toCsv(data, cols))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500">{t('exportPage.rowCount', { count: rows.length })}</span>
        <button
          onClick={handleDownload}
          disabled={rows.length === 0}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded transition-colors"
        >
          {t('exportPage.downloadCsv')}
        </button>
      </div>

      {note && <p className="text-xs text-amber-500 mb-2">{note}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/50 text-slate-400 text-xs uppercase tracking-wide">
              {columns.map(col => (
                <th key={col.key} className={`px-3 py-2 ${isRight(col) ? 'text-right' : 'text-left'}`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {rows.map((row, i) => (
              <tr key={String(row.id ?? row.account_code ?? i)} className="hover:bg-slate-700/30 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className={`px-3 py-2 ${isRight(col) ? 'text-right font-mono' : 'text-left'} text-slate-200 whitespace-nowrap`}>
                    {cell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('exportPage.noData')}</p>}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Export() {
  const { t } = useTranslation()
  const [tab, setTab]           = useState<TabId>('trial-balance')
  const [entityId, setEntityId] = useState('')
  const [from, setFrom]         = useState(yearStart)
  const [to, setTo]             = useState(today)
  const [year, setYear]         = useState(curYear)
  const [month, setMonth]       = useState<number | ''>('')
  const [status, setStatus]     = useState('')

  const meta = TAB_META[tab]
  const entityParam = entityId || undefined
  const statusParam = status || undefined

  const tb = useQuery({
    queryKey: ['export', 'trial-balance', entityParam, year, month],
    queryFn: () => financeApi.getExportTrialBalance({ entity_id: entityParam, period_year: year, period_month: month || undefined }),
    enabled: tab === 'trial-balance',
  })
  const gl = useQuery({
    queryKey: ['export', 'gl-entries', entityParam, from, to, statusParam],
    queryFn: () => financeApi.getExportGlEntries({ entity_id: entityParam, from, to, status: statusParam }),
    enabled: tab === 'gl-entries',
  })
  const exp = useQuery({
    queryKey: ['export', 'expenses', from, to, statusParam],
    queryFn: () => financeApi.getExportExpenses({ from, to, status: statusParam }),
    enabled: tab === 'expenses',
  })
  const ins = useQuery({
    queryKey: ['export', 'insurance'],
    queryFn: () => financeApi.getExportInsurance(),
    enabled: tab === 'insurance',
  })
  const prem = useQuery({
    queryKey: ['export', 'premiums', from, to, statusParam],
    queryFn: () => financeApi.getExportPremiums({ from, to, status: statusParam }),
    enabled: tab === 'premiums',
  })
  const clm = useQuery({
    queryKey: ['export', 'claims', statusParam],
    queryFn: () => financeApi.getExportClaims({ status: statusParam }),
    enabled: tab === 'claims',
  })
  const ic = useQuery({
    queryKey: ['export', 'intercompany', from, to, statusParam],
    queryFn: () => financeApi.getExportIntercompany({ from, to, status: statusParam }),
    enabled: tab === 'intercompany',
  })

  const fetching = tb.isFetching || gl.isFetching || exp.isFetching || ins.isFetching || prem.isFetching || clm.isFetching || ic.isFetching

  const truncated = (total: number | undefined) =>
    total !== undefined && total > 500 ? t('exportPage.truncatedNote', { total }) : null

  const TABS: TabId[] = ['trial-balance', 'gl-entries', 'expenses', 'insurance', 'premiums', 'claims', 'intercompany']

  const asRows = <T,>(data: T[] | undefined) => (data ?? []) as unknown as Record<string, unknown>[]

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{t('exportPage.title')}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{t('exportPage.subtitle')}</p>
        </div>
        {fetching && <span className="text-xs text-slate-500 animate-pulse">{t('common.loading')}</span>}
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 mb-6 flex flex-wrap gap-4 items-end">
        {meta.controls.includes('entity') && (
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.entity')}</label>
            <select value={entityId} onChange={e => setEntityId(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">{t('exportPage.allEntities')}</option>
              {ENTITY_IDS.map(id => <option key={id} value={id}>{entityName(id)}</option>)}
            </select>
          </div>
        )}

        {meta.controls.includes('period') && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.year')}</label>
              <input type="number" min={2020} max={2099} value={year} onChange={e => setYear(Number(e.target.value))}
                className="w-24 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.month')}</label>
              <select value={month} onChange={e => setMonth(e.target.value ? Number(e.target.value) : '')}
                className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">{t('exportPage.allMonths')}</option>
                {Array.from({ length: 12 }, (_, m) => m + 1).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}

        {meta.controls.includes('dates') && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.from')}</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.to')}</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </>
        )}

        {meta.controls.includes('status') && (
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{t('exportPage.status')}</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">{t('exportPage.allStatuses')}</option>
              {meta.statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6">
        {TABS.map(id => (
          <button key={id} onClick={() => { setTab(id); setStatus('') }}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              tab === id ? 'bg-blue-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}>
            {t(`exportPage.tabs.${id}`)}
          </button>
        ))}
      </div>

      {/* Active view */}
      {tab === 'trial-balance' && (
        <ExportTable rows={asRows(tb.data)} columns={COLS['trial-balance']} filename={`trial-balance_${today}.csv`} />
      )}
      {tab === 'gl-entries' && (
        <ExportTable
          rows={(gl.data?.rows ?? []).map(e => ({ ...e, line_count: e.lines.length })) as unknown as Record<string, unknown>[]}
          columns={GL_DISPLAY_COLS}
          filename={`gl-entries_${today}.csv`}
          csvColumns={GL_CSV_COLS}
          csvRows={glCsvRows(gl.data?.rows ?? [])}
          note={truncated(gl.data?.total)}
        />
      )}
      {tab === 'expenses' && (
        <ExportTable rows={asRows(exp.data?.rows)} columns={COLS.expenses} filename={`expenses_${today}.csv`} note={truncated(exp.data?.total)} />
      )}
      {tab === 'insurance' && (
        <ExportTable rows={asRows(ins.data)} columns={COLS.insurance} filename={`insurance_${today}.csv`} />
      )}
      {tab === 'premiums' && (
        <ExportTable rows={asRows(prem.data)} columns={COLS.premiums} filename={`premiums_${today}.csv`} />
      )}
      {tab === 'claims' && (
        <ExportTable rows={asRows(clm.data)} columns={COLS.claims} filename={`claims_${today}.csv`} />
      )}
      {tab === 'intercompany' && (
        <ExportTable rows={asRows(ic.data)} columns={COLS.intercompany} filename={`intercompany_${today}.csv`} />
      )}
    </div>
  )
}
