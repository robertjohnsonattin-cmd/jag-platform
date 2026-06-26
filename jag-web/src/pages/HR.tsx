import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { hrApiFor } from '../api/hr'
import { fmtTTD, fmtDate } from '../lib/entities'
import type {
  HrEmployee, HrDepartment, HrPosition,
  HrLeaveRequest, HrLeaveBalance, HrLeaveType,
  HrPayrollRun, HrPayrollEntry,
  HrPerformanceReview,
  HrTrainingType,
  HrDisciplinaryRecord,
  HrJobPosting, HrJobApplication,
  HrTimesheet,
  EmployeeStatus, DisciplinarySeverity, ApplicationStage,
} from '../types/hr'

// ── Entity list (all 7 JAG entities) ─────────────────────────────────────────
const HR_ENTITIES = [
  { id: '00000000-0000-0000-0001-000000000001', name: 'JAG Holdings' },
  { id: '00000000-0000-0000-0001-000000000002', name: 'JABCO' },
  { id: '00000000-0000-0000-0001-000000000003', name: 'JAG Properties' },
  { id: '00000000-0000-0000-0001-000000000004', name: 'JAG Entertainment' },
  { id: '00000000-0000-0000-0001-000000000005', name: 'JAG Finance' },
  { id: '00000000-0000-0000-0001-000000000006', name: 'DragonBridge' },
  { id: '00000000-0000-0000-0001-000000000007', name: 'NLCB' },
]

// ── Shared constants ──────────────────────────────────────────────────────────
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const cls = 'w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
const btnPrimary = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded'
const btnSecondary = 'px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm rounded'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-sm text-slate-100 text-right">{value ?? '—'}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">{children}</h4>
}

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  ACTIVE:     'bg-green-900/50 text-green-300 border-green-700',
  INACTIVE:   'bg-slate-700 text-slate-300 border-slate-500',
  TERMINATED: 'bg-red-900/50 text-red-400 border-red-700',
  ON_LEAVE:   'bg-yellow-900/50 text-yellow-300 border-yellow-700',
}

const SEVERITY_BADGE: Record<DisciplinarySeverity, string> = {
  VERBAL_WARNING:   'bg-blue-900/50 text-blue-300 border-blue-700',
  WRITTEN_WARNING:  'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  FINAL_WARNING:    'bg-orange-900/50 text-orange-300 border-orange-700',
  SUSPENSION:       'bg-red-900/50 text-red-400 border-red-700',
  DISMISSAL:        'bg-rose-900/50 text-rose-400 border-rose-700',
}

const STAGE_BADGE: Record<ApplicationStage, string> = {
  APPLIED:    'bg-slate-700 text-slate-300 border-slate-500',
  SCREENING:  'bg-blue-900/50 text-blue-300 border-blue-700',
  INTERVIEW:  'bg-purple-900/50 text-purple-300 border-purple-700',
  ASSESSMENT: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  OFFER:      'bg-green-900/50 text-green-300 border-green-700',
  HIRED:      'bg-emerald-900/50 text-emerald-300 border-emerald-700',
  REJECTED:   'bg-red-900/50 text-red-400 border-red-700',
  WITHDRAWN:  'bg-slate-700 text-slate-400 border-slate-600',
}

function Badge({ text, cls: c }: { text: string; cls: string }) {
  return <span className={`px-2 py-0.5 rounded text-xs border ${c}`}>{text}</span>
}

function fmt(v: string | null | undefined) { return v ? fmtTTD(v) : '—' }
function fmtN(v: number | string | null | undefined) { return v != null ? parseFloat(String(v)).toFixed(2) : '—' }

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = ['employees','payroll','leave','performance','recruitment','training','disciplinary','attendance'] as const
type Tab = typeof TABS[number]

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function EmployeesTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [selected, setSelected] = useState<HrEmployee | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showTerminate, setShowTerminate] = useState(false)
  const [detailTab, setDetailTab] = useState<'info'|'contacts'|'history'>('info')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ first_name:'', last_name:'', employee_number:'', employment_type:'FULL_TIME', hire_date:'', base_salary_ttd:'', pay_frequency:'MONTHLY', position_id:'', department_id:'' })
  const [termForm, setTermForm] = useState({ termination_date:'', termination_reason:'' })

  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees', entityId, search, statusFilter], queryFn: () => a.getEmployees({ search: search || undefined, status: statusFilter || undefined, limit: 200 }) })
  const { data: depts = [] } = useQuery({ queryKey: ['hr-departments', entityId], queryFn: () => a.getDepartments() })
  const { data: positions = [] } = useQuery({ queryKey: ['hr-positions', entityId], queryFn: () => a.getPositions() })
  const { data: contacts = [] } = useQuery({ queryKey: ['hr-emergency-contacts', entityId, selected?.id], queryFn: () => a.getEmergencyContacts(selected!.id), enabled: !!selected && detailTab === 'contacts' })
  const { data: history = [] } = useQuery({ queryKey: ['hr-employment-history', entityId, selected?.id], queryFn: () => a.getEmploymentHistory(selected!.id), enabled: !!selected && detailTab === 'history' })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['hr-employees', entityId] })
    if (selected) void qc.invalidateQueries({ queryKey: ['hr-employment-history', entityId, selected.id] })
  }

  async function handleAdd() {
    setSaving(true); setError('')
    try {
      await a.createEmployee({ ...form, base_salary_ttd: form.base_salary_ttd || undefined, position_id: form.position_id || undefined, department_id: form.department_id || undefined })
      setShowAdd(false); invalidate()
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleTerminate() {
    if (!selected) return
    setSaving(true); setError('')
    try {
      await a.terminateEmployee(selected.id, termForm)
      setShowTerminate(false); setSelected(null); invalidate()
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full">
      {/* List */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0`}>
        <div className="flex gap-2 mb-3">
          <input className={cls} placeholder={t('common.search')} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="bg-slate-700 border border-slate-600 rounded px-2 text-sm text-slate-300 focus:outline-none" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            {(['ACTIVE','INACTIVE','TERMINATED','ON_LEAVE'] as EmployeeStatus[]).map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
          </select>
        </div>
        <button className={`${btnPrimary} mb-3`} onClick={() => setShowAdd(true)}>{t('hr.addEmployee')}</button>
        <div className="overflow-y-auto space-y-1 flex-1">
          {employees.map((emp: HrEmployee) => (
            <button key={emp.id} onClick={() => { setSelected(emp); setDetailTab('info') }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${selected?.id === emp.id ? 'bg-blue-900/40 border border-blue-700' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <div className="font-medium text-slate-100">{emp.first_name} {emp.last_name}</div>
              <div className="text-xs text-slate-400">{emp.employee_number} · {emp.position_name ?? emp.employment_type}</div>
              <div className="mt-1"><Badge text={emp.status} cls={STATUS_BADGE[emp.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></div>
            </button>
          ))}
          {employees.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
        </div>
      </div>

      {/* Detail */}
      {selected && (
        <div className={`flex-1 bg-slate-800 rounded-lg p-4 overflow-y-auto`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <button className="md:hidden text-sm text-blue-400 mb-2" onClick={() => setSelected(null)}>← {t('common.back')}</button>
              <h3 className="text-lg font-semibold text-slate-100">{selected.first_name} {selected.last_name}</h3>
              <p className="text-sm text-slate-400">{selected.employee_number} · {selected.position_name ?? '—'}</p>
            </div>
            <div className="flex gap-2">
              {selected.status !== 'TERMINATED' && (
                <button className={btnSecondary} onClick={() => setShowTerminate(true)}>{t('hr.terminate')}</button>
              )}
              <button className={btnSecondary} onClick={() => setShowEdit(true)}>{t('common.edit')}</button>
            </div>
          </div>

          <div className="flex gap-2 border-b border-slate-700 mb-3">
            {(['info','contacts','history'] as const).map(tab => (
              <button key={tab} onClick={() => setDetailTab(tab)}
                className={`pb-2 px-1 text-sm capitalize border-b-2 ${detailTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                {t(`hr.${tab}`)}
              </button>
            ))}
          </div>

          {detailTab === 'info' && (
            <div className="grid grid-cols-2 gap-x-8">
              <div>
                <SectionTitle>{t('hr.personal')}</SectionTitle>
                <Row label={t('hr.dob')} value={fmtDate(selected.date_of_birth ?? '')} />
                <Row label={t('hr.gender')} value={selected.gender} />
                <Row label={t('hr.nationality')} value={selected.nationality} />
                <Row label={t('hr.idType')} value={selected.id_type?.replace('_',' ')} />
                <Row label={t('hr.idNumber')} value={selected.id_number} />
                <Row label={t('hr.nisNumber')} value={selected.nis_number} />
                <Row label={t('hr.birsId')} value={selected.birs_tax_id} />
                <Row label={t('hr.phone')} value={selected.phone} />
                <Row label={t('hr.email')} value={selected.email} />
              </div>
              <div>
                <SectionTitle>{t('hr.employment')}</SectionTitle>
                <Row label={t('hr.department')} value={selected.department_name} />
                <Row label={t('hr.position')} value={selected.position_name} />
                <Row label={t('hr.type')} value={selected.employment_type.replace('_',' ')} />
                <Row label={t('hr.hireDate')} value={fmtDate(selected.hire_date ?? '')} />
                <Row label={t('hr.probationEnd')} value={fmtDate(selected.probation_end_date ?? '')} />
                <Row label={t('hr.salary')} value={fmt(selected.base_salary_ttd)} />
                <Row label={t('hr.payFrequency')} value={selected.pay_frequency} />
                <SectionTitle>{t('hr.banking')}</SectionTitle>
                <Row label={t('hr.bank')} value={selected.bank_name} />
                <Row label={t('hr.branch')} value={selected.bank_branch} />
                <Row label={t('hr.accountNumber')} value={selected.account_number} />
                <Row label={t('hr.accountType')} value={selected.account_type} />
              </div>
            </div>
          )}

          {detailTab === 'contacts' && (
            <div className="space-y-3">
              {contacts.map(c => (
                <div key={c.id} className="bg-slate-900 rounded p-3">
                  <div className="font-medium text-slate-100">{c.name} <span className="text-xs text-slate-400">({c.relationship})</span></div>
                  <div className="text-sm text-slate-300">{c.phone}{c.phone2 ? ` · ${c.phone2}` : ''}</div>
                  {c.email && <div className="text-sm text-slate-400">{c.email}</div>}
                  {c.is_primary && <span className="mt-1 inline-block text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 border border-blue-700 rounded">Primary</span>}
                </div>
              ))}
              {contacts.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
            </div>
          )}

          {detailTab === 'history' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700">
                  <th className="pb-2 pr-4">{t('hr.date')}</th>
                  <th className="pb-2 pr-4">{t('hr.changeType')}</th>
                  <th className="pb-2 pr-4">{t('hr.newPosition')}</th>
                  <th className="pb-2 pr-4">{t('hr.newSalary')}</th>
                  <th className="pb-2">{t('hr.reason')}</th>
                </tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className="border-b border-slate-700/50">
                      <td className="py-2 pr-4 text-slate-300">{fmtDate(h.effective_date)}</td>
                      <td className="py-2 pr-4"><Badge text={h.change_type} cls="bg-slate-700 text-slate-300 border-slate-500" /></td>
                      <td className="py-2 pr-4 text-slate-300">{h.new_position ?? '—'}</td>
                      <td className="py-2 pr-4 text-slate-300">{fmt(h.new_salary_ttd)}</td>
                      <td className="py-2 text-slate-400 text-xs">{h.change_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history.length === 0 && <p className="text-sm text-slate-500 italic mt-3">{t('common.noRecords')}</p>}
            </div>
          )}
        </div>
      )}

      {/* Add Employee Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addEmployee')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('hr.firstName')}><input className={cls} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} /></Field>
              <Field label={t('hr.lastName')}><input className={cls} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} /></Field>
              <Field label={t('hr.employeeNumber')}><input className={cls} value={form.employee_number} onChange={e => setForm(f => ({ ...f, employee_number: e.target.value }))} /></Field>
              <Field label={t('hr.type')}>
                <select className={cls} value={form.employment_type} onChange={e => setForm(f => ({ ...f, employment_type: e.target.value }))}>
                  {['FULL_TIME','PART_TIME','CONTRACT','CASUAL'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <Field label={t('hr.hireDate')}><input type="date" className={cls} value={form.hire_date} onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))} /></Field>
              <Field label={t('hr.salary')}><input type="number" className={cls} value={form.base_salary_ttd} onChange={e => setForm(f => ({ ...f, base_salary_ttd: e.target.value }))} /></Field>
              <Field label={t('hr.payFrequency')}>
                <select className={cls} value={form.pay_frequency} onChange={e => setForm(f => ({ ...f, pay_frequency: e.target.value }))}>
                  {['MONTHLY','BIWEEKLY','WEEKLY'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t('hr.department')}>
                <select className={cls} value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {depts.map((d: HrDepartment) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label={t('hr.position')}>
                  <select className={cls} value={form.position_id} onChange={e => setForm(f => ({ ...f, position_id: e.target.value }))}>
                    <option value="">— Select —</option>
                    {positions.map((p: HrPosition) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAdd} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Terminate Modal */}
      {showTerminate && selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-red-400 mb-4">{t('hr.terminate')}: {selected.first_name} {selected.last_name}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.terminationDate')}><input type="date" className={cls} value={termForm.termination_date} onChange={e => setTermForm(f => ({ ...f, termination_date: e.target.value }))} /></Field>
              <Field label={t('hr.terminationReason')}><textarea className={cls} rows={3} value={termForm.termination_reason} onChange={e => setTermForm(f => ({ ...f, termination_reason: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowTerminate(false)}>{t('common.cancel')}</button>
              <button className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-sm rounded" onClick={handleTerminate} disabled={saving}>{saving ? t('common.saving') : t('hr.confirmTerminate')}</button>
            </div>
          </div>
        </div>
      )}

      {showEdit && selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('common.edit')}: {selected.first_name} {selected.last_name}</h3>
            <EditEmployeeForm employee={selected} depts={depts} positions={positions} api={a} onClose={() => setShowEdit(false)}
              onSaved={() => { setShowEdit(false); invalidate() }} />
          </div>
        </div>
      )}
    </div>
  )
}

type HrApiType = ReturnType<typeof hrApiFor>

function EditEmployeeForm({ employee, depts, positions, api: a, onClose, onSaved }: { employee: HrEmployee; depts: HrDepartment[]; positions: HrPosition[]; api: HrApiType; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    first_name: employee.first_name, last_name: employee.last_name,
    email: employee.email ?? '', phone: employee.phone ?? '',
    position_id: employee.position_id ?? '', department_id: employee.department_id ?? '',
    employment_type: employee.employment_type, pay_frequency: employee.pay_frequency,
    base_salary_ttd: employee.base_salary_ttd ?? '',
    nis_number: employee.nis_number ?? '', birs_tax_id: employee.birs_tax_id ?? '',
    bank_name: employee.bank_name ?? '', bank_branch: employee.bank_branch ?? '',
    account_number: employee.account_number ?? '', account_type: employee.account_type ?? '',
    notes: employee.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const payload = { ...form, base_salary_ttd: form.base_salary_ttd || undefined, position_id: form.position_id || undefined, department_id: form.department_id || undefined }
      await a.updateEmployee(employee.id, payload)
      onSaved()
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('hr.firstName')}><input className={cls} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} /></Field>
        <Field label={t('hr.lastName')}><input className={cls} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} /></Field>
        <Field label={t('hr.email')}><input className={cls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
        <Field label={t('hr.phone')}><input className={cls} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
        <Field label={t('hr.department')}>
          <select className={cls} value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
            <option value="">— Select —</option>
            {depts.map((d: HrDepartment) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={t('hr.position')}>
          <select className={cls} value={form.position_id} onChange={e => setForm(f => ({ ...f, position_id: e.target.value }))}>
            <option value="">— Select —</option>
            {positions.map((p: HrPosition) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={t('hr.salary')}><input type="number" className={cls} value={form.base_salary_ttd} onChange={e => setForm(f => ({ ...f, base_salary_ttd: e.target.value }))} /></Field>
        <Field label={t('hr.payFrequency')}>
          <select className={cls} value={form.pay_frequency} onChange={e => setForm(f => ({ ...f, pay_frequency: e.target.value as typeof form.pay_frequency }))}>
            {['MONTHLY','BIWEEKLY','WEEKLY'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label={t('hr.nisNumber')}><input className={cls} value={form.nis_number} onChange={e => setForm(f => ({ ...f, nis_number: e.target.value }))} /></Field>
        <Field label={t('hr.birsId')}><input className={cls} value={form.birs_tax_id} onChange={e => setForm(f => ({ ...f, birs_tax_id: e.target.value }))} /></Field>
        <Field label={t('hr.bank')}><input className={cls} value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></Field>
        <Field label={t('hr.branch')}><input className={cls} value={form.bank_branch} onChange={e => setForm(f => ({ ...f, bank_branch: e.target.value }))} /></Field>
        <Field label={t('hr.accountNumber')}><input className={cls} value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></Field>
        <Field label={t('hr.accountType')}><input className={cls} value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))} /></Field>
        <div className="col-span-2">
          <Field label={t('common.notes')}><textarea className={cls} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button className={btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
        <button className={btnPrimary} onClick={handleSave} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL TAB
// ═══════════════════════════════════════════════════════════════════════════════
function PayrollTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const now = new Date()
  const [selectedRun, setSelectedRun] = useState<HrPayrollRun | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ period_month: String(now.getMonth() + 1), period_year: String(now.getFullYear()), pay_date: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: runs = [] } = useQuery({ queryKey: ['hr-payroll-runs', entityId], queryFn: () => a.getPayrollRuns({ limit: 50 }) })
  const { data: entries = [] } = useQuery({ queryKey: ['hr-payroll-entries', entityId, selectedRun?.id], queryFn: () => a.getPayrollEntries(selectedRun!.id), enabled: !!selectedRun })

  async function handleCreate() {
    setSaving(true); setError('')
    try {
      const run = await a.createPayrollRun({ period_month: parseInt(newForm.period_month), period_year: parseInt(newForm.period_year), pay_date: newForm.pay_date || undefined })
      setShowNew(false); setSelectedRun(run); void qc.invalidateQueries({ queryKey: ['hr-payroll-runs', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleCalculate() {
    if (!selectedRun) return
    setSaving(true); setError('')
    try {
      const updated = await a.calculatePayrollRun(selectedRun.id)
      setSelectedRun(updated)
      void qc.invalidateQueries({ queryKey: ['hr-payroll-runs', entityId] })
      void qc.invalidateQueries({ queryKey: ['hr-payroll-entries', entityId, selectedRun.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleFinalize() {
    if (!selectedRun) return
    setSaving(true); setError('')
    try {
      const updated = await a.finalizePayrollRun(selectedRun.id)
      setSelectedRun(updated); void qc.invalidateQueries({ queryKey: ['hr-payroll-runs', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const RUN_STATUS_BADGE: Record<string, string> = {
    DRAFT:     'bg-slate-700 text-slate-300 border-slate-500',
    FINALIZED: 'bg-blue-900/50 text-blue-300 border-blue-700',
    PAID:      'bg-green-900/50 text-green-300 border-green-700',
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className={`${selectedRun ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-64 shrink-0`}>
        <button className={`${btnPrimary} mb-3`} onClick={() => setShowNew(true)}>{t('hr.newPayrollRun')}</button>
        <div className="space-y-1 overflow-y-auto">
          {(runs as HrPayrollRun[]).map(run => (
            <button key={run.id} onClick={() => setSelectedRun(run)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${selectedRun?.id === run.id ? 'bg-blue-900/40 border border-blue-700' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <div className="font-medium text-slate-100">{MONTHS[run.period_month - 1]} {run.period_year}</div>
              <div className="mt-1"><Badge text={run.status} cls={RUN_STATUS_BADGE[run.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></div>
              {run.total_net_ttd && <div className="text-xs text-slate-400 mt-1">Net: {fmt(run.total_net_ttd)}</div>}
            </button>
          ))}
          {runs.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
        </div>
      </div>

      {selectedRun && (
        <div className="flex-1 bg-slate-800 rounded-lg p-4 overflow-y-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <button className="md:hidden text-sm text-blue-400 mb-2" onClick={() => setSelectedRun(null)}>← {t('common.back')}</button>
              <h3 className="text-lg font-semibold text-slate-100">{MONTHS[selectedRun.period_month - 1]} {selectedRun.period_year}</h3>
              <Badge text={selectedRun.status} cls={RUN_STATUS_BADGE[selectedRun.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              {selectedRun.status === 'DRAFT' && (
                <>
                  <button className={btnSecondary} onClick={handleCalculate} disabled={saving}>{saving ? '…' : t('hr.calculate')}</button>
                  <button className={btnPrimary} onClick={handleFinalize} disabled={saving}>{saving ? '…' : t('hr.finalize')}</button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            {([['hr.grossTotal', selectedRun.total_gross_ttd], ['hr.nisEmployee', selectedRun.total_nis_employee_ttd], ['hr.nisEmployer', selectedRun.total_nis_employer_ttd], ['hr.paye', selectedRun.total_paye_ttd], ['hr.healthSurcharge', selectedRun.total_health_surcharge_ttd], ['hr.netTotal', selectedRun.total_net_ttd]] as [string, string | null][]).map(([key, val]) => (
              <div key={key} className="bg-slate-900 rounded p-2">
                <div className="text-xs text-slate-400">{t(key)}</div>
                <div className="text-sm font-medium text-slate-100">{fmt(val)}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
                {['hr.employee','hr.gross','hr.nis','hr.healthSurcharge','hr.paye','hr.net'].map(k => (
                  <th key={k} className="px-3 py-2">{t(k)}</th>
                ))}
              </tr></thead>
              <tbody>
                {(entries as HrPayrollEntry[]).map(entry => (
                  <tr key={entry.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2 text-slate-100">{entry.employee_name ?? '—'}<div className="text-xs text-slate-400">{entry.employee_number}</div></td>
                    <td className="px-3 py-2">{fmt(entry.total_gross_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.nis_employee_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.health_surcharge_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.paye_ttd)}</td>
                    <td className="px-3 py-2 font-medium text-green-300">{fmt(entry.net_pay_ttd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.newPayrollRun')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.month')}>
                <select className={cls} value={newForm.period_month} onChange={e => setNewForm(f => ({ ...f, period_month: e.target.value }))}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
              <Field label={t('hr.year')}><input type="number" className={cls} value={newForm.period_year} onChange={e => setNewForm(f => ({ ...f, period_year: e.target.value }))} /></Field>
              <Field label={t('hr.payDate')}><input type="date" className={cls} value={newForm.pay_date} onChange={e => setNewForm(f => ({ ...f, pay_date: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowNew(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleCreate} disabled={saving}>{saving ? t('common.saving') : t('common.create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function LeaveTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [leaveSubTab, setLeaveSubTab] = useState<'requests'|'balances'|'types'>('requests')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAddRequest, setShowAddRequest] = useState(false)
  const [showAddType, setShowAddType] = useState(false)
  const [reqForm, setReqForm] = useState({ employee_id:'', leave_type_id:'', start_date:'', end_date:'', days_requested:'', reason:'' })
  const [typeForm, setTypeForm] = useState({ name:'', code:'', days_per_year:'', is_paid: true, carry_over_days:'0', requires_approval: true })

  const { data: requests = [] } = useQuery({ queryKey: ['hr-leave-requests', entityId], queryFn: () => a.getLeaveRequests({ limit: 100 }) })
  const { data: balances = [] } = useQuery({ queryKey: ['hr-leave-balances', entityId], queryFn: () => a.getLeaveBalances({ limit: 200 }) })
  const { data: types = [] } = useQuery({ queryKey: ['hr-leave-types', entityId], queryFn: () => a.getLeaveTypes() })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  async function handleApprove(req: HrLeaveRequest) {
    setSaving(true)
    try { await a.approveLeave(req.id); void qc.invalidateQueries({ queryKey: ['hr-leave-requests', entityId] }) }
    finally { setSaving(false) }
  }

  async function handleReject(req: HrLeaveRequest) {
    setSaving(true)
    try { await a.rejectLeave(req.id, { rejection_reason: 'Rejected' }); void qc.invalidateQueries({ queryKey: ['hr-leave-requests', entityId] }) }
    finally { setSaving(false) }
  }

  async function handleAddRequest() {
    setSaving(true); setError('')
    try {
      await a.createLeaveRequest({ ...reqForm, days_requested: parseFloat(reqForm.days_requested) })
      setShowAddRequest(false); void qc.invalidateQueries({ queryKey: ['hr-leave-requests', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleAddType() {
    setSaving(true); setError('')
    try {
      await a.createLeaveType({ ...typeForm, days_per_year: parseFloat(typeForm.days_per_year), carry_over_days: parseFloat(typeForm.carry_over_days) })
      setShowAddType(false); void qc.invalidateQueries({ queryKey: ['hr-leave-types', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const LEAVE_STATUS: Record<string, string> = {
    PENDING:   'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    APPROVED:  'bg-green-900/50 text-green-300 border-green-700',
    REJECTED:  'bg-red-900/50 text-red-400 border-red-700',
    CANCELLED: 'bg-slate-700 text-slate-400 border-slate-600',
  }

  return (
    <div>
      <div className="flex gap-2 border-b border-slate-700 mb-4">
        {(['requests','balances','types'] as const).map(st => (
          <button key={st} onClick={() => setLeaveSubTab(st)}
            className={`pb-2 px-3 text-sm capitalize border-b-2 ${leaveSubTab === st ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t(`hr.${st}`)}
          </button>
        ))}
      </div>

      {leaveSubTab === 'requests' && (
        <div>
          <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddRequest(true)}>{t('hr.newLeaveRequest')}</button>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
                {['hr.employee','hr.leaveType','hr.startDate','hr.endDate','hr.days','hr.status','common.actions'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
              </tr></thead>
              <tbody>
                {(requests as HrLeaveRequest[]).map(req => (
                  <tr key={req.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2 text-slate-100">{req.employee_name}</td>
                    <td className="px-3 py-2 text-slate-300">{req.leave_type_name}</td>
                    <td className="px-3 py-2 text-slate-300">{fmtDate(req.start_date)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmtDate(req.end_date)}</td>
                    <td className="px-3 py-2 text-slate-300">{req.days_requested}</td>
                    <td className="px-3 py-2"><Badge text={req.status} cls={LEAVE_STATUS[req.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></td>
                    <td className="px-3 py-2">
                      {req.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <button className="text-xs text-green-400 hover:underline" onClick={() => handleApprove(req)} disabled={saving}>✓ {t('common.approve')}</button>
                          <button className="text-xs text-red-400 hover:underline" onClick={() => handleReject(req)} disabled={saving}>✗ {t('common.reject')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {requests.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
          </div>
        </div>
      )}

      {leaveSubTab === 'balances' && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
              {['hr.employee','hr.leaveType','hr.year','hr.entitled','hr.used','hr.remaining'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
            </tr></thead>
            <tbody>
              {(balances as HrLeaveBalance[]).map(bal => (
                <tr key={bal.id} className="border-b border-slate-700/50">
                  <td className="px-3 py-2 text-slate-100">{bal.employee_name}</td>
                  <td className="px-3 py-2 text-slate-300">{bal.leave_type_name}</td>
                  <td className="px-3 py-2 text-slate-300">{bal.year}</td>
                  <td className="px-3 py-2 text-slate-300">{bal.entitled_days}</td>
                  <td className="px-3 py-2 text-slate-300">{bal.used_days}</td>
                  <td className="px-3 py-2 text-green-300">{bal.entitled_days + bal.carried_over_days - bal.used_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {balances.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
        </div>
      )}

      {leaveSubTab === 'types' && (
        <div>
          <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddType(true)}>{t('hr.addLeaveType')}</button>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {(types as HrLeaveType[]).map(lt => (
              <div key={lt.id} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <div className="font-medium text-slate-100">{lt.name}</div>
                <div className="text-xs text-slate-400">{lt.code}</div>
                <div className="mt-2 text-sm text-slate-300">{lt.days_per_year} days/year · {lt.is_paid ? 'Paid' : 'Unpaid'}</div>
                {lt.carry_over_days > 0 && <div className="text-xs text-slate-400">Carry over: {lt.carry_over_days} days</div>}
              </div>
            ))}
          </div>
          {types.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
        </div>
      )}

      {showAddRequest && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.newLeaveRequest')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.employee')}>
                <select className={cls} value={reqForm.employee_id} onChange={e => setReqForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
              </Field>
              <Field label={t('hr.leaveType')}>
                <select className={cls} value={reqForm.leave_type_id} onChange={e => setReqForm(f => ({ ...f, leave_type_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(types as HrLeaveType[]).map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
                </select>
              </Field>
              <Field label={t('hr.startDate')}><input type="date" className={cls} value={reqForm.start_date} onChange={e => setReqForm(f => ({ ...f, start_date: e.target.value }))} /></Field>
              <Field label={t('hr.endDate')}><input type="date" className={cls} value={reqForm.end_date} onChange={e => setReqForm(f => ({ ...f, end_date: e.target.value }))} /></Field>
              <Field label={t('hr.days')}><input type="number" className={cls} value={reqForm.days_requested} onChange={e => setReqForm(f => ({ ...f, days_requested: e.target.value }))} /></Field>
              <Field label={t('hr.reason')}><textarea className={cls} rows={2} value={reqForm.reason} onChange={e => setReqForm(f => ({ ...f, reason: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddRequest(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddRequest} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {showAddType && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addLeaveType')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('hr.name')}><input className={cls} value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} /></Field>
              <Field label={t('hr.code')}><input className={cls} value={typeForm.code} onChange={e => setTypeForm(f => ({ ...f, code: e.target.value }))} /></Field>
              <Field label={t('hr.daysPerYear')}><input type="number" className={cls} value={typeForm.days_per_year} onChange={e => setTypeForm(f => ({ ...f, days_per_year: e.target.value }))} /></Field>
              <Field label={t('hr.carryOver')}><input type="number" className={cls} value={typeForm.carry_over_days} onChange={e => setTypeForm(f => ({ ...f, carry_over_days: e.target.value }))} /></Field>
              <div className="flex items-center gap-2 col-span-2 mt-1">
                <input type="checkbox" id="is_paid" checked={typeForm.is_paid} onChange={e => setTypeForm(f => ({ ...f, is_paid: e.target.checked }))} />
                <label htmlFor="is_paid" className="text-sm text-slate-300">{t('hr.isPaid')}</label>
                <input type="checkbox" id="req_approval" className="ml-4" checked={typeForm.requires_approval} onChange={e => setTypeForm(f => ({ ...f, requires_approval: e.target.checked }))} />
                <label htmlFor="req_approval" className="text-sm text-slate-300">{t('hr.requiresApproval')}</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddType(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddType} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function PerformanceTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const now = new Date()
  const [form, setForm] = useState({ employee_id:'', review_period:'ANNUAL', review_year: String(now.getFullYear()), review_date:'', overall_rating:'', goals_met_rating:'', competency_rating:'', attendance_rating:'', strengths:'', areas_for_improvement:'', goals_next_period:'' })

  const { data: reviews = [] } = useQuery({ queryKey: ['hr-reviews', entityId], queryFn: () => a.getReviews({ limit: 100 }) })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  const REVIEW_STATUS: Record<string, string> = {
    DRAFT:        'bg-slate-700 text-slate-300 border-slate-500',
    SUBMITTED:    'bg-blue-900/50 text-blue-300 border-blue-700',
    ACKNOWLEDGED: 'bg-green-900/50 text-green-300 border-green-700',
  }

  async function handleAdd() {
    setSaving(true); setError('')
    try {
      const payload = { ...form, review_year: parseInt(form.review_year), overall_rating: parseInt(form.overall_rating) || undefined, goals_met_rating: parseInt(form.goals_met_rating) || undefined, competency_rating: parseInt(form.competency_rating) || undefined, attendance_rating: parseInt(form.attendance_rating) || undefined }
      await a.createReview(payload)
      setShowAdd(false); void qc.invalidateQueries({ queryKey: ['hr-reviews', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  function Stars({ val }: { val: number | null }) {
    if (!val) return <span className="text-slate-500">—</span>
    return <span className="text-yellow-400">{'★'.repeat(val)}{'☆'.repeat(5 - val)}</span>
  }

  const RATING_FIELDS = ['overall_rating','goals_met_rating','competency_rating','attendance_rating'] as const

  return (
    <div>
      <button className={`${btnPrimary} mb-4`} onClick={() => setShowAdd(true)}>{t('hr.addReview')}</button>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
            {['hr.employee','hr.period','hr.year','hr.overall','hr.goalsMet','hr.competency','hr.status','common.actions'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
          </tr></thead>
          <tbody>
            {(reviews as HrPerformanceReview[]).map(rev => (
              <tr key={rev.id} className="border-b border-slate-700/50">
                <td className="px-3 py-2 text-slate-100">{rev.employee_name}</td>
                <td className="px-3 py-2 text-slate-300">{rev.review_period.replace('_',' ')}</td>
                <td className="px-3 py-2 text-slate-300">{rev.review_year}</td>
                <td className="px-3 py-2"><Stars val={rev.overall_rating} /></td>
                <td className="px-3 py-2"><Stars val={rev.goals_met_rating} /></td>
                <td className="px-3 py-2"><Stars val={rev.competency_rating} /></td>
                <td className="px-3 py-2"><Badge text={rev.status} cls={REVIEW_STATUS[rev.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    {rev.status === 'DRAFT' && <button className="text-xs text-blue-400 hover:underline" onClick={async () => { await a.submitReview(rev.id); void qc.invalidateQueries({ queryKey: ['hr-reviews', entityId] }) }}>{t('hr.submit')}</button>}
                    {rev.status === 'SUBMITTED' && <button className="text-xs text-green-400 hover:underline" onClick={async () => { await a.acknowledgeReview(rev.id); void qc.invalidateQueries({ queryKey: ['hr-reviews', entityId] }) }}>{t('hr.acknowledge')}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {reviews.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addReview')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label={t('hr.employee')}>
                <select className={cls} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
              </Field></div>
              <Field label={t('hr.period')}>
                <select className={cls} value={form.review_period} onChange={e => setForm(f => ({ ...f, review_period: e.target.value }))}>
                  {['ANNUAL','MID_YEAR','PROBATION'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <Field label={t('hr.year')}><input type="number" className={cls} value={form.review_year} onChange={e => setForm(f => ({ ...f, review_year: e.target.value }))} /></Field>
              <Field label={t('hr.reviewDate')}><input type="date" className={cls} value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} /></Field>
              {RATING_FIELDS.map(field => (
                <Field key={field} label={t(`hr.${field}`)}>
                  <select className={cls} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}>
                    <option value="">—</option>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} — {['Poor','Below Expectations','Meets Expectations','Exceeds Expectations','Outstanding'][n-1]}</option>)}
                  </select>
                </Field>
              ))}
              {(['strengths','areas_for_improvement','goals_next_period'] as const).map(field => (
                <div key={field} className="col-span-2">
                  <Field label={t(`hr.${field}`)}><textarea className={cls} rows={2} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} /></Field>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAdd} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECRUITMENT TAB
// ═══════════════════════════════════════════════════════════════════════════════
function RecruitmentTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [selectedPosting, setSelectedPosting] = useState<HrJobPosting | null>(null)
  const [showAddPosting, setShowAddPosting] = useState(false)
  const [showAddApp, setShowAddApp] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [postingForm, setPostingForm] = useState({ title:'', employment_type:'FULL_TIME', location:'', vacancies:'1', posted_date:'', closing_date:'', description:'' })
  const [appForm, setAppForm] = useState({ applicant_name:'', email:'', phone:'', source:'WALK_IN', years_experience:'0', cv_url:'', notes:'' })

  const { data: postings = [] } = useQuery({ queryKey: ['hr-postings', entityId], queryFn: () => a.getJobPostings({ limit: 100 }) })
  const { data: applications = [] } = useQuery({ queryKey: ['hr-applications', entityId, selectedPosting?.id], queryFn: () => a.getApplications({ job_posting_id: selectedPosting!.id, limit: 100 }), enabled: !!selectedPosting })

  const POSTING_STATUS: Record<string, string> = {
    DRAFT:     'bg-slate-700 text-slate-300 border-slate-500',
    OPEN:      'bg-green-900/50 text-green-300 border-green-700',
    CLOSED:    'bg-red-900/50 text-red-400 border-red-700',
    FILLED:    'bg-blue-900/50 text-blue-300 border-blue-700',
    CANCELLED: 'bg-slate-700 text-slate-400 border-slate-600',
  }

  async function handleAddPosting() {
    setSaving(true); setError('')
    try {
      await a.createJobPosting({ ...postingForm, vacancies: parseInt(postingForm.vacancies) })
      setShowAddPosting(false); void qc.invalidateQueries({ queryKey: ['hr-postings', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleAddApp() {
    if (!selectedPosting) return
    setSaving(true); setError('')
    try {
      await a.createApplication({ ...appForm, job_posting_id: selectedPosting.id, years_experience: parseInt(appForm.years_experience) })
      setShowAddApp(false); void qc.invalidateQueries({ queryKey: ['hr-applications', entityId, selectedPosting.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function advance(app: HrJobApplication) {
    await a.advanceApplication(app.id)
    void qc.invalidateQueries({ queryKey: ['hr-applications', entityId, selectedPosting?.id] })
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className={`${selectedPosting ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-64 shrink-0`}>
        <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddPosting(true)}>{t('hr.newPosting')}</button>
        <div className="space-y-1 overflow-y-auto">
          {(postings as HrJobPosting[]).map(p => (
            <button key={p.id} onClick={() => setSelectedPosting(p)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${selectedPosting?.id === p.id ? 'bg-blue-900/40 border border-blue-700' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <div className="font-medium text-slate-100">{p.title}</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge text={p.status} cls={POSTING_STATUS[p.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} />
                <span className="text-xs text-slate-400">{p.vacancies} vac.</span>
              </div>
            </button>
          ))}
          {postings.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
        </div>
      </div>

      {selectedPosting && (
        <div className="flex-1 bg-slate-800 rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <button className="md:hidden text-sm text-blue-400 mb-2" onClick={() => setSelectedPosting(null)}>← {t('common.back')}</button>
              <h3 className="font-semibold text-slate-100">{selectedPosting.title}</h3>
              <div className="text-sm text-slate-400">{selectedPosting.employment_type?.replace('_',' ')} · {selectedPosting.location ?? 'N/A'}</div>
            </div>
            <button className={btnPrimary} onClick={() => setShowAddApp(true)}>{t('hr.addApplicant')}</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
                {['hr.applicant','hr.source','hr.experience','hr.stage','common.actions'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
              </tr></thead>
              <tbody>
                {(applications as HrJobApplication[]).map(app => (
                  <tr key={app.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2 text-slate-100">{app.applicant_name}<div className="text-xs text-slate-400">{app.email}</div></td>
                    <td className="px-3 py-2 text-slate-300">{app.source.replace('_',' ')}</td>
                    <td className="px-3 py-2 text-slate-300">{app.years_experience ?? '—'}y</td>
                    <td className="px-3 py-2"><Badge text={app.stage} cls={STAGE_BADGE[app.stage] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></td>
                    <td className="px-3 py-2">
                      {!['HIRED','REJECTED','WITHDRAWN'].includes(app.stage) && (
                        <button className="text-xs text-blue-400 hover:underline" onClick={() => advance(app)}>→ {t('hr.advance')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {applications.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
          </div>
        </div>
      )}

      {showAddPosting && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.newPosting')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label={t('hr.jobTitle')}><input className={cls} value={postingForm.title} onChange={e => setPostingForm(f => ({ ...f, title: e.target.value }))} /></Field></div>
              <Field label={t('hr.type')}>
                <select className={cls} value={postingForm.employment_type} onChange={e => setPostingForm(f => ({ ...f, employment_type: e.target.value }))}>
                  {['FULL_TIME','PART_TIME','CONTRACT','CASUAL'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <Field label={t('hr.location')}><input className={cls} value={postingForm.location} onChange={e => setPostingForm(f => ({ ...f, location: e.target.value }))} /></Field>
              <Field label={t('hr.vacancies')}><input type="number" className={cls} min={1} value={postingForm.vacancies} onChange={e => setPostingForm(f => ({ ...f, vacancies: e.target.value }))} /></Field>
              <Field label={t('hr.postedDate')}><input type="date" className={cls} value={postingForm.posted_date} onChange={e => setPostingForm(f => ({ ...f, posted_date: e.target.value }))} /></Field>
              <Field label={t('hr.closingDate')}><input type="date" className={cls} value={postingForm.closing_date} onChange={e => setPostingForm(f => ({ ...f, closing_date: e.target.value }))} /></Field>
              <div className="col-span-2"><Field label={t('common.description')}><textarea className={cls} rows={3} value={postingForm.description} onChange={e => setPostingForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddPosting(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddPosting} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {showAddApp && selectedPosting && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addApplicant')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.applicantName')}><input className={cls} value={appForm.applicant_name} onChange={e => setAppForm(f => ({ ...f, applicant_name: e.target.value }))} /></Field>
              <Field label={t('hr.email')}><input className={cls} value={appForm.email} onChange={e => setAppForm(f => ({ ...f, email: e.target.value }))} /></Field>
              <Field label={t('hr.phone')}><input className={cls} value={appForm.phone} onChange={e => setAppForm(f => ({ ...f, phone: e.target.value }))} /></Field>
              <Field label={t('hr.source')}>
                <select className={cls} value={appForm.source} onChange={e => setAppForm(f => ({ ...f, source: e.target.value }))}>
                  {['WALK_IN','REFERRAL','ONLINE','NEWSPAPER','INDEED','LINKEDIN','OTHER'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <Field label={t('hr.yearsExperience')}><input type="number" className={cls} value={appForm.years_experience} onChange={e => setAppForm(f => ({ ...f, years_experience: e.target.value }))} /></Field>
              <Field label={t('hr.cvUrl')}><input className={cls} placeholder="https://..." value={appForm.cv_url} onChange={e => setAppForm(f => ({ ...f, cv_url: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddApp(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddApp} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function TrainingTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showExpiring, setShowExpiring] = useState(false)
  const [form, setForm] = useState({ employee_id:'', training_name:'', training_type_id:'', provider:'', training_date:'', expiry_date:'', cost_ttd:'', status:'COMPLETED', notes:'' })

  const { data: records = [] } = useQuery({ queryKey: ['hr-training', entityId, showExpiring], queryFn: () => a.getTrainingRecords({ expiring: showExpiring || undefined, limit: 200 }) })
  const { data: types = [] } = useQuery({ queryKey: ['hr-training-types', entityId], queryFn: () => a.getTrainingTypes() })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  async function handleAdd() {
    setSaving(true); setError('')
    try {
      await a.createTrainingRecord({ ...form, cost_ttd: form.cost_ttd ? parseFloat(form.cost_ttd) : undefined, training_type_id: form.training_type_id || undefined, expiry_date: form.expiry_date || undefined })
      setShowAdd(false); void qc.invalidateQueries({ queryKey: ['hr-training', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const EXPIRY_BADGE: Record<string, string> = { EXPIRED: 'bg-red-900/50 text-red-400 border-red-700', EXPIRING_SOON: 'bg-orange-900/50 text-orange-300 border-orange-700', VALID: 'bg-green-900/50 text-green-300 border-green-700' }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button className={btnPrimary} onClick={() => setShowAdd(true)}>{t('hr.addRecord')}</button>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={showExpiring} onChange={e => setShowExpiring(e.target.checked)} />
          {t('hr.showExpiring')}
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
            {['hr.employee','hr.trainingName','hr.provider','hr.date','hr.expiry','hr.status','hr.expiryStatus'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
          </tr></thead>
          <tbody>
            {records.map(rec => (
              <tr key={rec.id} className="border-b border-slate-700/50">
                <td className="px-3 py-2 text-slate-100">{rec.employee_name}</td>
                <td className="px-3 py-2 text-slate-300">{rec.training_name}</td>
                <td className="px-3 py-2 text-slate-400">{rec.provider ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">{fmtDate(rec.training_date ?? '')}</td>
                <td className="px-3 py-2 text-slate-300">{fmtDate(rec.expiry_date ?? '')}</td>
                <td className="px-3 py-2"><Badge text={rec.status} cls="bg-slate-700 text-slate-300 border-slate-500" /></td>
                <td className="px-3 py-2">{rec.expiry_status ? <Badge text={rec.expiry_status.replace('_',' ')} cls={EXPIRY_BADGE[rec.expiry_status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addRecord')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label={t('hr.employee')}>
                <select className={cls} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
              </Field></div>
              <Field label={t('hr.trainingType')}>
                <select className={cls} value={form.training_type_id} onChange={e => setForm(f => ({ ...f, training_type_id: e.target.value }))}>
                  <option value="">— Custom —</option>
                  {(types as HrTrainingType[]).map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                </select>
              </Field>
              <Field label={t('hr.trainingName')}><input className={cls} value={form.training_name} onChange={e => setForm(f => ({ ...f, training_name: e.target.value }))} /></Field>
              <Field label={t('hr.provider')}><input className={cls} value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} /></Field>
              <Field label={t('hr.status')}>
                <select className={cls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {['PLANNED','COMPLETED','EXPIRED','CANCELLED'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label={t('hr.date')}><input type="date" className={cls} value={form.training_date} onChange={e => setForm(f => ({ ...f, training_date: e.target.value }))} /></Field>
              <Field label={t('hr.expiry')}><input type="date" className={cls} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></Field>
              <Field label={t('hr.cost')}><input type="number" className={cls} value={form.cost_ttd} onChange={e => setForm(f => ({ ...f, cost_ttd: e.target.value }))} /></Field>
              <div className="col-span-2"><Field label={t('common.notes')}><textarea className={cls} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAdd} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCIPLINARY TAB
// ═══════════════════════════════════════════════════════════════════════════════
function DisciplinaryTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ employee_id:'', incident_date:'', incident_type:'MISCONDUCT', severity:'VERBAL_WARNING', description:'', action_taken:'', investigation_conducted: false, union_involved: false })

  const { data: records = [] } = useQuery({ queryKey: ['hr-disciplinary', entityId], queryFn: () => a.getDisciplinaryRecords({ limit: 100 }) })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  async function handleAdd() {
    setSaving(true); setError('')
    try {
      await a.createDisciplinaryRecord(form)
      setShowAdd(false); void qc.invalidateQueries({ queryKey: ['hr-disciplinary', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <button className={`${btnPrimary} mb-4`} onClick={() => setShowAdd(true)}>{t('hr.addRecord')}</button>
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
            {['hr.employee','hr.incidentDate','hr.incidentType','hr.severity','hr.investigation','hr.acknowledged'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
          </tr></thead>
          <tbody>
            {(records as HrDisciplinaryRecord[]).map(rec => (
              <tr key={rec.id} className="border-b border-slate-700/50">
                <td className="px-3 py-2 text-slate-100">{rec.employee_name}</td>
                <td className="px-3 py-2 text-slate-300">{fmtDate(rec.incident_date)}</td>
                <td className="px-3 py-2 text-slate-300">{rec.incident_type.replace('_',' ')}</td>
                <td className="px-3 py-2"><Badge text={rec.severity.replace('_',' ')} cls={SEVERITY_BADGE[rec.severity] ?? 'bg-slate-700 text-slate-300 border-slate-500'} /></td>
                <td className="px-3 py-2 text-slate-300">{rec.investigation_conducted ? '✓' : '—'}</td>
                <td className="px-3 py-2">
                  {rec.acknowledged_by_employee
                    ? <span className="text-green-400 text-xs">✓ {fmtDate(rec.acknowledged_at ?? '')}</span>
                    : <button className="text-xs text-yellow-400 hover:underline" onClick={async () => { await a.acknowledgeDisciplinaryRecord(rec.id); void qc.invalidateQueries({ queryKey: ['hr-disciplinary', entityId] }) }}>{t('hr.markAcknowledged')}</button>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addDisciplinary')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label={t('hr.employee')}>
                <select className={cls} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
              </Field></div>
              <Field label={t('hr.incidentDate')}><input type="date" className={cls} value={form.incident_date} onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))} /></Field>
              <Field label={t('hr.incidentType')}>
                <select className={cls} value={form.incident_type} onChange={e => setForm(f => ({ ...f, incident_type: e.target.value }))}>
                  {['TARDINESS','INSUBORDINATION','MISCONDUCT','PERFORMANCE','POLICY_VIOLATION','ATTENDANCE','HEALTH_SAFETY','OTHER'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <div className="col-span-2"><Field label={t('hr.severity')}>
                <select className={cls} value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                  {(['VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING','SUSPENSION','DISMISSAL'] as DisciplinarySeverity[]).map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field></div>
              <div className="col-span-2"><Field label={t('common.description')}><textarea className={cls} rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field></div>
              <div className="col-span-2"><Field label={t('hr.actionTaken')}><textarea className={cls} rows={2} value={form.action_taken} onChange={e => setForm(f => ({ ...f, action_taken: e.target.value }))} /></Field></div>
              <div className="flex items-center gap-3 col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.investigation_conducted} onChange={e => setForm(f => ({ ...f, investigation_conducted: e.target.checked }))} />
                  {t('hr.investigationConducted')}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.union_involved} onChange={e => setForm(f => ({ ...f, union_involved: e.target.checked }))} />
                  {t('hr.unionInvolved')}
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAdd} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AttendanceTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [selectedTs, setSelectedTs] = useState<HrTimesheet | null>(null)
  const [showAddTs, setShowAddTs] = useState(false)
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tsForm, setTsForm] = useState({ employee_id:'', week_start_date:'', week_end_date:'' })
  const [entryForm, setEntryForm] = useState({ employee_id:'', timesheet_id:'', entry_date:'', hours_worked:'8', is_overtime: false, entry_type:'REGULAR', notes:'' })

  const { data: timesheets = [] } = useQuery({ queryKey: ['hr-timesheets', entityId], queryFn: () => a.getTimesheets({ limit: 100 }) })
  const { data: entries = [] } = useQuery({ queryKey: ['hr-time-entries', entityId, selectedTs?.id], queryFn: () => a.getTimeEntries({ timesheet_id: selectedTs!.id, limit: 100 }), enabled: !!selectedTs })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  async function handleAddTs() {
    setSaving(true); setError('')
    try {
      const ts = await a.createTimesheet(tsForm)
      setShowAddTs(false); setSelectedTs(ts); void qc.invalidateQueries({ queryKey: ['hr-timesheets', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleAddEntry() {
    setSaving(true); setError('')
    try {
      await a.createTimeEntry({ ...entryForm, hours_worked: parseFloat(entryForm.hours_worked), timesheet_id: entryForm.timesheet_id || undefined })
      setShowAddEntry(false); if (selectedTs) void qc.invalidateQueries({ queryKey: ['hr-time-entries', entityId, selectedTs.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function patchStatus(action: 'submit'|'approve'|'reject', ts: HrTimesheet) {
    if (action === 'submit') await a.submitTimesheet(ts.id)
    else if (action === 'approve') await a.approveTimesheet(ts.id)
    else await a.rejectTimesheet(ts.id, { rejection_reason: 'Rejected' })
    void qc.invalidateQueries({ queryKey: ['hr-timesheets', entityId] })
  }

  const TS_STATUS: Record<string, string> = {
    DRAFT:     'bg-slate-700 text-slate-300 border-slate-500',
    SUBMITTED: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    APPROVED:  'bg-green-900/50 text-green-300 border-green-700',
    REJECTED:  'bg-red-900/50 text-red-400 border-red-700',
  }

  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className={`${selectedTs ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0`}>
        <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddTs(true)}>{t('hr.newTimesheet')}</button>
        <div className="space-y-1 overflow-y-auto">
          {(timesheets as HrTimesheet[]).map(ts => (
            <button key={ts.id} onClick={() => setSelectedTs(ts)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${selectedTs?.id === ts.id ? 'bg-blue-900/40 border border-blue-700' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <div className="font-medium text-slate-100">{ts.employee_name}</div>
              <div className="text-xs text-slate-400">{fmtDate(ts.week_start_date)} – {fmtDate(ts.week_end_date)}</div>
              <div className="mt-1 flex gap-2 items-center">
                <Badge text={ts.status} cls={TS_STATUS[ts.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} />
                {ts.total_hours && <span className="text-xs text-slate-400">{fmtN(ts.total_hours)}h</span>}
              </div>
            </button>
          ))}
          {timesheets.length === 0 && <p className="text-sm text-slate-500 italic">{t('common.noRecords')}</p>}
        </div>
      </div>

      {selectedTs && (
        <div className="flex-1 bg-slate-800 rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <button className="md:hidden text-sm text-blue-400 mb-2" onClick={() => setSelectedTs(null)}>← {t('common.back')}</button>
              <h3 className="font-semibold text-slate-100">{selectedTs.employee_name}</h3>
              <p className="text-sm text-slate-400">{fmtDate(selectedTs.week_start_date)} – {fmtDate(selectedTs.week_end_date)}</p>
              <div className="mt-1 flex gap-2">
                <Badge text={selectedTs.status} cls={TS_STATUS[selectedTs.status] ?? 'bg-slate-700 text-slate-300 border-slate-500'} />
                {selectedTs.total_hours && <span className="text-sm text-slate-300">{fmtN(selectedTs.total_hours)}h total</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={() => { setEntryForm(ef => ({ ...ef, employee_id: selectedTs.employee_id, timesheet_id: selectedTs.id })); setShowAddEntry(true) }}>{t('hr.addEntry')}</button>
              {selectedTs.status === 'DRAFT'     && <button className={btnSecondary} onClick={() => patchStatus('submit', selectedTs)}>{t('hr.submit')}</button>}
              {selectedTs.status === 'SUBMITTED' && <button className={btnSecondary} onClick={() => patchStatus('approve', selectedTs)}>{t('common.approve')}</button>}
              {selectedTs.status === 'SUBMITTED' && <button className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-sm rounded" onClick={() => patchStatus('reject', selectedTs)}>{t('common.reject')}</button>}
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
                {['hr.date','hr.hours','hr.type','hr.overtime','common.notes'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
              </tr></thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2 text-slate-100">{fmtDate(entry.entry_date)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmtN(entry.hours_worked)}h</td>
                    <td className="px-3 py-2 text-slate-300">{entry.entry_type.replace('_',' ')}</td>
                    <td className="px-3 py-2">{entry.is_overtime ? <span className="text-orange-400">OT</span> : '—'}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{entry.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
          </div>
        </div>
      )}

      {showAddTs && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.newTimesheet')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.employee')}>
                <select className={cls} value={tsForm.employee_id} onChange={e => setTsForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
              </Field>
              <Field label={t('hr.weekStart')}><input type="date" className={cls} value={tsForm.week_start_date} onChange={e => setTsForm(f => ({ ...f, week_start_date: e.target.value }))} /></Field>
              <Field label={t('hr.weekEnd')}><input type="date" className={cls} value={tsForm.week_end_date} onChange={e => setTsForm(f => ({ ...f, week_end_date: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddTs(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddTs} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {showAddEntry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addEntry')}</h3>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <Field label={t('hr.date')}><input type="date" className={cls} value={entryForm.entry_date} onChange={e => setEntryForm(f => ({ ...f, entry_date: e.target.value }))} /></Field>
              <Field label={t('hr.hours')}><input type="number" step="0.5" className={cls} value={entryForm.hours_worked} onChange={e => setEntryForm(f => ({ ...f, hours_worked: e.target.value }))} /></Field>
              <Field label={t('hr.entryType')}>
                <select className={cls} value={entryForm.entry_type} onChange={e => setEntryForm(f => ({ ...f, entry_type: e.target.value }))}>
                  {['REGULAR','OVERTIME','PUBLIC_HOLIDAY','SICK','OTHER'].map(v => <option key={v} value={v}>{v.replace('_',' ')}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={entryForm.is_overtime} onChange={e => setEntryForm(f => ({ ...f, is_overtime: e.target.checked }))} />
                {t('hr.overtime')}
              </label>
              <Field label={t('common.notes')}><input className={cls} value={entryForm.notes} onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))} /></Field>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowAddEntry(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleAddEntry} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function HR() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('employees')
  const [selectedEntityId, setSelectedEntityId] = useState(HR_ENTITIES[0].id)

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="flex flex-wrap items-start gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-100 mb-1">{t('hr.title')}</h1>
          <p className="text-sm text-slate-400">{t('hr.subtitle')}</p>
        </div>
        <div className="flex-shrink-0">
          <label className="text-xs text-slate-400 block mb-1">{t('hr.company')}</label>
          <select
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={selectedEntityId}
            onChange={e => setSelectedEntityId(e.target.value)}
          >
            {HR_ENTITIES.map(ent => <option key={ent.id} value={ent.id}>{ent.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-700 mb-5 gap-1">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap pb-2 px-3 text-sm border-b-2 ${activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t(`hr.tab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0">
        {activeTab === 'employees'   && <EmployeesTab entityId={selectedEntityId} />}
        {activeTab === 'payroll'     && <PayrollTab entityId={selectedEntityId} />}
        {activeTab === 'leave'       && <LeaveTab entityId={selectedEntityId} />}
        {activeTab === 'performance' && <PerformanceTab entityId={selectedEntityId} />}
        {activeTab === 'recruitment' && <RecruitmentTab entityId={selectedEntityId} />}
        {activeTab === 'training'    && <TrainingTab entityId={selectedEntityId} />}
        {activeTab === 'disciplinary'&& <DisciplinaryTab entityId={selectedEntityId} />}
        {activeTab === 'attendance'  && <AttendanceTab entityId={selectedEntityId} />}
      </div>
    </div>
  )
}
