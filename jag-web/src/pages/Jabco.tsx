import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jabcoApi } from '../api/jabco'
import { crmApi } from '../api/crm'
import { financeApi } from '../api/finance'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import type {
  Project, BoqItem, VariationOrder, ProgressClaim, PaymentCertificate,
  VendorInvoice, SiteDiaryEntry, ProjectStatus,
  ProjectTask, PunchListItem, SiteIncident, QualityInspection,
} from '../types/jabco'
import type { InsurancePolicy, InsurancePolicyType } from '../types/finance'

// ── Constants ─────────────────────────────────────────────────────────────────

// Robert's jag_core user ID — sole project manager for now
const ROBERT_USER_ID = '95ca3f77-60ba-4a0f-af70-2832b247b525'

// JABCO Limited tenant UUID — owner_entity_id for project bonds/insurance
const JABCO_ENTITY_ID = '00000000-0000-0000-0001-000000000002'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500 placeholder-slate-500'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMoney = (v: string | number, currency = 'TTD') =>
  `${currency} ${fmt.format(Number(v))}`
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_STYLES: Record<ProjectStatus, string> = {
  TENDER:               'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  AWARDED:              'bg-cyan-900/50   text-cyan-300   border border-cyan-700',
  ACTIVE:               'bg-green-900/50  text-green-300  border border-green-700',
  PRACTICAL_COMPLETION: 'bg-blue-900/50   text-blue-300   border border-blue-700',
  DEFECTS_LIABILITY:    'bg-orange-900/50 text-orange-300 border border-orange-700',
  CLOSED:               'bg-slate-700/60  text-slate-400  border border-slate-600',
  CANCELLED:            'bg-red-900/50    text-red-400    border border-red-700',
}

// Module-level fallback labels (used as t() fallback values)
const STATUS_LABELS_FALLBACK: Record<ProjectStatus, string> = {
  TENDER:               'Tender',
  AWARDED:              'Awarded',
  ACTIVE:               'Active',
  PRACTICAL_COMPLETION: 'Practical Completion',
  DEFECTS_LIABILITY:    'Defects Liability',
  CLOSED:               'Closed',
  CANCELLED:            'Cancelled',
}

const INV_STYLES: Record<string, string> = {
  RECEIVED: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  APPROVED: 'bg-blue-900/50   text-blue-300   border border-blue-700',
  PAID:     'bg-green-900/50  text-green-300  border border-green-700',
}

const CERT_STYLES: Record<string, string> = {
  ISSUED:   'bg-blue-900/50   text-blue-300   border border-blue-700',
  PAID:     'bg-green-900/50  text-green-300  border border-green-700',
  OVERDUE:  'bg-red-900/50    text-red-400    border border-red-700',
  DISPUTED: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
}

const VO_STYLES: Record<string, string> = {
  PENDING:   'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  APPROVED:  'bg-green-900/50  text-green-300  border border-green-700',
  REJECTED:  'bg-red-900/50    text-red-400    border border-red-700',
  WITHDRAWN: 'bg-slate-700/60  text-slate-400  border border-slate-600',
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-slate-700/40 last:border-0">
      <span className="text-xs text-slate-400 shrink-0 w-40">{label}</span>
      <span className="text-xs text-slate-200 text-right">{value}</span>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// ── Create Project Modal ──────────────────────────────────────────────────────

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    project_code: '', name: '', client_name: '',
    client_type: 'GOVERNMENT' as 'GOVERNMENT' | 'PRIVATE',
    client_company_id: '',
    contract_value: '', contract_currency: 'TTD',
    vat_inclusive: false, vat_pct: '12.5',
    start_date: '', expected_end_date: '', site_address: '',
  })

  const { data: crmCompanies } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => crmApi.getCompanies({ limit: 200 }),
  })

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => jabcoApi.createProject({
      ...form,
      client_company_id: form.client_company_id || undefined,
      contract_value: parseFloat(form.contract_value),
      vat_pct: parseFloat(form.vat_pct),
      start_date: form.start_date || undefined,
      expected_end_date: form.expected_end_date || undefined,
      site_address: form.site_address || undefined,
      project_manager_id: ROBERT_USER_ID,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-projects'] })
      onClose()
    },
  })

  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const handleCompanySelect = (companyId: string) => {
    set('client_company_id', companyId)
    if (companyId && !form.client_name) {
      const co = crmCompanies?.companies.find(c => c.id === companyId)
      if (co) set('client_name', co.name)
    }
  }

  const disabled = !form.project_code || !form.name || !form.client_name || !form.contract_value || isPending

  return (
    <Modal title={t('jabco.newProject', 'New Project')} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.projectCode', 'Project Code *')}</label>
            <input value={form.project_code} onChange={e => set('project_code', e.target.value)} className={cls} placeholder="JAB-2026-001" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.clientType', 'Client Type *')}</label>
            <select value={form.client_type} onChange={e => set('client_type', e.target.value as 'GOVERNMENT' | 'PRIVATE')} className={cls}>
              <option value="GOVERNMENT">{t('jabco.government', 'Government')}</option>
              <option value="PRIVATE">{t('jabco.private', 'Private')}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.projectName', 'Project Name *')}</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} className={cls} placeholder="Road rehabilitation — Penal Rock Rd" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.crmClient', 'CRM Client')}</label>
          <select value={form.client_company_id} onChange={e => handleCompanySelect(e.target.value)} className={cls}>
            <option value="">{t('jabco.noCrmClient', '— None —')}</option>
            {crmCompanies?.companies.map(co => (
              <option key={co.id} value={co.id}>{co.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.clientName', 'Client Name *')}</label>
          <input value={form.client_name} onChange={e => set('client_name', e.target.value)} className={cls} placeholder="Ministry of Works" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.contractValue', 'Contract Value *')}</label>
            <input type="number" min="0" step="0.01" value={form.contract_value} onChange={e => set('contract_value', e.target.value)} className={cls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.currency', 'Currency')}</label>
            <input value={form.contract_currency} onChange={e => set('contract_currency', e.target.value)} className={cls} maxLength={3} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.vatPct', 'VAT %')}</label>
            <input type="number" min="0" max="100" step="0.5" value={form.vat_pct} onChange={e => set('vat_pct', e.target.value)} className={cls} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" id="vat_inc" checked={form.vat_inclusive} onChange={e => set('vat_inclusive', e.target.checked)} className="rounded" />
            <label htmlFor="vat_inc" className="text-xs text-slate-300">{t('jabco.vatInclusive', 'VAT Inclusive')}</label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.startDate', 'Start Date')}</label>
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.expectedEnd', 'Expected End')}</label>
            <input type="date" value={form.expected_end_date} onChange={e => set('expected_end_date', e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.siteAddress', 'Site Address')}</label>
          <textarea rows={2} value={form.site_address} onChange={e => set('site_address', e.target.value)} className={cls + ' resize-none'} />
        </div>
        {error && <p className="text-xs text-red-400">{t('jabco.failedCreate', 'Failed to create project.')}</p>}
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.creating', 'Creating…') : t('jabco.createProject', 'Create Project')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add BOQ Item Modal ────────────────────────────────────────────────────────

function AddBoqItemModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ section: '', item_number: '', description: '', unit: '', quantity_budgeted: '', unit_rate: '' })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.createBoqItem(project.id, {
      section: form.section,
      item_number: form.item_number || undefined,
      description: form.description,
      unit: form.unit,
      quantity_budgeted: parseFloat(form.quantity_budgeted),
      unit_rate: parseFloat(form.unit_rate),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-boq', project.id] }); onClose() },
  })

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const disabled = !form.section || !form.description || !form.unit || !form.quantity_budgeted || !form.unit_rate || isPending

  return (
    <Modal title={t('jabco.addBoqItem', 'Add BOQ Item')} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.section', 'Section *')}</label>
            <input value={form.section} onChange={e => set('section', e.target.value)} className={cls} placeholder="Earthworks" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.itemNumber', 'Item #')}</label>
            <input value={form.item_number} onChange={e => set('item_number', e.target.value)} className={cls} placeholder="1.01" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.description', 'Description *')}</label>
          <input value={form.description} onChange={e => set('description', e.target.value)} className={cls} placeholder="Excavation in hard material" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.unit', 'Unit *')}</label>
            <input value={form.unit} onChange={e => set('unit', e.target.value)} className={cls} placeholder="m³" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.quantity', 'Quantity *')}</label>
            <input type="number" min="0" step="any" value={form.quantity_budgeted} onChange={e => set('quantity_budgeted', e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.unitRate', 'Unit Rate *')}</label>
            <input type="number" min="0" step="0.01" value={form.unit_rate} onChange={e => set('unit_rate', e.target.value)} className={cls} />
          </div>
        </div>
        {form.quantity_budgeted && form.unit_rate && (
          <p className="text-xs text-slate-400 text-right">
            {t('jabco.amountCalc', 'Amount:')} <span className="text-slate-200 font-medium">{fmtMoney(parseFloat(form.quantity_budgeted) * parseFloat(form.unit_rate), project.contract_currency)}</span>
          </p>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.adding', 'Adding…') : t('jabco.addItem', 'Add Item')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add Variation Order Modal ─────────────────────────────────────────────────

function AddVOModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ vo_number: '', description: '', amount: '', submitted_date: new Date().toISOString().slice(0, 10) })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.createVO(project.id, {
      vo_number: form.vo_number,
      description: form.description,
      amount: parseFloat(form.amount),
      submitted_date: form.submitted_date || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-project-detail', project.id] }); onClose() },
  })

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const disabled = !form.vo_number || !form.description || !form.amount || isPending

  return (
    <Modal title={t('jabco.addVOTitle', 'Add Variation Order')} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.voNumber', 'VO Number *')}</label>
            <input value={form.vo_number} onChange={e => set('vo_number', e.target.value)} className={cls} placeholder="VO-001" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.voDate', 'Submitted Date')}</label>
            <input type="date" value={form.submitted_date} onChange={e => set('submitted_date', e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.voDescription', 'Description *')}</label>
          <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={cls + ' resize-none'} placeholder="Additional excavation due to rock encounter" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.voAmount', 'Amount * (negative for deduction)')}</label>
          <input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} className={cls} placeholder="50000.00" />
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.submittingVO', 'Submitting…') : t('jabco.submitVO', 'Submit VO')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Submit Progress Claim Modal ───────────────────────────────────────────────

function SubmitClaimModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ claim_number: '', period_from: '', period_to: '', amount_claimed: '' })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.createProgressClaim(project.id, {
      claim_number: parseInt(form.claim_number),
      period_from: form.period_from,
      period_to: form.period_to,
      amount_claimed: parseFloat(form.amount_claimed),
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-project-detail', project.id] }); onClose() },
  })

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const disabled = !form.claim_number || !form.period_from || !form.period_to || !form.amount_claimed || isPending

  return (
    <Modal title={t('jabco.claimTitle', 'Submit Progress Claim')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.claimNumber', 'Claim Number *')}</label>
          <input type="number" min="1" step="1" value={form.claim_number} onChange={e => set('claim_number', e.target.value)} className={cls} placeholder="1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.periodFrom', 'Period From *')}</label>
            <input type="date" value={form.period_from} onChange={e => set('period_from', e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.periodTo', 'Period To *')}</label>
            <input type="date" value={form.period_to} onChange={e => set('period_to', e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.amountClaimed', 'Amount Claimed *')}</label>
          <input type="number" min="0" step="0.01" value={form.amount_claimed} onChange={e => set('amount_claimed', e.target.value)} className={cls} placeholder="0.00" />
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.submittingVO', 'Submitting…') : t('jabco.submitClaimBtn', 'Submit Claim')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Issue Payment Certificate Modal ──────────────────────────────────────────

function IssueCertModal({ project, claims, onClose }: { project: Project; claims: ProgressClaim[]; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const uncertified = claims.filter(c => c.status !== 'CERTIFIED')
  const [form, setForm] = useState({
    progress_claim_id: uncertified[0]?.id ?? '',
    certificate_number: '', amount_certified: '',
    issued_date: new Date().toISOString().slice(0, 10), due_date: '',
  })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.createPaymentCert(project.id, {
      progress_claim_id: form.progress_claim_id,
      certificate_number: form.certificate_number,
      amount_certified: parseFloat(form.amount_certified),
      issued_date: form.issued_date,
      due_date: form.due_date || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-payment-certs', project.id] }); onClose() },
  })

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const disabled = !form.progress_claim_id || !form.certificate_number || !form.amount_certified || !form.issued_date || isPending

  if (uncertified.length === 0) {
    return (
      <Modal title={t('jabco.issueCertTitle', 'Issue Payment Certificate')} onClose={onClose}>
        <p className="text-sm text-slate-400 py-4 text-center">{t('jabco.noCertClaims', 'No uncertified claims available. Submit a progress claim first.')}</p>
      </Modal>
    )
  }

  return (
    <Modal title={t('jabco.issueCertTitle', 'Issue Payment Certificate')} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.progressClaimField', 'Progress Claim *')}</label>
          <select value={form.progress_claim_id} onChange={e => set('progress_claim_id', e.target.value)} className={cls}>
            {uncertified.map(c => (
              <option key={c.id} value={c.id}>
                Claim #{c.claim_number} — {fmtDate(c.period_from)} to {fmtDate(c.period_to)} — {fmtMoney(c.amount_claimed, project.contract_currency)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.certNumber', 'Certificate Number *')}</label>
          <input value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} className={cls} placeholder="PC-001" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('jabco.amountCertified', 'Amount Certified *')}</label>
          <input type="number" min="0" step="0.01" value={form.amount_certified} onChange={e => set('amount_certified', e.target.value)} className={cls} placeholder="0.00" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.issuedDate', 'Issued Date *')}</label>
            <input type="date" value={form.issued_date} onChange={e => set('issued_date', e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.dueDate', 'Due Date')}</label>
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={cls} />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.issuing', 'Issuing…') : t('jabco.issueCertBtn', 'Issue Certificate')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Mark Cert Paid Modal ──────────────────────────────────────────────────────

function MarkCertPaidModal({ project, cert, onClose }: { project: Project; cert: PaymentCertificate; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ paid_date: new Date().toISOString().slice(0, 10), payment_reference: '' })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.markCertPaid(project.id, cert.id, {
      paid_date: form.paid_date,
      payment_reference: form.payment_reference || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-payment-certs', project.id] }); onClose() },
  })

  return (
    <Modal title={t('jabco.markCertPaid', 'Mark {{cert}} as Paid', { cert: cert.certificate_number })} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{t('jabco.certAmount', 'Amount:')} <span className="text-slate-200 font-medium">{fmtMoney(cert.amount_certified, project.contract_currency)}</span></p>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.paidDate', 'Paid Date *')}</label>
          <input type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} className={cls} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.paymentReference', 'Payment Reference')}</label>
          <input value={form.payment_reference} onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))} className={cls} placeholder="Chq #12345 / EFT ref" />
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={!form.paid_date || isPending}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving', 'Saving…') : t('common.markPaid', 'Mark Paid')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Add Vendor Invoice Modal ──────────────────────────────────────────────────

function AddVendorInvoiceModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    vendor_name: '', vendor_type: 'SUPPLIER' as 'SUPPLIER' | 'SUBCONTRACTOR',
    invoice_ref: '', invoice_date: new Date().toISOString().slice(0, 10),
    due_date: '', amount: '', vat_amount: '0', vat_code: 'STANDARD', notes: '',
  })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.createVendorInvoice(project.id, {
      vendor_name: form.vendor_name,
      vendor_type: form.vendor_type,
      invoice_ref: form.invoice_ref || undefined,
      invoice_date: form.invoice_date,
      due_date: form.due_date || undefined,
      amount: parseFloat(form.amount),
      vat_amount: parseFloat(form.vat_amount || '0'),
      vat_code: form.vat_code,
      notes: form.notes || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-vendor-invoices', project.id] }); onClose() },
  })

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))
  const disabled = !form.vendor_name || !form.invoice_date || !form.amount || isPending

  return (
    <Modal title={t('jabco.addVendorInvoice', '+ Add Invoice')} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.vendorName', 'Vendor Name *')}</label>
            <input value={form.vendor_name} onChange={e => set('vendor_name', e.target.value)} className={cls} placeholder="Trinidad Aggregates Ltd" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.vendorType', 'Vendor Type')}</label>
            <select value={form.vendor_type} onChange={e => set('vendor_type', e.target.value as 'SUPPLIER' | 'SUBCONTRACTOR')} className={cls}>
              <option value="SUPPLIER">{t('jabco.supplier', 'Supplier')}</option>
              <option value="SUBCONTRACTOR">{t('jabco.subcontractor', 'Subcontractor')}</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.invoiceRef', 'Invoice Ref')}</label>
            <input value={form.invoice_ref} onChange={e => set('invoice_ref', e.target.value)} className={cls} placeholder="INV-2026-001" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.vatCode', 'VAT Code')}</label>
            <select value={form.vat_code} onChange={e => set('vat_code', e.target.value)} className={cls}>
              <option value="STANDARD">{t('jabco.vatStandard', 'Standard (12.5%)')}</option>
              <option value="ZERO">{t('jabco.vatZero', 'Zero-rated')}</option>
              <option value="EXEMPT">{t('jabco.vatExempt', 'Exempt')}</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.invoiceDate', 'Invoice Date *')}</label>
            <input type="date" value={form.invoice_date} onChange={e => set('invoice_date', e.target.value)} className={cls} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.dueDate', 'Due Date')}</label>
            <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} className={cls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.amountExclVat', 'Amount (excl. VAT) *')}</label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} className={cls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.vatAmount', 'VAT Amount')}</label>
            <input type="number" min="0" step="0.01" value={form.vat_amount} onChange={e => set('vat_amount', e.target.value)} className={cls} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.notes', 'Notes')}</label>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} className={cls + ' resize-none'} />
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={disabled}
            className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('jabco.adding', 'Adding…') : t('jabco.addInvoiceBtn', 'Add Invoice')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Pay Vendor Invoice Modal ──────────────────────────────────────────────────

function PayVendorInvoiceModal({ project, inv, onClose }: { project: Project; inv: VendorInvoice; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [form, setForm] = useState({ paid_date: new Date().toISOString().slice(0, 10), payment_reference: '' })

  const { mutate, isPending } = useMutation({
    mutationFn: () => jabcoApi.payVendorInvoice(project.id, inv.id, {
      paid_date: form.paid_date,
      payment_reference: form.payment_reference || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-vendor-invoices', project.id] }); onClose() },
  })

  return (
    <Modal title={t('jabco.payInvoiceTitle', 'Pay Invoice — {{vendor}}', { vendor: inv.vendor_name })} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{t('common.amount', 'Amount:')} <span className="text-slate-200 font-medium">{fmtMoney(inv.amount, project.contract_currency)}</span></p>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.paidDate', 'Paid Date *')}</label>
          <input type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} className={cls} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{t('common.paymentReference', 'Payment Reference')}</label>
          <input value={form.payment_reference} onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))} className={cls} placeholder={t('jabco.payRef', 'Chq / EFT ref')} />
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={() => mutate()} disabled={!form.paid_date || isPending}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {isPending ? t('common.saving', 'Saving…') : t('jabco.recordPayment', 'Record Payment')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Project List ──────────────────────────────────────────────────────────────

function ProjectList({
  selected,
  onSelect,
  onDeleted,
}: {
  selected: Project | null
  onSelect: (p: Project) => void
  onDeleted: (id: string) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<ProjectStatus | 'ALL'>('ALL')
  const [showCreate, setShowCreate] = useState(false)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-projects', filter],
    queryFn: () => jabcoApi.getProjects(filter === 'ALL' ? {} : { status: filter }),
  })

  const projects = data?.projects ?? []

  // Map from status key to translated label
  const statusLabel = (s: ProjectStatus | 'ALL'): string => {
    if (s === 'ALL') return t('jabco.statusAll', 'All')
    return t(`jabco.statuses.${s}`, STATUS_LABELS_FALLBACK[s])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs + add button */}
      <div className="px-3 py-2 flex items-center gap-1 flex-wrap border-b border-slate-700">
        <div className="flex gap-1 flex-wrap flex-1">
          {(['ALL', 'TENDER', 'AWARDED', 'ACTIVE', 'PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY', 'CLOSED', 'CANCELLED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-orange-700 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-2 py-0.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded transition-colors shrink-0"
        >
          {t('jabco.newBtn', '+ New')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-4 text-center text-slate-500 text-sm">{t('common.loading', 'Loading…')}</div>
        )}
        {!isLoading && projects.length === 0 && (
          <div className="p-4 text-center text-slate-500 text-sm">{t('jabco.noProjects', 'No projects found')}</div>
        )}
        {projects.map(p => (
          <div
            key={p.id}
            className={`flex items-stretch border-b border-slate-700/60 transition-colors ${
              selected?.id === p.id ? 'bg-slate-700' : 'hover:bg-slate-750'
            }`}
          >
            <button
              onClick={() => onSelect(p)}
              className="flex-1 text-left px-3 py-3 min-w-0"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-mono text-slate-400">{p.project_code}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[p.status]}`}>
                  {t(`jabco.statuses.${p.status}`, STATUS_LABELS_FALLBACK[p.status])}
                </span>
              </div>
              <div className="text-sm font-medium text-slate-100 truncate">{p.name}</div>
              <div className="text-xs text-slate-400 mt-0.5 truncate">{p.client_name}</div>
              <div className="text-xs text-slate-500 mt-0.5">{fmtMoney(p.contract_value, p.contract_currency)}</div>
            </button>
            <button
              onClick={e => { e.stopPropagation(); setDeletingProject(p) }}
              className="px-3 text-slate-700 hover:text-red-400 transition-colors shrink-0"
              title={t('common.delete', 'Delete project')}
            >&#x1F5D1;</button>
          </div>
        ))}
      </div>

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}

      {deletingProject && (
        <ConfirmDeleteModal
          label={deletingProject.name}
          onConfirm={() => jabcoApi.deleteProject(deletingProject.id).then(() => {
            void qc.invalidateQueries({ queryKey: ['jabco-projects'] })
            onDeleted(deletingProject.id)
          })}
          onClose={() => setDeletingProject(null)}
        />
      )}
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ project: initialProject }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editCrm, setEditCrm] = useState(false)
  const [editStatus, setEditStatus] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState(initialProject.client_company_id ?? '')
  const [selectedStatus, setSelectedStatus] = useState<ProjectStatus>(initialProject.status)

  // Keep a live copy so changes from patch are reflected immediately
  const { data: liveProject } = useQuery({
    queryKey: ['jabco-project', initialProject.id],
    queryFn: () => jabcoApi.getProject(initialProject.id),
    initialData: initialProject,
    staleTime: 30_000,
  })
  const project = liveProject ?? initialProject

  const { data: crmCompanies } = useQuery({
    queryKey: ['crm-companies-picker'],
    queryFn: () => crmApi.getCompanies({ limit: 200 }),
    enabled: editCrm,
  })

  const { mutate: patch, isPending } = useMutation({
    mutationFn: (body: Parameters<typeof jabcoApi.patchProject>[1]) =>
      jabcoApi.patchProject(project.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-project', project.id] })
      qc.invalidateQueries({ queryKey: ['jabco-projects'] })
      setEditCrm(false)
      setEditStatus(false)
    },
  })

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{t('jabco.contractDetails', 'Contract Details')}</h3>
        <Row label={t('jabco.projectCode', 'Project Code')} value={<span className="font-mono">{project.project_code}</span>} />
        <Row label={t('jabco.client', 'Client')} value={project.client_name} />
        <Row label={t('jabco.crmRecord', 'CRM Record')} value={
          editCrm ? (
            <div className="flex gap-2 items-center">
              <select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-100 focus:outline-none focus:border-orange-500">
                <option value="">{t('jabco.noCrmClient', '— None —')}</option>
                {crmCompanies?.companies.map(co => (
                  <option key={co.id} value={co.id}>{co.name}</option>
                ))}
              </select>
              <button onClick={() => patch({ client_company_id: selectedCompany || null })}
                disabled={isPending}
                className="text-xs px-2 py-0.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded transition-colors">
                {t('common.save', 'Save')}
              </button>
              <button onClick={() => setEditCrm(false)} className="text-xs text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <span className={project.client_company_name ? 'text-orange-400' : 'text-slate-500'}>
                {project.client_company_name ?? t('jabco.notLinked', 'Not linked')}
              </span>
              <button onClick={() => setEditCrm(true)} className="text-xs text-slate-500 hover:text-slate-300 underline">
                {project.client_company_name ? t('jabco.change', 'Change') : t('jabco.link', 'Link')}
              </button>
            </div>
          )
        } />
        <Row label={t('jabco.clientType', 'Client Type')} value={project.client_type} />
        <Row label={t('jabco.contractValue', 'Contract Value')} value={fmtMoney(project.contract_value, project.contract_currency)} />
        <Row label="VAT" value={project.vat_inclusive
          ? t('jabco.vatInclusiveFmt', 'Inclusive ({{pct}}%)', { pct: project.vat_pct })
          : t('jabco.vatExclusiveFmt', 'Exclusive ({{pct}}%)', { pct: project.vat_pct })} />
        <Row label={t('common.status', 'Status')} value={
          editStatus ? (
            <div className="flex gap-2 items-center">
              <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value as ProjectStatus)}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-100 focus:outline-none focus:border-orange-500">
                {(Object.keys(STATUS_LABELS_FALLBACK) as ProjectStatus[]).map(s => (
                  <option key={s} value={s}>{t(`jabco.statuses.${s}`, STATUS_LABELS_FALLBACK[s])}</option>
                ))}
              </select>
              <button onClick={() => patch({ status: selectedStatus })}
                disabled={isPending}
                className="text-xs px-2 py-0.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white rounded transition-colors">
                {t('common.save', 'Save')}
              </button>
              <button onClick={() => setEditStatus(false)} className="text-xs text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[project.status]}`}>
                {t(`jabco.statuses.${project.status}`, STATUS_LABELS_FALLBACK[project.status])}
              </span>
              <button onClick={() => setEditStatus(true)} className="text-xs text-slate-500 hover:text-slate-300 underline">
                {t('jabco.change', 'Change')}
              </button>
            </div>
          )
        } />
      </div>
      <div className="bg-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{t('jabco.timeline', 'Timeline')}</h3>
        <Row label={t('common.startDate', 'Start Date')} value={fmtDate(project.start_date)} />
        <Row label={t('jabco.expectedEnd', 'Expected End')} value={fmtDate(project.expected_end_date)} />
        <Row label={t('jabco.actualEnd', 'Actual End')} value={fmtDate(project.actual_end_date)} />
      </div>
      {project.site_address && (
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{t('jabco.siteAddress', 'Site Address')}</h3>
          <p className="text-xs text-slate-300 whitespace-pre-line">{project.site_address}</p>
        </div>
      )}
    </div>
  )
}

// ── BOQ Tab ───────────────────────────────────────────────────────────────────

function BoqTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const [showAdd, setShowAdd] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['jabco-boq', project.id],
    queryFn: () => jabcoApi.getBoq(project.id),
  })

  const items = data ?? []
  const sections = items.reduce<Record<string, BoqItem[]>>((acc, item) => {
    ;(acc[item.section] ??= []).push(item)
    return acc
  }, {})
  const total = items.reduce((sum, i) => sum + Number(i.amount_budgeted), 0)
  const showMargin = project.status === 'TENDER' || project.status === 'AWARDED'

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.boqAddItem', '+ Add Item')}
        </button>
      </div>
      {items.length === 0 && <div className="text-center text-slate-500 text-sm py-4">{t('jabco.boqNoItems', 'No BOQ items')}</div>}
      {Object.entries(sections).map(([section, sItems]) => (
        <div key={section} className="bg-slate-800 rounded-lg overflow-x-auto">
          <div className="px-4 py-2 bg-slate-700/60 text-xs font-semibold text-slate-300 uppercase tracking-wide">
            {section}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="px-4 py-2 text-left font-medium">{t('jabco.boqColDesc', 'Description')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColUnit', 'Unit')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColQty', 'Qty')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColRate', 'Rate')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColTotal', 'Total')}</th>
                {showMargin && <>
                  <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColCostRate', 'Cost Rate')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColMarkup', 'Markup %')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('jabco.boqColBidRate', 'Bid Rate')}</th>
                  <th className="px-3 py-2 text-left font-medium">{t('jabco.boqColWpTag', 'Work Package')}</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {sItems.map(item => {
                const boqItem = item as BoqItem & {
                  internal_cost_rate?: string | null
                  markup_percent?: string | null
                  final_bid_rate?: string | null
                  work_package_tag?: string | null
                }
                return (
                  <tr key={item.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                    <td className="px-4 py-2 text-slate-200">
                      {item.item_number && <span className="text-slate-500 mr-1">{item.item_number}</span>}
                      {item.description}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{item.unit}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{fmt.format(Number(item.quantity_budgeted))}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{fmt.format(Number(item.unit_rate))}</td>
                    <td className="px-3 py-2 text-right text-slate-100 font-medium">{fmt.format(Number(item.amount_budgeted))}</td>
                    {showMargin && <>
                      <td className="px-3 py-2 text-right text-slate-400">{boqItem.internal_cost_rate != null ? fmt.format(Number(boqItem.internal_cost_rate)) : '—'}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{boqItem.markup_percent != null ? `${fmt.format(Number(boqItem.markup_percent))}%` : '—'}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{boqItem.final_bid_rate != null ? fmt.format(Number(boqItem.final_bid_rate)) : '—'}</td>
                      <td className="px-3 py-2 text-left text-slate-400">{boqItem.work_package_tag ?? '—'}</td>
                    </>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      {items.length > 0 && (
        <div className="flex justify-end px-2">
          <div className="bg-slate-800 rounded-lg px-6 py-3 text-sm font-semibold text-slate-100">
            {t('common.total', 'Total')}: {fmtMoney(total, project.contract_currency)}
          </div>
        </div>
      )}
      {showAdd && <AddBoqItemModal project={project} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

// ── Variation Orders + Progress Claims Tab ───────────────────────────────────

function VOTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAddVO, setShowAddVO] = useState(false)
  const [showAddClaim, setShowAddClaim] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-project-detail', project.id],
    queryFn: () => jabcoApi.getVariationOrders(project.id),
  })

  const { mutate: actVO, isPending: acting, variables: actingVars } = useMutation({
    mutationFn: ({ voId, action }: { voId: string; action: 'APPROVED' | 'REJECTED' | 'WITHDRAWN' }) =>
      jabcoApi.approveVO(project.id, voId, action, action === 'APPROVED' ? new Date().toISOString().slice(0, 10) : undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-project-detail', project.id] }) },
  })

  const vos    = data?.variation_orders ?? []
  const claims = data?.progress_claims  ?? []

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-6">
      {/* Variation Orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('jabco.variationOrders', 'Variation Orders')}</h3>
          <button onClick={() => setShowAddVO(true)}
            className="px-2 py-1 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded transition-colors">
            {t('jabco.addVO', '+ Add VO')}
          </button>
        </div>
        {vos.length === 0 && <p className="text-slate-500 text-xs py-2">{t('jabco.noVOs', 'No variation orders')}</p>}
        <div className="space-y-2">
          {vos.map((vo: VariationOrder) => (
            <div key={vo.id} className="bg-slate-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-400">{vo.vo_number}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${VO_STYLES[vo.status] ?? ''}`}>
                      {vo.status}
                    </span>
                  </div>
                  <div className="text-sm text-slate-200">{vo.description}</div>
                  <div className="text-sm font-semibold text-slate-100 mt-1">
                    {Number(vo.amount) < 0 ? '−' : '+'}{fmtMoney(Math.abs(Number(vo.amount)), vo.currency)}
                  </div>
                  {vo.submitted_date && (
                    <div className="text-xs text-slate-500 mt-1">{t('jabco.submittedDate', 'Submitted {{date}}', { date: fmtDate(vo.submitted_date) })}</div>
                  )}
                </div>
                {vo.status === 'PENDING' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => actVO({ voId: vo.id, action: 'APPROVED' })}
                      disabled={acting && actingVars?.voId === vo.id}
                      className="px-2 py-1 bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
                    >
                      {t('common.approve', 'Approve')}
                    </button>
                    <button
                      onClick={() => actVO({ voId: vo.id, action: 'REJECTED' })}
                      disabled={acting && actingVars?.voId === vo.id}
                      className="px-2 py-1 bg-red-900 hover:bg-red-800 disabled:opacity-50 text-white text-xs rounded transition-colors"
                    >
                      {t('common.reject', 'Reject')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Claims */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('jabco.progressClaims', 'Progress Claims')}</h3>
          <button onClick={() => setShowAddClaim(true)}
            className="px-2 py-1 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded transition-colors">
            {t('jabco.submitClaim', '+ Submit Claim')}
          </button>
        </div>
        {claims.length === 0 && <p className="text-slate-500 text-xs py-2">{t('jabco.noClaims', 'No progress claims')}</p>}
        <div className="space-y-2">
          {claims.map((c: ProgressClaim) => (
            <div key={c.id} className="bg-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-slate-200">{t('jabco.claimLabel', 'Claim #{{number}}', { number: c.claim_number })}</span>
                <span className="text-xs text-slate-400 ml-3">{fmtDate(c.period_from)} → {fmtDate(c.period_to)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-100">{fmtMoney(c.amount_claimed, project.contract_currency)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.status === 'CERTIFIED' ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'}`}>
                  {c.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAddVO   && <AddVOModal       project={project} onClose={() => setShowAddVO(false)} />}
      {showAddClaim && <SubmitClaimModal project={project} onClose={() => setShowAddClaim(false)} />}
    </div>
  )
}

// ── Payment Certificates Tab ──────────────────────────────────────────────────

function PaymentCertsTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const [showIssue, setShowIssue] = useState(false)
  const [paying, setPaying] = useState<PaymentCertificate | null>(null)

  const { data: certData, isLoading: certsLoading } = useQuery({
    queryKey: ['jabco-payment-certs', project.id],
    queryFn: () => jabcoApi.getPaymentCerts(project.id),
  })

  // Fetch claims to populate the cert issuance modal
  const { data: detailData } = useQuery({
    queryKey: ['jabco-project-detail', project.id],
    queryFn: () => jabcoApi.getVariationOrders(project.id),
  })

  const certs  = certData?.payment_certificates ?? []
  const claims = (detailData?.progress_claims ?? []) as ProgressClaim[]

  if (certsLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowIssue(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.issueCert', '+ Issue Certificate')}
        </button>
      </div>
      {certs.length === 0 && <div className="text-center text-slate-500 text-sm py-4">{t('jabco.noCerts', 'No payment certificates')}</div>}
      {certs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="px-3 py-2 text-left font-medium">{t('jabco.certCol', 'Cert #')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.certifiedCol', 'Certified')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('jabco.grossCol', 'Gross')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('jabco.issuedCol', 'Issued')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('jabco.dueCol', 'Due')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('common.status', 'Status')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {certs.map((cert: PaymentCertificate) => (
                <tr key={cert.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  <td className="px-3 py-2 font-mono text-slate-300">{cert.certificate_number}</td>
                  <td className="px-3 py-2 text-right text-slate-100 font-medium">{fmtMoney(cert.amount_certified, project.contract_currency)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{fmtMoney((cert as PaymentCertificate & { gross_certified?: string }).gross_certified ?? cert.amount_certified, project.contract_currency)}</td>
                  <td className="px-3 py-2 text-center text-slate-400">{fmtDate(cert.issued_date)}</td>
                  <td className="px-3 py-2 text-center text-slate-400">{fmtDate(cert.due_date)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CERT_STYLES[cert.status] ?? 'text-slate-400'}`}>
                      {cert.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {cert.status !== 'PAID' && (
                      <button onClick={() => setPaying(cert)}
                        className="px-2 py-0.5 bg-green-900 hover:bg-green-800 text-green-300 text-[10px] rounded transition-colors">
                        {t('common.markPaid', 'Mark Paid')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showIssue && <IssueCertModal project={project} claims={claims} onClose={() => setShowIssue(false)} />}
      {paying && <MarkCertPaidModal project={project} cert={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

// ── Vendor Invoices Tab ───────────────────────────────────────────────────────

function VendorInvoicesTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [paying, setPaying] = useState<VendorInvoice | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-vendor-invoices', project.id],
    queryFn: () => jabcoApi.getVendorInvoices(project.id),
  })

  const { mutate: approveInv, isPending: approving, variables: approvingId } = useMutation({
    mutationFn: (id: string) => jabcoApi.approveVendorInvoice(project.id, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-vendor-invoices', project.id] }) },
  })

  const invoices = data?.vendor_invoices ?? []

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.addVendorInvoice', '+ Add Invoice')}
        </button>
      </div>
      {invoices.length === 0 && <div className="text-center text-slate-500 text-sm py-4">{t('jabco.noInvoices', 'No vendor invoices')}</div>}
      <div className="space-y-2">
        {invoices.map((inv: VendorInvoice) => (
          <div key={inv.id} className="bg-slate-800 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-100">{inv.vendor_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{inv.vendor_type}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${INV_STYLES[inv.status] ?? 'text-slate-400'}`}>
                    {inv.status}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-slate-400">
                  {inv.invoice_ref && <span>{t('jabco.ref', 'Ref:')} {inv.invoice_ref}</span>}
                  <span>{t('jabco.dateLabel', 'Date:')} {fmtDate(inv.invoice_date)}</span>
                  {inv.due_date && <span>{t('jabco.dueLabel', 'Due:')} {fmtDate(inv.due_date)}</span>}
                </div>
                <div className="text-sm font-semibold text-slate-100 mt-1">
                  {fmtMoney(inv.amount, project.contract_currency)}
                  {Number(inv.vat_amount) > 0 && (
                    <span className="text-xs text-slate-400 font-normal ml-2">+ VAT {fmtMoney(inv.vat_amount, project.contract_currency)}</span>
                  )}
                </div>
                {inv.notes && <p className="text-xs text-slate-500 mt-1">{inv.notes}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                {inv.status === 'RECEIVED' && (
                  <button
                    onClick={() => approveInv(inv.id)}
                    disabled={approving && approvingId === inv.id}
                    className="px-2 py-1 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 text-blue-300 text-xs rounded transition-colors"
                  >
                    {t('common.approve', 'Approve')}
                  </button>
                )}
                {inv.status === 'APPROVED' && (
                  <button
                    onClick={() => setPaying(inv)}
                    className="px-2 py-1 bg-green-900 hover:bg-green-800 text-green-300 text-xs rounded transition-colors"
                  >
                    {t('jabco.payInvoice', 'Pay')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {showAdd && <AddVendorInvoiceModal project={project} onClose={() => setShowAdd(false)} />}
      {paying   && <PayVendorInvoiceModal project={project} inv={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

// ── Site Diary Tab ────────────────────────────────────────────────────────────

function SiteDiaryTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    weather: '',
    workers_on_site: '',
    activities_completed: '',
    materials_received: '',
    equipment_on_site: '',
    issues_noted: '',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-diary', project.id],
    queryFn: () => jabcoApi.getSiteDiary(project.id),
  })

  const { mutate: addEntry, isPending: saving } = useMutation({
    mutationFn: () => jabcoApi.createSiteDiaryEntry(project.id, {
      entry_date: form.entry_date,
      weather: form.weather || undefined,
      workers_on_site: form.workers_on_site ? Number(form.workers_on_site) : undefined,
      activities_completed: form.activities_completed || undefined,
      materials_received: form.materials_received || undefined,
      equipment_on_site: form.equipment_on_site || undefined,
      issues_noted: form.issues_noted || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-diary', project.id] })
      setShowForm(false)
      setForm({ entry_date: new Date().toISOString().slice(0, 10), weather: '', workers_on_site: '', activities_completed: '', materials_received: '', equipment_on_site: '', issues_noted: '' })
    },
  })

  const entries = data?.entries ?? []

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(s => !s)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors"
        >
          {showForm ? t('common.cancel', 'Cancel') : t('jabco.newEntry', '+ New Entry')}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('common.date', 'Date *')}</label>
              <input
                type="date"
                value={form.entry_date}
                onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                className={cls}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.weather', 'Weather')}</label>
              <input
                value={form.weather}
                onChange={e => setForm(f => ({ ...f, weather: e.target.value }))}
                placeholder={t('jabco.weatherPlaceholder', 'e.g. Sunny, light winds')}
                className={cls}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.workers', 'Workers on Site')}</label>
              <input
                type="number"
                min="0"
                value={form.workers_on_site}
                onChange={e => setForm(f => ({ ...f, workers_on_site: e.target.value }))}
                className={cls}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.equipment', 'Equipment on Site')}</label>
              <input
                value={form.equipment_on_site}
                onChange={e => setForm(f => ({ ...f, equipment_on_site: e.target.value }))}
                placeholder={t('jabco.equipmentPlaceholder', 'e.g. Excavator, Dump truck')}
                className={cls}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.activities', 'Activities Completed')}</label>
            <textarea rows={2} value={form.activities_completed}
              onChange={e => setForm(f => ({ ...f, activities_completed: e.target.value }))}
              className={cls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.materials', 'Materials Received')}</label>
            <textarea rows={2} value={form.materials_received}
              onChange={e => setForm(f => ({ ...f, materials_received: e.target.value }))}
              className={cls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('jabco.issues', 'Issues / Instructions')}</label>
            <textarea rows={2} value={form.issues_noted}
              onChange={e => setForm(f => ({ ...f, issues_noted: e.target.value }))}
              className={cls + ' resize-none'} />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => addEntry()}
              disabled={saving || !form.entry_date}
              className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {saving ? t('common.saving', 'Saving…') : t('jabco.saveEntry', 'Save Entry')}
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>}
      {!isLoading && entries.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noDiaryEntries', 'No diary entries yet')}</div>
      )}

      {entries.map((entry: SiteDiaryEntry) => (
        <div key={entry.id} className="bg-slate-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-100">{fmtDate(entry.entry_date)}</span>
            <div className="flex gap-4 text-xs text-slate-400">
              {entry.weather && <span>☁ {entry.weather}</span>}
              {entry.workers_on_site != null && <span>👷 {t('jabco.workersCount', '{{count}} workers', { count: entry.workers_on_site })}</span>}
            </div>
          </div>
          <div className="space-y-2 text-xs text-slate-300">
            {entry.activities_completed && (
              <div><span className="text-slate-500 font-medium">{t('jabco.activitiesLabel', 'Activities: ')}</span>{entry.activities_completed}</div>
            )}
            {entry.materials_received && (
              <div><span className="text-slate-500 font-medium">{t('jabco.materialsLabel', 'Materials: ')}</span>{entry.materials_received}</div>
            )}
            {entry.equipment_on_site && (
              <div><span className="text-slate-500 font-medium">{t('jabco.equipmentLabel', 'Equipment: ')}</span>{entry.equipment_on_site}</div>
            )}
            {entry.instructions_received && (
              <div><span className="text-slate-500 font-medium">{t('jabco.instructionsLabel', 'Instructions: ')}</span>{entry.instructions_received}</div>
            )}
            {entry.issues_noted && (
              <div><span className="text-red-400 font-medium">{t('jabco.issuesLabel', 'Issues: ')}</span>{entry.issues_noted}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────

const TASK_STATUS_CLS: Record<ProjectTask['status'], string> = {
  OPEN:        'text-slate-400',
  IN_PROGRESS: 'text-yellow-400',
  DONE:        'text-green-400',
}

const TASK_TYPE_ORDER: ProjectTask['task_type'][] = ['MOBILIZATION', 'POST_MORTEM', 'GENERAL']

function TasksTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', task_type: 'GENERAL' as ProjectTask['task_type'], due_date: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-tasks', project.id],
    queryFn: () => jabcoApi.getTasks(project.id),
  })

  const { mutate: addTask, isPending: adding } = useMutation({
    mutationFn: () => jabcoApi.createTask(project.id, {
      title: form.title,
      task_type: form.task_type,
      due_date: form.due_date || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-tasks', project.id] })
      setShowForm(false)
      setForm({ title: '', task_type: 'GENERAL', due_date: '' })
    },
  })

  const { mutate: patchTask } = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: ProjectTask['status'] }) =>
      jabcoApi.patchTask(project.id, taskId, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-tasks', project.id] }) },
  })

  const tasks = data?.tasks ?? []

  const grouped = TASK_TYPE_ORDER.reduce<Record<string, ProjectTask[]>>((acc, type) => {
    acc[type] = tasks.filter(task => task.task_type === type)
    return acc
  }, {} as Record<string, ProjectTask[]>)

  const nextStatus = (s: ProjectTask['status']): ProjectTask['status'] =>
    s === 'OPEN' ? 'IN_PROGRESS' : 'DONE'

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(s => !s)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors"
        >
          {showForm ? t('common.cancel', 'Cancel') : t('jabco.addTask', '+ Add Task')}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.taskTitle', 'Title *')}</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={cls} placeholder={t('jabco.taskTitlePlaceholder', 'e.g. Order rebar')} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.taskType', 'Type')}</label>
              <select value={form.task_type} onChange={e => setForm(f => ({ ...f, task_type: e.target.value as ProjectTask['task_type'] }))} className={cls}>
                <option value="MOBILIZATION">{t('jabco.taskTypeMobilization', 'Mobilization')}</option>
                <option value="POST_MORTEM">{t('jabco.taskTypePostMortem', 'Post Mortem')}</option>
                <option value="GENERAL">{t('jabco.taskTypeGeneral', 'General')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('common.dueDate', 'Due Date')}</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={cls} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => addTask()} disabled={!form.title || adding}
              className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {adding ? t('common.saving', 'Saving…') : t('jabco.addTask', 'Add Task')}
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 && !showForm && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noTasks', 'No tasks yet')}</div>
      )}

      {TASK_TYPE_ORDER.map(type => {
        const typeTasks = grouped[type]
        if (typeTasks.length === 0) return null
        const typeLabel = type === 'MOBILIZATION' ? t('jabco.taskTypeMobilization', 'Mobilization') : type === 'POST_MORTEM' ? t('jabco.taskTypePostMortem', 'Post Mortem') : t('jabco.taskTypeGeneral', 'General')
        return (
          <div key={type} className="bg-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-slate-700/60 text-xs font-semibold text-slate-300 uppercase tracking-wide">
              {typeLabel}
            </div>
            <div className="divide-y divide-slate-700/40">
              {typeTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-700/20">
                  <button
                    onClick={() => task.status !== 'DONE' && patchTask({ taskId: task.id, status: nextStatus(task.status) })}
                    className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                      task.status === 'DONE'
                        ? 'bg-green-700 border-green-600 text-white'
                        : task.status === 'IN_PROGRESS'
                          ? 'bg-yellow-900/50 border-yellow-600 hover:bg-yellow-700'
                          : 'border-slate-600 hover:border-orange-500'
                    }`}
                    title={task.status === 'DONE' ? t('jabco.taskDone', 'Done') : t('jabco.taskAdvance', 'Advance status')}
                  >
                    {task.status === 'DONE' && <span className="text-[10px] leading-none">✓</span>}
                    {task.status === 'IN_PROGRESS' && <span className="text-[10px] leading-none text-yellow-300">◑</span>}
                  </button>
                  <span className={`flex-1 text-xs ${TASK_STATUS_CLS[task.status]} ${task.status === 'DONE' ? 'line-through' : ''}`}>
                    {task.title}
                  </span>
                  {task.due_date && (
                    <span className="text-[10px] text-slate-500 shrink-0">{fmtDate(task.due_date)}</span>
                  )}
                  {task.status !== 'DONE' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${TASK_STATUS_CLS[task.status] === 'text-yellow-400' ? 'bg-yellow-900/30 border-yellow-700 text-yellow-400' : 'bg-slate-700/40 border-slate-600 text-slate-500'}`}>
                      {task.status === 'IN_PROGRESS' ? t('jabco.taskInProgress', 'In Progress') : t('jabco.taskOpen', 'Open')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Punch List Tab ────────────────────────────────────────────────────────────

const PUNCH_STATUS_CLS: Record<PunchListItem['status'], string> = {
  IDENTIFIED: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  RECTIFIED:  'bg-blue-900/50   text-blue-300   border border-blue-700',
  VERIFIED:   'bg-green-900/50  text-green-300  border border-green-700',
}

function PunchListTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ description: '', location: '', trade: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-punch-list', project.id],
    queryFn: () => jabcoApi.getPunchList(project.id),
  })

  const { mutate: addItem, isPending: adding } = useMutation({
    mutationFn: () => jabcoApi.createPunchItem(project.id, {
      description: form.description,
      location: form.location || undefined,
      trade: form.trade || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-punch-list', project.id] })
      setShowAdd(false)
      setForm({ description: '', location: '', trade: '' })
    },
  })

  const { mutate: patchItem } = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: 'RECTIFIED' | 'VERIFIED' }) =>
      jabcoApi.patchPunchItem(project.id, itemId, {
        status,
        ...(status === 'RECTIFIED' ? { rectified_date: new Date().toISOString().slice(0, 10) } : { verified_date: new Date().toISOString().slice(0, 10) }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jabco-punch-list', project.id] }) },
  })

  const items = data?.items ?? []
  const identified = items.filter(item => item.status === 'IDENTIFIED').length
  const rectified  = items.filter(item => item.status === 'RECTIFIED').length
  const verified   = items.filter(item => item.status === 'VERIFIED').length

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {items.length > 0 && (
          <div className="flex gap-3 text-xs">
            <span className="text-yellow-400">{identified} {t('jabco.punchIdentified', 'open')}</span>
            <span className="text-blue-400">{rectified} {t('jabco.punchRectified', 'rectified')}</span>
            <span className="text-green-400">{verified} {t('jabco.punchVerified', 'verified')}</span>
          </div>
        )}
        <button onClick={() => setShowAdd(true)}
          className="ml-auto px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.punchAddItem', '+ Add Item')}
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noPunchItems', 'No punch list items')}</div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700 bg-slate-800">
                <th className="px-4 py-2 text-left font-medium">{t('common.description', 'Description')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('jabco.punchLocation', 'Location')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('jabco.punchTrade', 'Trade')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('common.status', 'Status')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  <td className="px-4 py-2 text-slate-200">{item.description}</td>
                  <td className="px-3 py-2 text-slate-400">{item.location ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400">{item.trade ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PUNCH_STATUS_CLS[item.status]}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {item.status === 'IDENTIFIED' && (
                      <button onClick={() => patchItem({ itemId: item.id, status: 'RECTIFIED' })}
                        className="px-2 py-0.5 bg-blue-900 hover:bg-blue-800 text-blue-300 text-[10px] rounded transition-colors">
                        {t('jabco.punchRectify', 'Rectify')}
                      </button>
                    )}
                    {item.status === 'RECTIFIED' && (
                      <button onClick={() => patchItem({ itemId: item.id, status: 'VERIFIED' })}
                        className="px-2 py-0.5 bg-green-900 hover:bg-green-800 text-green-300 text-[10px] rounded transition-colors">
                        {t('jabco.punchVerify', 'Verify')}
                      </button>
                    )}
                    {item.status === 'VERIFIED' && (
                      <span className="text-green-400 text-[10px]">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={t('jabco.punchAddItem', 'Add Punch List Item')} onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('common.description', 'Description *')}</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={cls + ' resize-none'} placeholder={t('jabco.punchDescPlaceholder', 'e.g. Cracked render on east wall')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.punchLocation', 'Location')}</label>
                <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className={cls} placeholder={t('jabco.punchLocationPlaceholder', 'e.g. Ground floor, Room 3')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.punchTrade', 'Trade')}</label>
                <input value={form.trade} onChange={e => setForm(f => ({ ...f, trade: e.target.value }))} className={cls} placeholder={t('jabco.punchTradePlaceholder', 'e.g. Plastering')} />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => addItem()} disabled={!form.description || adding}
                className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                {adding ? t('jabco.adding', 'Adding…') : t('jabco.addItem', 'Add Item')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Incidents Tab ─────────────────────────────────────────────────────────────

const INCIDENT_SEVERITY_CLS: Record<SiteIncident['severity'], string> = {
  LOW:      'bg-slate-700/60  text-slate-400  border border-slate-600',
  MEDIUM:   'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  HIGH:     'bg-orange-900/50 text-orange-300 border border-orange-700',
  CRITICAL: 'bg-red-900/50    text-red-400    border border-red-700',
}

function IncidentsTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closeForm, setCloseForm] = useState({ corrective_action: '', closed_date: new Date().toISOString().slice(0, 10) })
  const [addForm, setAddForm] = useState({
    incident_date: new Date().toISOString().slice(0, 10),
    incident_type: 'NEAR_MISS' as SiteIncident['incident_type'],
    severity: 'LOW' as SiteIncident['severity'],
    description: '',
    corrective_action: '',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-incidents', project.id],
    queryFn: () => jabcoApi.getIncidents(project.id),
  })

  const { mutate: logIncident, isPending: logging } = useMutation({
    mutationFn: () => jabcoApi.createIncident(project.id, {
      incident_date: addForm.incident_date,
      incident_type: addForm.incident_type,
      severity: addForm.severity,
      description: addForm.description,
      corrective_action: addForm.corrective_action || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-incidents', project.id] })
      setShowAdd(false)
      setAddForm({ incident_date: new Date().toISOString().slice(0, 10), incident_type: 'NEAR_MISS', severity: 'LOW', description: '', corrective_action: '' })
    },
  })

  const { mutate: closeIncident, isPending: closing } = useMutation({
    mutationFn: (incidentId: string) => jabcoApi.closeIncident(project.id, incidentId, {
      status: 'CLOSED',
      closed_date: closeForm.closed_date || undefined,
      corrective_action: closeForm.corrective_action || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-incidents', project.id] })
      setClosingId(null)
      setCloseForm({ corrective_action: '', closed_date: new Date().toISOString().slice(0, 10) })
    },
  })

  const incidents = data?.incidents ?? []

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.logIncident', '+ Log Incident')}
        </button>
      </div>

      {incidents.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noIncidents', 'No incidents recorded')}</div>
      )}

      {incidents.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700 bg-slate-800">
                <th className="px-3 py-2 text-left font-medium">{t('common.date', 'Date')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('jabco.incidentType', 'Type')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('jabco.incidentSeverity', 'Severity')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('common.description', 'Description')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('common.status', 'Status')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map(inc => (
                <>
                  <tr key={inc.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDate(inc.incident_date)}</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{inc.incident_type.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${INCIDENT_SEVERITY_CLS[inc.severity]}`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-200">{inc.description}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${inc.status === 'CLOSED' ? 'bg-slate-700/60 text-slate-400 border border-slate-600' : 'bg-red-900/50 text-red-400 border border-red-700'}`}>
                        {inc.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {inc.status === 'OPEN' && (
                        <button onClick={() => setClosingId(closingId === inc.id ? null : inc.id)}
                          className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] rounded transition-colors">
                          {t('jabco.closeIncident', 'Close')}
                        </button>
                      )}
                    </td>
                  </tr>
                  {closingId === inc.id && (
                    <tr key={`${inc.id}-close`} className="bg-slate-700/30">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex gap-3 items-end">
                          <div className="flex-1">
                            <label className="block text-[10px] text-slate-400 mb-1">{t('jabco.correctiveAction', 'Corrective Action')}</label>
                            <textarea rows={2} value={closeForm.corrective_action}
                              onChange={e => setCloseForm(f => ({ ...f, corrective_action: e.target.value }))}
                              className={cls + ' resize-none text-[11px]'} />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-1">{t('jabco.closedDate', 'Closed Date')}</label>
                            <input type="date" value={closeForm.closed_date}
                              onChange={e => setCloseForm(f => ({ ...f, closed_date: e.target.value }))}
                              className={cls + ' text-[11px]'} />
                          </div>
                          <button onClick={() => closeIncident(inc.id)} disabled={closing}
                            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-xs rounded transition-colors shrink-0">
                            {closing ? t('common.saving', 'Saving…') : t('jabco.confirmClose', 'Confirm Close')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={t('jabco.logIncident', 'Log Incident')} onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.incidentDate', 'Date *')}</label>
                <input type="date" value={addForm.incident_date} onChange={e => setAddForm(f => ({ ...f, incident_date: e.target.value }))} className={cls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.incidentSeverity', 'Severity *')}</label>
                <select value={addForm.severity} onChange={e => setAddForm(f => ({ ...f, severity: e.target.value as SiteIncident['severity'] }))} className={cls}>
                  <option value="LOW">{t('jabco.severityLow', 'Low')}</option>
                  <option value="MEDIUM">{t('jabco.severityMedium', 'Medium')}</option>
                  <option value="HIGH">{t('jabco.severityHigh', 'High')}</option>
                  <option value="CRITICAL">{t('jabco.severityCritical', 'Critical')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.incidentType', 'Type *')}</label>
              <select value={addForm.incident_type} onChange={e => setAddForm(f => ({ ...f, incident_type: e.target.value as SiteIncident['incident_type'] }))} className={cls}>
                <option value="NEAR_MISS">{t('jabco.incidentNearMiss', 'Near Miss')}</option>
                <option value="MINOR_INJURY">{t('jabco.incidentMinorInjury', 'Minor Injury')}</option>
                <option value="MAJOR_INJURY">{t('jabco.incidentMajorInjury', 'Major Injury')}</option>
                <option value="PROPERTY_DAMAGE">{t('jabco.incidentPropertyDamage', 'Property Damage')}</option>
                <option value="ENVIRONMENTAL">{t('jabco.incidentEnvironmental', 'Environmental')}</option>
                <option value="OTHER">{t('jabco.incidentOther', 'Other')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('common.description', 'Description *')}</label>
              <textarea rows={3} value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} className={cls + ' resize-none'} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.correctiveAction', 'Corrective Action')}</label>
              <textarea rows={2} value={addForm.corrective_action} onChange={e => setAddForm(f => ({ ...f, corrective_action: e.target.value }))} className={cls + ' resize-none'} />
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => logIncident()} disabled={!addForm.description || !addForm.incident_date || logging}
                className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                {logging ? t('jabco.logging', 'Logging…') : t('jabco.logIncident', 'Log Incident')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Quality Tab ───────────────────────────────────────────────────────────────

const QUALITY_RESULT_CLS: Record<QualityInspection['checklist_result'], string> = {
  PASS:        'bg-green-900/50  text-green-300  border border-green-700',
  FAIL:        'bg-red-900/50    text-red-400    border border-red-700',
  CONDITIONAL: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
}

function QualityTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    inspection_date: new Date().toISOString().slice(0, 10),
    inspector_name: '',
    area_inspected: '',
    checklist_result: 'PASS' as QualityInspection['checklist_result'],
    defects_noted: '',
    follow_up_required: false,
    follow_up_date: '',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['jabco-quality', project.id],
    queryFn: () => jabcoApi.getQualityInspections(project.id),
  })

  const { mutate: addInspection, isPending: adding } = useMutation({
    mutationFn: () => jabcoApi.createQualityInspection(project.id, {
      inspection_date: form.inspection_date,
      inspector_name: form.inspector_name,
      area_inspected: form.area_inspected,
      checklist_result: form.checklist_result,
      defects_noted: form.defects_noted || undefined,
      follow_up_required: form.follow_up_required,
      follow_up_date: form.follow_up_date || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-quality', project.id] })
      setShowAdd(false)
      setForm({ inspection_date: new Date().toISOString().slice(0, 10), inspector_name: '', area_inspected: '', checklist_result: 'PASS', defects_noted: '', follow_up_required: false, follow_up_date: '' })
    },
  })

  const inspections = data?.inspections ?? []

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.addInspection', '+ Add Inspection')}
        </button>
      </div>

      {inspections.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noInspections', 'No quality inspections yet')}</div>
      )}

      {inspections.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700 bg-slate-800">
                <th className="px-3 py-2 text-left font-medium">{t('common.date', 'Date')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('jabco.qualityInspector', 'Inspector')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('jabco.qualityArea', 'Area')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('jabco.qualityResult', 'Result')}</th>
                <th className="px-3 py-2 text-center font-medium">{t('jabco.qualityFollowUp', 'Follow-up')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('jabco.qualityDefects', 'Defects / Notes')}</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map(qi => (
                <tr key={qi.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtDate(qi.inspection_date)}</td>
                  <td className="px-3 py-2 text-slate-300">{qi.inspector_name}</td>
                  <td className="px-3 py-2 text-slate-300">{qi.area_inspected}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${QUALITY_RESULT_CLS[qi.checklist_result]}`}>
                      {qi.checklist_result}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {qi.follow_up_required
                      ? <span className="text-yellow-400 text-[10px]">{qi.follow_up_date ? fmtDate(qi.follow_up_date) : t('jabco.followUpRequired', 'Required')}</span>
                      : <span className="text-slate-600 text-[10px]">—</span>
                    }
                  </td>
                  <td className="px-4 py-2 text-slate-400">{qi.defects_noted ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={t('jabco.addInspection', 'Add Quality Inspection')} onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.inspectionDate', 'Date *')}</label>
                <input type="date" value={form.inspection_date} onChange={e => setForm(f => ({ ...f, inspection_date: e.target.value }))} className={cls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.qualityResult', 'Result *')}</label>
                <select value={form.checklist_result} onChange={e => setForm(f => ({ ...f, checklist_result: e.target.value as QualityInspection['checklist_result'] }))} className={cls}>
                  <option value="PASS">{t('jabco.resultPass', 'Pass')}</option>
                  <option value="FAIL">{t('jabco.resultFail', 'Fail')}</option>
                  <option value="CONDITIONAL">{t('jabco.resultConditional', 'Conditional')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.qualityInspector', 'Inspector Name *')}</label>
              <input value={form.inspector_name} onChange={e => setForm(f => ({ ...f, inspector_name: e.target.value }))} className={cls} placeholder={t('jabco.inspectorPlaceholder', 'e.g. R. Johnson-Attin')} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.qualityArea', 'Area Inspected *')}</label>
              <input value={form.area_inspected} onChange={e => setForm(f => ({ ...f, area_inspected: e.target.value }))} className={cls} placeholder={t('jabco.areaPlaceholder', 'e.g. Foundation, Block A')} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.qualityDefects', 'Defects Noted')}</label>
              <textarea rows={2} value={form.defects_noted} onChange={e => setForm(f => ({ ...f, defects_noted: e.target.value }))} className={cls + ' resize-none'} />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="follow_up_req" checked={form.follow_up_required}
                onChange={e => setForm(f => ({ ...f, follow_up_required: e.target.checked }))} className="rounded" />
              <label htmlFor="follow_up_req" className="text-xs text-slate-300">{t('jabco.followUpRequired', 'Follow-up Required')}</label>
              {form.follow_up_required && (
                <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-orange-500" />
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => addInspection()} disabled={!form.inspection_date || !form.inspector_name || !form.area_inspected || adding}
                className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                {adding ? t('jabco.adding', 'Adding…') : t('jabco.addInspection', 'Add Inspection')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Bonds Tab (tender bonds, performance bonds — via Finance Insurance module) ─

const BOND_POLICY_TYPES: InsurancePolicyType[] = ['SURETY_BOND', 'PERFORMANCE_BOND', 'OTHER']

function BondsTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    policy_type: 'PERFORMANCE_BOND' as InsurancePolicyType,
    sub_type: '', policy_number: '', insurer_name: '', broker_name: '',
    coverage_amount: '', premium_amount: '', premium_frequency: 'ONE_OFF',
    start_date: '', expiry_date: '', notes: '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const bondsKey = ['finance', 'insurance', 'policies', 'project', project.id]
  const { data: bonds = [], isLoading } = useQuery({
    queryKey: bondsKey,
    queryFn: () => financeApi.getPolicies({ insured_asset_ref: project.id }),
  })

  const handleSave = async () => {
    setSaveError(null)
    setIsSaving(true)
    try {
      await financeApi.createPolicy({
        owner_entity_id: JABCO_ENTITY_ID,
        policy_type: form.policy_type,
        sub_type: form.sub_type || undefined,
        insured_asset_type: 'PROJECT',
        insured_asset_ref: project.id,
        policy_number: form.policy_number || `${project.project_code}-BOND-${Date.now()}`,
        insurer_name: form.insurer_name,
        broker_name: form.broker_name || undefined,
        coverage_amount: parseFloat(form.coverage_amount) || 1,
        coverage_amount_ttd: parseFloat(form.coverage_amount) || 1,
        currency: 'TTD',
        premium_amount: parseFloat(form.premium_amount) || 1,
        premium_amount_ttd: parseFloat(form.premium_amount) || 1,
        premium_frequency: form.premium_frequency as Parameters<typeof financeApi.createPolicy>[0]['premium_frequency'],
        start_date: form.start_date || new Date().toISOString().slice(0, 10),
        expiry_date: form.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        renewal_alert_days: 60,
        notes: form.notes || undefined,
      })
      await qc.invalidateQueries({ queryKey: bondsKey })
      setShowAdd(false)
      setForm({ policy_type: 'PERFORMANCE_BOND', sub_type: '', policy_number: '', insurer_name: '', broker_name: '', coverage_amount: '', premium_amount: '', premium_frequency: 'ONE_OFF', start_date: '', expiry_date: '', notes: '' })
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed — check all required fields.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return <div className="text-center text-slate-500 text-sm py-8">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg transition-colors">
          {t('jabco.addBond', '+ Add Bond / Policy')}
        </button>
      </div>

      {bonds.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">{t('jabco.noBonds', 'No bonds or policies linked to this project')}</div>
      )}

      {(bonds as InsurancePolicy[]).map(p => {
        const days = Math.ceil((new Date(p.expiry_date).getTime() - Date.now()) / 86_400_000)
        const expiring = days < 60
        return (
          <div key={p.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-100">{p.insurer_name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                {t(`insurance.policyTypes.${p.policy_type}`)}
                {p.sub_type && ` — ${p.sub_type}`}
              </span>
              {!p.is_active && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-500">Inactive</span>}
              {p.is_active && expiring && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700">{t('propertiesPanel.expiringSoon', 'Expiring soon')}</span>}
            </div>
            {p.policy_number && <p className="text-xs text-slate-400 mt-0.5 font-mono">{p.policy_number}</p>}
            <div className="grid grid-cols-2 gap-x-4 mt-1.5 text-xs text-slate-400">
              <span>{t('propertiesPanel.insurancePremium', 'Premium')} <span className="text-slate-200">{fmtMoney(p.premium_amount_ttd)} / {p.premium_frequency.toLowerCase()}</span></span>
              <span>{t('propertiesPanel.insuranceCoverage', 'Coverage')} <span className="text-slate-200">{fmtMoney(p.coverage_amount_ttd)}</span></span>
              <span>{t('propertiesPanel.insuranceFrom', 'From')} <span className="text-slate-200">{fmtDate(p.start_date)}</span></span>
              <span className={expiring && p.is_active ? 'text-red-400' : ''}>{t('propertiesPanel.insuranceExpires', 'Expires')} <span className="text-slate-200">{fmtDate(p.expiry_date)}</span></span>
            </div>
            {p.notes && <p className="text-xs text-slate-500 mt-1">{p.notes}</p>}
          </div>
        )
      })}

      {showAdd && (
        <Modal title={t('jabco.addBond', 'Add Bond / Policy')} onClose={() => setShowAdd(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondType', 'Type *')}</label>
                <select value={form.policy_type} onChange={set('policy_type')} className={cls}>
                  {BOND_POLICY_TYPES.map(tp => <option key={tp} value={tp}>{t(`insurance.policyTypes.${tp}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondSubType', 'Sub-type')}</label>
                <input value={form.sub_type} onChange={set('sub_type')} className={cls} placeholder={t('jabco.bondSubTypePlaceholder', 'e.g. Tender/Bid bond')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondIssuer', 'Issuer / Surety *')}</label>
                <input value={form.insurer_name} onChange={set('insurer_name')} className={cls} placeholder="Guardian General" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondNumber', 'Bond / Policy Number')}</label>
                <input value={form.policy_number} onChange={set('policy_number')} className={cls} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondBroker', 'Broker')}</label>
              <input value={form.broker_name} onChange={set('broker_name')} className={cls} placeholder={t('common.optional', 'Optional')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondCoverage', 'Bond Value (TTD)')}</label>
                <input type="number" min="0" step="0.01" value={form.coverage_amount} onChange={set('coverage_amount')} className={cls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondPremium', 'Premium (TTD)')}</label>
                <input type="number" min="0" step="0.01" value={form.premium_amount} onChange={set('premium_amount')} className={cls} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondFrequency', 'Frequency')}</label>
                <select value={form.premium_frequency} onChange={set('premium_frequency')} className={cls}>
                  {['ONE_OFF', 'ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondStartDate', 'Start Date')}</label>
                <input type="date" value={form.start_date} onChange={set('start_date')} className={cls} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('jabco.bondExpiryDate', 'Expiry Date')}</label>
                <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className={cls} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('common.notes', 'Notes')}</label>
              <textarea rows={2} value={form.notes} onChange={set('notes')} className={cls + ' resize-none'} />
            </div>
            {saveError && <p className="text-red-400 text-xs rounded bg-red-900/30 border border-red-700 px-3 py-2">{saveError}</p>}
            <div className="flex justify-end pt-2">
              <button onClick={() => void handleSave()} disabled={!form.insurer_name || isSaving}
                className="px-4 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
                {isSaving ? t('jabco.adding', 'Adding…') : t('jabco.addBond', 'Add Bond / Policy')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Closeout Tab ──────────────────────────────────────────────────────────────

function CloseoutTab({ project }: { project: Project }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [handoverUrl, setHandoverUrl] = useState(project.handover_document_url ?? '')
  const [editingUrl, setEditingUrl] = useState(false)

  const { data: punchData } = useQuery({
    queryKey: ['jabco-punch-list', project.id],
    queryFn: () => jabcoApi.getPunchList(project.id),
  })

  const { mutate: patchProject, isPending: patching } = useMutation({
    mutationFn: (body: Parameters<typeof jabcoApi.patchProject>[1]) =>
      jabcoApi.patchProject(project.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jabco-projects'] })
      qc.invalidateQueries({ queryKey: ['jabco-project', project.id] })
      setEditingUrl(false)
    },
  })

  const items = punchData?.items ?? []
  const openCount = items.filter(item => item.status === 'IDENTIFIED' || item.status === 'RECTIFIED').length
  const allVerified = items.length > 0 && openCount === 0
  const hasHandover = !!project.handover_document_url
  const canClose = allVerified && hasHandover
  const alreadyClosed = project.status === 'CLOSED' || project.status === 'CANCELLED'

  return (
    <div className="space-y-4">
      {/* Punch List Status */}
      <div className="bg-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{t('jabco.tabs.punchList', 'Punch List')}</h3>
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">{t('jabco.noPunchItems', 'No punch list items')}</p>
        ) : allVerified ? (
          <p className="text-xs text-green-400">✓ {t('jabco.allVerified', 'All items verified')}</p>
        ) : (
          <p className="text-xs text-yellow-400">
            {t('jabco.openPunchItems', '{{count}} item(s) still open (not yet verified)', { count: openCount })}
          </p>
        )}
      </div>

      {/* Handover Document */}
      <div className="bg-slate-800 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{t('jabco.handoverDoc', 'Handover Document')}</h3>
        {project.handover_document_url && !editingUrl ? (
          <div className="flex items-center gap-3">
            <a href={project.handover_document_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-orange-400 hover:text-orange-300 underline truncate flex-1">
              {project.handover_document_url}
            </a>
            <button onClick={() => { setHandoverUrl(project.handover_document_url ?? ''); setEditingUrl(true) }}
              className="text-xs text-slate-500 hover:text-slate-300 shrink-0 underline">
              {t('jabco.change', 'Change')}
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <input value={handoverUrl} onChange={e => setHandoverUrl(e.target.value)}
              className={cls + ' flex-1'}
              placeholder={t('jabco.handoverUrlPlaceholder', 'https://… or MinIO URL')} />
            <button
              onClick={() => patchProject({ handover_document_url: handoverUrl || null })}
              disabled={patching}
              className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white text-xs rounded transition-colors shrink-0">
              {patching ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
            {editingUrl && (
              <button onClick={() => setEditingUrl(false)} className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
                {t('common.cancel', 'Cancel')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Close Project */}
      {!alreadyClosed && (
        <div className="bg-slate-800 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{t('jabco.closeProject', 'Close Project')}</h3>
          {!canClose && (
            <p className="text-xs text-slate-500 mb-3">
              {!allVerified && !hasHandover
                ? t('jabco.closeBlockedBoth', 'All punch-list items must be verified and a handover document must be uploaded before closing.')
                : !allVerified
                  ? t('jabco.closeBlockedPunch', 'All punch-list items must be verified before closing.')
                  : t('jabco.closeBlockedHandover', 'A handover document must be uploaded before closing.')
              }
            </p>
          )}
          <button
            onClick={() => patchProject({ status: 'CLOSED' })}
            disabled={!canClose || patching}
            title={!canClose ? t('jabco.closeBlockedBoth', 'All punch-list items must be verified and a handover document must be uploaded before closing.') : undefined}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors">
            {patching ? t('jabco.closing', 'Closing…') : t('jabco.closeProjectBtn', 'Close Project')}
          </button>
        </div>
      )}

      {alreadyClosed && (
        <div className="bg-slate-800 rounded-lg p-4">
          <p className="text-xs text-slate-400">
            {t('jabco.projectAlreadyClosed', 'Project status: {{status}}', { status: project.status })}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'boq' | 'vos' | 'certs' | 'invoices' | 'diary' | 'tasks' | 'punch-list' | 'incidents' | 'quality' | 'bonds' | 'closeout'

function DetailPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<DetailTab>('overview')

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview',   label: t('jabco.tabs.overview', 'Overview') },
    { id: 'boq',        label: t('jabco.tabs.boq', 'BOQ') },
    { id: 'vos',        label: t('jabco.tabs.vos', 'Variations & Claims') },
    { id: 'certs',      label: t('jabco.tabs.certs', 'Payment Certs') },
    { id: 'invoices',   label: t('jabco.tabs.invoices', 'Vendor Invoices') },
    { id: 'diary',      label: t('jabco.tabs.diary', 'Site Diary') },
    { id: 'tasks',      label: t('jabco.tabs.tasks', 'Tasks') },
    { id: 'punch-list', label: t('jabco.tabs.punchList', 'Punch List') },
    { id: 'incidents',  label: t('jabco.tabs.incidents', 'Incidents') },
    { id: 'quality',    label: t('jabco.tabs.quality', 'Quality') },
    { id: 'bonds',      label: t('jabco.tabs.bonds', 'Bonds') },
    { id: 'closeout',   label: t('jabco.tabs.closeout', 'Closeout') },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">{project.project_code}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[project.status]}`}>
              {t(`jabco.statuses.${project.status}`, STATUS_LABELS_FALLBACK[project.status])}
            </span>
          </div>
          <div className="text-base font-semibold text-slate-100 mt-0.5 truncate">{project.name}</div>
          <div className="text-xs text-slate-400">{project.client_name}</div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none shrink-0">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-700 shrink-0 overflow-x-auto">
        {tabs.map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
              tab === tb.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview'   && <OverviewTab        project={project} />}
        {tab === 'boq'        && <BoqTab             project={project} />}
        {tab === 'vos'        && <VOTab              project={project} />}
        {tab === 'certs'      && <PaymentCertsTab    project={project} />}
        {tab === 'invoices'   && <VendorInvoicesTab  project={project} />}
        {tab === 'diary'      && <SiteDiaryTab       project={project} />}
        {tab === 'tasks'      && <TasksTab           project={project} />}
        {tab === 'punch-list' && <PunchListTab       project={project} />}
        {tab === 'incidents'  && <IncidentsTab       project={project} />}
        {tab === 'quality'    && <QualityTab         project={project} />}
        {tab === 'bonds'      && <BondsTab           project={project} />}
        {tab === 'closeout'   && <CloseoutTab        project={project} />}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Jabco() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Project | null>(null)

  return (
    <div className="flex h-full overflow-hidden bg-slate-900">
      {/* Sidebar */}
      <div className="w-72 shrink-0 border-r border-slate-700 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 shrink-0">
          <h1 className="text-sm font-semibold text-slate-100">{t('jabco.title', 'JABCO Projects')}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t('jabco.subtitle', 'Civil engineering & contracting')}</p>
        </div>
        <div className="flex-1 overflow-hidden">
          <ProjectList
            selected={selected}
            onSelect={setSelected}
            onDeleted={id => { if (selected?.id === id) setSelected(null) }}
          />
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <DetailPanel project={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-600 text-sm">
            {t('jabco.selectProject', 'Select a project to view details')}
          </div>
        )}
      </div>
    </div>
  )
}
