import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jabcoApi } from '../api/jabco'
import { crmApi } from '../api/crm'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import type {
  Project, BoqItem, VariationOrder, ProgressClaim, PaymentCertificate,
  VendorInvoice, SiteDiaryEntry, ProjectStatus,
} from '../types/jabco'

// ── Constants ─────────────────────────────────────────────────────────────────

// Robert's jag_core user ID — sole project manager for now
const ROBERT_USER_ID = '95ca3f77-60ba-4a0f-af70-2832b247b525'

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-orange-500 placeholder-slate-500'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMoney = (v: string | number, currency = 'TTD') =>
  `${currency} ${fmt.format(Number(v))}`
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_STYLES: Record<ProjectStatus, string> = {
  TENDER:               'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
  ACTIVE:               'bg-green-900/50  text-green-300  border border-green-700',
  PRACTICAL_COMPLETION: 'bg-blue-900/50   text-blue-300   border border-blue-700',
  DEFECTS_LIABILITY:    'bg-orange-900/50 text-orange-300 border border-orange-700',
  CLOSED:               'bg-slate-700/60  text-slate-400  border border-slate-600',
  CANCELLED:            'bg-red-900/50    text-red-400    border border-red-700',
}

// Module-level fallback labels (used as t() fallback values)
const STATUS_LABELS_FALLBACK: Record<ProjectStatus, string> = {
  TENDER:               'Tender',
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
          {(['ALL', 'TENDER', 'ACTIVE', 'PRACTICAL_COMPLETION', 'DEFECTS_LIABILITY', 'CLOSED', 'CANCELLED'] as const).map(s => (
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
        <div key={section} className="bg-slate-800 rounded-lg overflow-hidden">
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
              </tr>
            </thead>
            <tbody>
              {sItems.map(item => (
                <tr key={item.id} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  <td className="px-4 py-2 text-slate-200">
                    {item.item_number && <span className="text-slate-500 mr-1">{item.item_number}</span>}
                    {item.description}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">{item.unit}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{fmt.format(Number(item.quantity_budgeted))}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{fmt.format(Number(item.unit_rate))}</td>
                  <td className="px-3 py-2 text-right text-slate-100 font-medium">{fmt.format(Number(item.amount_budgeted))}</td>
                </tr>
              ))}
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

// ── Detail Panel ──────────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'boq' | 'vos' | 'certs' | 'invoices' | 'diary'

function DetailPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<DetailTab>('overview')

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview',  label: t('jabco.tabs.overview', 'Overview') },
    { id: 'boq',       label: t('jabco.tabs.boq', 'BOQ') },
    { id: 'vos',       label: t('jabco.tabs.vos', 'Variations & Claims') },
    { id: 'certs',     label: t('jabco.tabs.certs', 'Payment Certs') },
    { id: 'invoices',  label: t('jabco.tabs.invoices', 'Vendor Invoices') },
    { id: 'diary',     label: t('jabco.tabs.diary', 'Site Diary') },
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
        {tab === 'overview'  && <OverviewTab        project={project} />}
        {tab === 'boq'       && <BoqTab             project={project} />}
        {tab === 'vos'       && <VOTab              project={project} />}
        {tab === 'certs'     && <PaymentCertsTab    project={project} />}
        {tab === 'invoices'  && <VendorInvoicesTab  project={project} />}
        {tab === 'diary'     && <SiteDiaryTab       project={project} />}
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
