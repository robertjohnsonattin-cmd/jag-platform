import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { hrApiFor } from '../api/hr'
import { glApi } from '../api/gl'
import { fmtTTD, fmtDate } from '../lib/entities'
import type {
  HrEmployee, HrDepartment, HrPosition,
  HrLeaveRequest, HrLeaveBalance, HrLeaveType,
  HrPayrollRun, HrPayrollEntry,
  HrPerformanceReview,
  HrTrainingType,
  HrDisciplinaryRecord,
  HrJobPosting, HrJobApplication,
  HrTimesheet, HrTimeEntry,
  HrSalaryAdvance, HrStaffLoan,
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
const btnPrimary = 'px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded'
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

const TT_TZ = 'America/Port_of_Spain'

// Current calendar date in Trinidad time as YYYY-MM-DD (not UTC — matters near midnight TT)
function todayTT(): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit', timeZone: TT_TZ })
}

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = ['employees','payroll','advances_loans','leave','performance','recruitment','training','disciplinary','attendance'] as const

// Tabs grouped into short sections for the nav — a single 9-wide strip was
// cramped on mobile, this splits it into a section row + a shorter tab row.
const TAB_GROUPS: { id: string; labelKey: string; tabs: readonly (typeof TABS)[number][] }[] = [
  { id: 'people',      labelKey: 'hr.group_people',      tabs: ['employees', 'recruitment'] },
  { id: 'time_pay',     labelKey: 'hr.group_timePay',     tabs: ['payroll', 'advances_loans', 'attendance'] },
  { id: 'growth',       labelKey: 'hr.group_growth',      tabs: ['leave', 'performance', 'training'] },
  { id: 'conduct',      labelKey: 'hr.group_conduct',     tabs: ['disciplinary'] },
]
const TAB_TO_GROUP = new Map(TAB_GROUPS.flatMap(g => g.tabs.map(tb => [tb, g.id] as const)))
type Tab = typeof TABS[number]

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function EmployeesTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [empSubTab, setEmpSubTab] = useState<'employees'|'departments'|'positions'>('employees')
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
  // Dept management
  const [showAddDept, setShowAddDept] = useState(false)
  const [deptForm, setDeptForm] = useState({ name:'', code:'' })
  // Position management
  const [showAddPos, setShowAddPos] = useState(false)
  const [posForm, setPosForm] = useState({ name:'', code:'', department_id:'', min_salary_ttd:'', max_salary_ttd:'' })

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

  async function handleAddDept() {
    setSaving(true); setError('')
    try {
      await a.createDepartment(deptForm)
      setShowAddDept(false); setDeptForm({ name:'', code:'' })
      void qc.invalidateQueries({ queryKey: ['hr-departments', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleDeleteDept(id: string) {
    try { await a.deleteDepartment(id); void qc.invalidateQueries({ queryKey: ['hr-departments', entityId] }) }
    catch (e: unknown) { setError((e as Error).message) }
  }

  async function handleAddPos() {
    setSaving(true); setError('')
    try {
      await a.createPosition({ ...posForm, department_id: posForm.department_id || undefined, min_salary_ttd: posForm.min_salary_ttd ? parseFloat(posForm.min_salary_ttd) : undefined, max_salary_ttd: posForm.max_salary_ttd ? parseFloat(posForm.max_salary_ttd) : undefined })
      setShowAddPos(false); setPosForm({ name:'', code:'', department_id:'', min_salary_ttd:'', max_salary_ttd:'' })
      void qc.invalidateQueries({ queryKey: ['hr-positions', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleDeletePos(id: string) {
    try { await a.deletePosition(id); void qc.invalidateQueries({ queryKey: ['hr-positions', entityId] }) }
    catch (e: unknown) { setError((e as Error).message) }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-slate-700 overflow-x-auto">
        {(['employees','departments','positions'] as const).map(st => (
          <button key={st} onClick={() => setEmpSubTab(st)}
            className={`pb-2 px-3 text-sm border-b-2 capitalize whitespace-nowrap ${empSubTab === st ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t(`hr.sub_${st}`)}
          </button>
        ))}
      </div>

      {/* ── Departments panel ── */}
      {empSubTab === 'departments' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-400">{t('hr.departmentsHint')}</p>
            <button className={btnPrimary} onClick={() => setShowAddDept(true)}>+ {t('hr.addDepartment')}</button>
          </div>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="py-2 px-3">{t('common.name')}</th>
                <th className="py-2 px-3">{t('hr.code')}</th>
                <th className="py-2 px-3">{t('hr.employees')}</th>
                <th className="py-2 px-3"></th>
              </tr></thead>
              <tbody>
                {(depts as HrDepartment[]).map(d => (
                  <tr key={d.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-2 px-3 text-slate-100 font-medium">{d.name}</td>
                    <td className="py-2 px-3 text-slate-400">{d.code ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-400">{d.employee_count ?? 0}</td>
                    <td className="py-2 px-3 text-right">
                      <button className="text-xs text-red-400 hover:underline" onClick={() => void handleDeleteDept(d.id)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
                {depts.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-500 italic">{t('common.noRecords')}</td></tr>}
              </tbody>
            </table>
          </div>

          {showAddDept && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
                <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addDepartment')}</h3>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="space-y-3">
                  <Field label={t('common.name')}><input className={cls} value={deptForm.name} onChange={e => setDeptForm(f => ({ ...f, name: e.target.value }))} /></Field>
                  <Field label={`${t('hr.code')} (${t('common.optional')})`}><input className={cls} value={deptForm.code} onChange={e => setDeptForm(f => ({ ...f, code: e.target.value }))} /></Field>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button className={btnSecondary} onClick={() => setShowAddDept(false)}>{t('common.cancel')}</button>
                  <button className={btnPrimary} onClick={handleAddDept} disabled={saving || !deptForm.name}>{saving ? t('common.saving') : t('common.save')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Positions panel ── */}
      {empSubTab === 'positions' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-400">{t('hr.positionsHint')}</p>
            <button className={btnPrimary} onClick={() => setShowAddPos(true)}>+ {t('hr.addPosition')}</button>
          </div>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="py-2 px-3">{t('common.name')}</th>
                <th className="py-2 px-3">{t('hr.code')}</th>
                <th className="py-2 px-3">{t('hr.department')}</th>
                <th className="py-2 px-3">{t('hr.salaryRange')}</th>
                <th className="py-2 px-3"></th>
              </tr></thead>
              <tbody>
                {(positions as HrPosition[]).map(p => (
                  <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-2 px-3 text-slate-100 font-medium">{p.name}</td>
                    <td className="py-2 px-3 text-slate-400">{p.code ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-400">{(depts as HrDepartment[]).find(d => d.id === p.department_id)?.name ?? '—'}</td>
                    <td className="py-2 px-3 text-slate-400">{p.min_salary_ttd ? `$${parseFloat(String(p.min_salary_ttd)).toLocaleString()} – $${parseFloat(String(p.max_salary_ttd ?? p.min_salary_ttd)).toLocaleString()}` : '—'}</td>
                    <td className="py-2 px-3 text-right">
                      <button className="text-xs text-red-400 hover:underline" onClick={() => void handleDeletePos(p.id)}>{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500 italic">{t('common.noRecords')}</td></tr>}
              </tbody>
            </table>
          </div>

          {showAddPos && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-slate-800 rounded-xl p-5 w-full max-w-sm border border-slate-600">
                <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('hr.addPosition')}</h3>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="space-y-3">
                  <Field label={t('common.name')}><input className={cls} value={posForm.name} onChange={e => setPosForm(f => ({ ...f, name: e.target.value }))} /></Field>
                  <Field label={`${t('hr.code')} (${t('common.optional')})`}><input className={cls} value={posForm.code} onChange={e => setPosForm(f => ({ ...f, code: e.target.value }))} /></Field>
                  <Field label={`${t('hr.department')} (${t('common.optional')})`}>
                    <select className={cls} value={posForm.department_id} onChange={e => setPosForm(f => ({ ...f, department_id: e.target.value }))}>
                      <option value="">— {t('hr.noDepartment')} —</option>
                      {(depts as HrDepartment[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t('hr.minSalary')}><input type="number" className={cls} value={posForm.min_salary_ttd} onChange={e => setPosForm(f => ({ ...f, min_salary_ttd: e.target.value }))} /></Field>
                    <Field label={t('hr.maxSalary')}><input type="number" className={cls} value={posForm.max_salary_ttd} onChange={e => setPosForm(f => ({ ...f, max_salary_ttd: e.target.value }))} /></Field>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button className={btnSecondary} onClick={() => setShowAddPos(false)}>{t('common.cancel')}</button>
                  <button className={btnPrimary} onClick={handleAddPos} disabled={saving || !posForm.name}>{saving ? t('common.saving') : t('common.save')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Employees panel ── */}
      {empSubTab === 'employees' && <div className="flex flex-col md:flex-row gap-4">
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

          <div className="flex gap-2 border-b border-slate-700 mb-3 overflow-x-auto">
            {(['info','contacts','history'] as const).map(tab => (
              <button key={tab} onClick={() => setDetailTab(tab)}
                className={`pb-2 px-1 text-sm capitalize border-b-2 whitespace-nowrap ${detailTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
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
      </div>}
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type GlFieldKey =
  | 'salary_expense_account_id'
  | 'nis_expense_account_id'
  | 'salaries_payable_account_id'
  | 'nis_payable_account_id'
  | 'paye_payable_account_id'
  | 'health_surcharge_payable_account_id'

const GL_FIELDS: Array<{ key: GlFieldKey; labelKey: string; type: 'EXPENSE' | 'LIABILITY'; required: boolean }> = [
  { key: 'salary_expense_account_id',        labelKey: 'hr.glSalaryExpense',        type: 'EXPENSE',   required: true },
  { key: 'salaries_payable_account_id',      labelKey: 'hr.glSalariesPayable',      type: 'LIABILITY', required: true },
  { key: 'nis_expense_account_id',           labelKey: 'hr.glNisExpense',           type: 'EXPENSE',   required: false },
  { key: 'nis_payable_account_id',           labelKey: 'hr.glNisPayable',           type: 'LIABILITY', required: false },
  { key: 'paye_payable_account_id',          labelKey: 'hr.glPayePayable',          type: 'LIABILITY', required: false },
  { key: 'health_surcharge_payable_account_id', labelKey: 'hr.glHealthSurchargePayable', type: 'LIABILITY', required: false },
]

const EMPTY_GL_ACCOUNT_IDS: Record<GlFieldKey, string> = {
  salary_expense_account_id: '',
  nis_expense_account_id: '',
  salaries_payable_account_id: '',
  nis_payable_account_id: '',
  paye_payable_account_id: '',
  health_surcharge_payable_account_id: '',
}

function PayrollTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const now = new Date()
  const [selectedRun, setSelectedRun] = useState<HrPayrollRun | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ period_month: String(now.getMonth() + 1), period_year: String(now.getFullYear()), pay_date: '' })
  const [showFinalize, setShowFinalize] = useState(false)
  const [finalizeDate, setFinalizeDate] = useState('')
  const [glAccountIds, setGlAccountIds] = useState<Record<GlFieldKey, string>>(EMPTY_GL_ACCOUNT_IDS)
  const [editingEntry, setEditingEntry] = useState<HrPayrollEntry | null>(null)
  const [entryForm, setEntryForm] = useState({
    base_salary_ttd: '', overtime_hours: '', overtime_rate_ttd: '',
    bonus_ttd: '', other_allowances_ttd: '', other_deductions_ttd: '',
    unpaid_leave_days: '', status: 'INCLUDED' as 'INCLUDED' | 'EXCLUDED', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: runs = [] } = useQuery({ queryKey: ['hr-payroll-runs', entityId], queryFn: () => a.getPayrollRuns({ limit: 50 }) })
  const { data: runDetail } = useQuery({ queryKey: ['hr-payroll-run', entityId, selectedRun?.id], queryFn: () => a.getPayrollRun(selectedRun!.id), enabled: !!selectedRun })
  const entries = runDetail?.entries ?? []
  const { data: glAccounts = [] } = useQuery({ queryKey: ['gl-accounts', entityId], queryFn: () => glApi.getAccounts({ owner_entity_id: entityId, is_active: 'true' }) })

  // Recall last-used GL account mapping for this entity (payroll runs monthly with the same accounts)
  useEffect(() => {
    const saved = localStorage.getItem(`hr-payroll-gl-accounts-${entityId}`)
    if (!saved) { setGlAccountIds(EMPTY_GL_ACCOUNT_IDS); return }
    try { setGlAccountIds({ ...EMPTY_GL_ACCOUNT_IDS, ...JSON.parse(saved) }) }
    catch { setGlAccountIds(EMPTY_GL_ACCOUNT_IDS) }
  }, [entityId])

  const missingRequiredGl = GL_FIELDS.filter(f => f.required && !glAccountIds[f.key])

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
      void qc.invalidateQueries({ queryKey: ['hr-payroll-run', entityId, selectedRun.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  function openFinalize() {
    if (!selectedRun) return
    setFinalizeDate(selectedRun.pay_date?.slice(0, 10) || new Date().toISOString().slice(0, 10))
    setError('')
    setShowFinalize(true)
  }

  async function handleFinalize() {
    if (!selectedRun || !DATE_RE.test(finalizeDate)) { setError(t('hr.payDateRequired')); return }
    setSaving(true); setError('')
    try {
      localStorage.setItem(`hr-payroll-gl-accounts-${entityId}`, JSON.stringify(glAccountIds))
      const payload: { pay_date: string } & Partial<Record<GlFieldKey, string>> = { pay_date: finalizeDate }
      for (const f of GL_FIELDS) { if (glAccountIds[f.key]) payload[f.key] = glAccountIds[f.key] }
      const updated = await a.finalizePayrollRun(selectedRun.id, payload)
      setSelectedRun(updated); setShowFinalize(false)
      void qc.invalidateQueries({ queryKey: ['hr-payroll-runs', entityId] })
      void qc.invalidateQueries({ queryKey: ['hr-payroll-run', entityId, selectedRun.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  function openEditEntry(entry: HrPayrollEntry) {
    setEditingEntry(entry)
    setEntryForm({
      base_salary_ttd:      entry.base_salary_ttd ?? '0',
      overtime_hours:       entry.overtime_hours ?? '0',
      overtime_rate_ttd:    entry.overtime_rate_ttd ?? '0',
      bonus_ttd:            entry.bonus_ttd ?? '0',
      other_allowances_ttd: entry.other_allowances_ttd ?? '0',
      other_deductions_ttd: entry.other_deductions_ttd ?? '0',
      unpaid_leave_days:    entry.unpaid_leave_days ?? '0',
      status:               entry.status,
      notes:                entry.notes ?? '',
    })
    setError('')
  }

  async function handleSaveEntry() {
    if (!selectedRun || !editingEntry) return
    setSaving(true); setError('')
    try {
      await a.updatePayrollEntry(selectedRun.id, editingEntry.id, {
        base_salary_ttd:      parseFloat(entryForm.base_salary_ttd || '0'),
        overtime_hours:       parseFloat(entryForm.overtime_hours || '0'),
        overtime_rate_ttd:    parseFloat(entryForm.overtime_rate_ttd || '0'),
        bonus_ttd:            parseFloat(entryForm.bonus_ttd || '0'),
        other_allowances_ttd: parseFloat(entryForm.other_allowances_ttd || '0'),
        other_deductions_ttd: parseFloat(entryForm.other_deductions_ttd || '0'),
        unpaid_leave_days:    parseFloat(entryForm.unpaid_leave_days || '0'),
        status:               entryForm.status,
        notes:                entryForm.notes || undefined,
      })
      // Re-run statutory calculation so NIS/PAYE/health surcharge and totals reflect the new figures
      const updatedRun = await a.calculatePayrollRun(selectedRun.id)
      setSelectedRun(updatedRun)
      setEditingEntry(null)
      void qc.invalidateQueries({ queryKey: ['hr-payroll-runs', entityId] })
      void qc.invalidateQueries({ queryKey: ['hr-payroll-run', entityId, selectedRun.id] })
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
                  <button className={btnPrimary} onClick={openFinalize} disabled={saving || entries.length === 0}>{t('hr.finalize')}</button>
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
                {selectedRun.status === 'DRAFT' && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody>
                {(entries as HrPayrollEntry[]).map(entry => (
                  <tr key={entry.id} className={`border-b border-slate-700/50 ${entry.status === 'EXCLUDED' ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 text-slate-100">
                      {entry.employee_name ?? '—'}
                      <div className="text-xs text-slate-400">{entry.employee_number}</div>
                      {entry.status === 'EXCLUDED' && <Badge text={t('hr.excluded')} cls="bg-slate-700 text-slate-400 border-slate-600 mt-1" />}
                    </td>
                    <td className="px-3 py-2">{fmt(entry.total_gross_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.nis_employee_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.health_surcharge_ttd)}</td>
                    <td className="px-3 py-2">{fmt(entry.paye_ttd)}</td>
                    <td className="px-3 py-2 font-medium text-green-300">{fmt(entry.net_pay_ttd)}</td>
                    {selectedRun.status === 'DRAFT' && (
                      <td className="px-3 py-2">
                        <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => openEditEntry(entry)}>{t('hr.editPay')}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && <p className="text-sm text-slate-500 italic p-4">{t('common.noRecords')}</p>}
          </div>
        </div>
      )}

      {editingEntry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-md border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-1">{editingEntry.employee_name}</h3>
            <p className="text-sm text-slate-400 mb-4">{t('hr.editPayHint')}</p>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('hr.status')}>
                <select className={cls} value={entryForm.status} onChange={e => setEntryForm(f => ({ ...f, status: e.target.value as 'INCLUDED' | 'EXCLUDED' }))}>
                  <option value="INCLUDED">{t('hr.included')}</option>
                  <option value="EXCLUDED">{t('hr.excluded')}</option>
                </select>
              </Field>
              <Field label={t('hr.salary')}>
                <input type="number" step="0.01" className={cls} value={entryForm.base_salary_ttd} onChange={e => setEntryForm(f => ({ ...f, base_salary_ttd: e.target.value }))} />
              </Field>
              <Field label={t('hr.overtimeHours')}>
                <input type="number" step="0.01" className={cls} value={entryForm.overtime_hours} onChange={e => setEntryForm(f => ({ ...f, overtime_hours: e.target.value }))} />
              </Field>
              <Field label={t('hr.overtimeRate')}>
                <input type="number" step="0.01" className={cls} value={entryForm.overtime_rate_ttd} onChange={e => setEntryForm(f => ({ ...f, overtime_rate_ttd: e.target.value }))} />
              </Field>
              <Field label={t('hr.bonus')}>
                <input type="number" step="0.01" className={cls} value={entryForm.bonus_ttd} onChange={e => setEntryForm(f => ({ ...f, bonus_ttd: e.target.value }))} />
              </Field>
              <Field label={t('hr.otherAllowances')}>
                <input type="number" step="0.01" className={cls} value={entryForm.other_allowances_ttd} onChange={e => setEntryForm(f => ({ ...f, other_allowances_ttd: e.target.value }))} />
              </Field>
              <Field label={t('hr.otherDeductions')}>
                <input type="number" step="0.01" className={cls} value={entryForm.other_deductions_ttd} onChange={e => setEntryForm(f => ({ ...f, other_deductions_ttd: e.target.value }))} />
              </Field>
              <Field label={t('hr.unpaidLeaveDays')}>
                <input type="number" step="0.5" className={cls} value={entryForm.unpaid_leave_days} onChange={e => setEntryForm(f => ({ ...f, unpaid_leave_days: e.target.value }))} />
              </Field>
              <div className="col-span-2">
                <Field label={t('hr.notes')}>
                  <textarea className={cls} rows={2} value={entryForm.notes} onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))} />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setEditingEntry(null)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleSaveEntry} disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
            </div>
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

      {showFinalize && selectedRun && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-5 w-full max-w-lg border border-slate-600 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-100 mb-1">{t('hr.finalize')}</h3>
            <p className="text-sm text-slate-400 mb-4">{t('hr.finalizeHint')}</p>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <Field label={t('hr.payDate')}>
              <input type="date" className={cls} value={finalizeDate} onChange={e => setFinalizeDate(e.target.value)} />
            </Field>

            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-xs text-slate-400 mb-2">{t('hr.glAccountsHint')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GL_FIELDS.map(f => (
                  <Field key={f.key} label={`${t(f.labelKey)}${f.required ? ' *' : ''}`}>
                    <select
                      className={cls}
                      value={glAccountIds[f.key]}
                      onChange={e => setGlAccountIds(g => ({ ...g, [f.key]: e.target.value }))}
                    >
                      <option value="">{t('common.none')}</option>
                      {glAccounts.filter(ac => ac.account_type === f.type).map(ac => (
                        <option key={ac.id} value={ac.id}>{ac.account_code} — {ac.account_name}</option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              {missingRequiredGl.length > 0 && (
                <p className="text-amber-400 text-xs mt-2">
                  {t('hr.glMissingWarning', { accounts: missingRequiredGl.map(f => t(f.labelKey)).join(', ') })}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button className={btnSecondary} onClick={() => setShowFinalize(false)}>{t('common.cancel')}</button>
              <button className={btnPrimary} onClick={handleFinalize} disabled={saving || !DATE_RE.test(finalizeDate)}>{saving ? t('common.saving') : t('hr.finalize')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCES & LOANS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AdvancesLoansTab({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const a = useMemo(() => hrApiFor(entityId), [entityId])
  const [subTab, setSubTab] = useState<'advances'|'loans'>('advances')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Advances state
  const [showAddAdv, setShowAddAdv] = useState(false)
  const [advForm, setAdvForm] = useState({ employee_id:'', advance_date:'', amount_ttd:'', recovery_installment_ttd:'', reason:'', approved_by:'' })

  // Loans state
  const [showAddLoan, setShowAddLoan] = useState(false)
  const [loanForm, setLoanForm] = useState({ employee_id:'', loan_date:'', principal_ttd:'', interest_rate:'0', monthly_installment_ttd:'', reason:'', approved_by:'' })

  const { data: advances = [] } = useQuery({ queryKey: ['hr-advances', entityId], queryFn: () => a.getAdvances({ limit: 200 }) })
  const { data: loans = [] }    = useQuery({ queryKey: ['hr-loans', entityId],    queryFn: () => a.getLoans({ limit: 200 }) })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status:'ACTIVE', limit:200 }) })

  const fmt = (v: string | null | undefined) => v ? parseFloat(v).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'

  async function handleAddAdvance() {
    setSaving(true); setError('')
    try {
      await a.createAdvance({ ...advForm, amount_ttd: parseFloat(advForm.amount_ttd), recovery_installment_ttd: parseFloat(advForm.recovery_installment_ttd) })
      setShowAddAdv(false); setAdvForm({ employee_id:'', advance_date:'', amount_ttd:'', recovery_installment_ttd:'', reason:'', approved_by:'' })
      void qc.invalidateQueries({ queryKey: ['hr-advances', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleCancelAdvance(id: string) {
    try { await a.cancelAdvance(id); void qc.invalidateQueries({ queryKey: ['hr-advances', entityId] }) }
    catch (e: unknown) { setError((e as Error).message) }
  }

  async function handleAddLoan() {
    setSaving(true); setError('')
    try {
      await a.createLoan({ ...loanForm, principal_ttd: parseFloat(loanForm.principal_ttd), interest_rate: parseFloat(loanForm.interest_rate || '0'), monthly_installment_ttd: parseFloat(loanForm.monthly_installment_ttd) })
      setShowAddLoan(false); setLoanForm({ employee_id:'', loan_date:'', principal_ttd:'', interest_rate:'0', monthly_installment_ttd:'', reason:'', approved_by:'' })
      void qc.invalidateQueries({ queryKey: ['hr-loans', entityId] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleCancelLoan(id: string) {
    try { await a.cancelLoan(id); void qc.invalidateQueries({ queryKey: ['hr-loans', entityId] }) }
    catch (e: unknown) { setError((e as Error).message) }
  }

  const ADV_STATUS: Record<string, string> = {
    ACTIVE:      'bg-blue-900/50 text-blue-300 border-blue-700',
    RECOVERED:   'bg-green-900/50 text-green-300 border-green-700',
    WRITTEN_OFF: 'bg-red-900/50 text-red-300 border-red-700',
    CANCELLED:   'bg-slate-700 text-slate-400 border-slate-600',
  }

  return (
    <div>
      {/* Sub-tab switcher */}
      <div className="flex gap-1 mb-4 border-b border-slate-700 pb-2 overflow-x-auto">
        {(['advances','loans'] as const).map(st => (
          <button key={st} onClick={() => setSubTab(st)}
            className={`px-3 py-1 rounded text-sm font-medium whitespace-nowrap ${subTab===st ? 'bg-blue-700 text-white' : 'text-slate-400 hover:text-white'}`}>
            {st === 'advances' ? t('hr.salaryAdvances') : t('hr.staffLoans')}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {/* ── Advances ── */}
      {subTab === 'advances' && (
        <div>
          <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddAdv(true)}>{t('hr.recordAdvance')}</button>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  {['Employee','Date','Amount (TTD)','Installment','Recovered','Outstanding','Status',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {(advances as HrSalaryAdvance[]).map(adv => (
                  <tr key={adv.id} className="hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-medium">{adv.employee_name}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtDate(adv.advance_date)}</td>
                    <td className="px-3 py-2">{fmt(adv.amount_ttd)}</td>
                    <td className="px-3 py-2">{fmt(adv.recovery_installment_ttd)}</td>
                    <td className="px-3 py-2 text-green-400">{fmt(adv.total_recovered_ttd)}</td>
                    <td className="px-3 py-2 text-amber-400">{fmt(adv.outstanding_ttd)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${ADV_STATUS[adv.status] ?? ''}`}>{adv.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {adv.status === 'ACTIVE' && (
                        <button className="text-xs text-red-400 hover:underline" onClick={() => void handleCancelAdvance(adv.id)}>{t('common.cancel')}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {advances.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{t('common.noRecords')}</td></tr>}
              </tbody>
            </table>
          </div>

          {showAddAdv && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-slate-900 rounded-xl p-6 w-full max-w-md border border-slate-700">
                <h3 className="text-lg font-semibold mb-4">{t('hr.recordAdvance')}</h3>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.employee')}</label>
                    <select className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.employee_id} onChange={evt => setAdvForm(f => ({ ...f, employee_id: evt.target.value }))}>
                      <option value="">— {t('common.select')} —</option>
                      {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.advanceDate')}</label>
                      <input type="date" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.advance_date} onChange={evt => setAdvForm(f => ({ ...f, advance_date: evt.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.amount')} (TTD)</label>
                      <input type="number" min="1" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.amount_ttd} onChange={evt => setAdvForm(f => ({ ...f, amount_ttd: evt.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.recoveryInstallment')} (TTD/{t('hr.payPeriod')})</label>
                    <input type="number" min="1" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.recovery_installment_ttd} onChange={evt => setAdvForm(f => ({ ...f, recovery_installment_ttd: evt.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.reason')}</label>
                    <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.reason} onChange={evt => setAdvForm(f => ({ ...f, reason: evt.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.approvedBy')}</label>
                    <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={advForm.approved_by} onChange={evt => setAdvForm(f => ({ ...f, approved_by: evt.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-3 mt-5 justify-end">
                  <button className={btnSecondary} onClick={() => setShowAddAdv(false)}>{t('common.cancel')}</button>
                  <button className={btnPrimary} disabled={saving || !advForm.employee_id || !advForm.amount_ttd || !advForm.recovery_installment_ttd} onClick={() => void handleAddAdvance()}>{saving ? t('common.saving') : t('common.save')}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Loans ── */}
      {subTab === 'loans' && (
        <div>
          <button className={`${btnPrimary} mb-3`} onClick={() => setShowAddLoan(true)}>{t('hr.recordLoan')}</button>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  {['Employee','Date','Principal (TTD)','Installment/mo','Repaid','Balance','Status',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {(loans as HrStaffLoan[]).map(loan => (
                  <tr key={loan.id} className="hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-medium">{loan.employee_name}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtDate(loan.loan_date)}</td>
                    <td className="px-3 py-2">{fmt(loan.principal_ttd)}</td>
                    <td className="px-3 py-2">{fmt(loan.monthly_installment_ttd)}</td>
                    <td className="px-3 py-2 text-green-400">{fmt(loan.total_repaid_ttd)}</td>
                    <td className="px-3 py-2 text-amber-400">{fmt(loan.outstanding_balance_ttd)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${ADV_STATUS[loan.status] ?? ''}`}>{loan.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {loan.status === 'ACTIVE' && (
                        <button className="text-xs text-red-400 hover:underline" onClick={() => void handleCancelLoan(loan.id)}>{t('common.cancel')}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {loans.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{t('common.noRecords')}</td></tr>}
              </tbody>
            </table>
          </div>

          {showAddLoan && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-slate-900 rounded-xl p-6 w-full max-w-md border border-slate-700">
                <h3 className="text-lg font-semibold mb-4">{t('hr.recordLoan')}</h3>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.employee')}</label>
                    <select className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.employee_id} onChange={evt => setLoanForm(f => ({ ...f, employee_id: evt.target.value }))}>
                      <option value="">— {t('common.select')} —</option>
                      {(employees as HrEmployee[]).map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.loanDate')}</label>
                      <input type="date" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.loan_date} onChange={evt => setLoanForm(f => ({ ...f, loan_date: evt.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.principal')} (TTD)</label>
                      <input type="number" min="1" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.principal_ttd} onChange={evt => setLoanForm(f => ({ ...f, principal_ttd: evt.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.monthlyInstallment')} (TTD)</label>
                      <input type="number" min="1" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.monthly_installment_ttd} onChange={evt => setLoanForm(f => ({ ...f, monthly_installment_ttd: evt.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{t('hr.interestRate')} (%)</label>
                      <input type="number" min="0" step="0.1" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.interest_rate} onChange={evt => setLoanForm(f => ({ ...f, interest_rate: evt.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.reason')}</label>
                    <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.reason} onChange={evt => setLoanForm(f => ({ ...f, reason: evt.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{t('hr.approvedBy')}</label>
                    <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" value={loanForm.approved_by} onChange={evt => setLoanForm(f => ({ ...f, approved_by: evt.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-3 mt-5 justify-end">
                  <button className={btnSecondary} onClick={() => setShowAddLoan(false)}>{t('common.cancel')}</button>
                  <button className={btnPrimary} disabled={saving || !loanForm.employee_id || !loanForm.principal_ttd || !loanForm.monthly_installment_ttd} onClick={() => void handleAddLoan()}>{saving ? t('common.saving') : t('common.save')}</button>
                </div>
              </div>
            </div>
          )}
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
      <div className="flex gap-2 border-b border-slate-700 mb-4 overflow-x-auto">
        {(['requests','balances','types'] as const).map(st => (
          <button key={st} onClick={() => setLeaveSubTab(st)}
            className={`pb-2 px-3 text-sm capitalize border-b-2 whitespace-nowrap ${leaveSubTab === st ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
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
  const [breakMinutes, setBreakMinutes] = useState('0')

  const { data: timesheets = [] } = useQuery({ queryKey: ['hr-timesheets', entityId], queryFn: () => a.getTimesheets({ limit: 100 }) })
  const { data: entries = [] } = useQuery({ queryKey: ['hr-time-entries', entityId, selectedTs?.id], queryFn: () => a.getTimeEntries({ timesheet_id: selectedTs!.id, limit: 100 }), enabled: !!selectedTs })
  const { data: employees = [] } = useQuery({ queryKey: ['hr-employees-active', entityId], queryFn: () => a.getEmployees({ status: 'ACTIVE', limit: 200 }) })

  const todayStr = todayTT()
  const todayEntry = (entries as HrTimeEntry[]).find(e => e.entry_date.slice(0, 10) === todayStr)
  const todayInWeek = !!selectedTs && todayStr >= selectedTs.week_start_date.slice(0, 10) && todayStr <= selectedTs.week_end_date.slice(0, 10)

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

  async function handleClockIn() {
    if (!selectedTs) return
    setSaving(true); setError('')
    try {
      await a.createTimeEntry({
        employee_id:  selectedTs.employee_id,
        timesheet_id: selectedTs.id,
        entry_date:   todayStr,
        clock_in:     new Date().toISOString(),
        hours_worked: 0,
        entry_type:   'REGULAR',
      })
      void qc.invalidateQueries({ queryKey: ['hr-time-entries', entityId, selectedTs.id] })
    } catch (e: unknown) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  async function handleClockOut() {
    if (!selectedTs || !todayEntry?.clock_in) return
    setSaving(true); setError('')
    try {
      const clockOutIso = new Date().toISOString()
      const mins = parseFloat(breakMinutes || '0')
      const rawHours = (new Date(clockOutIso).getTime() - new Date(todayEntry.clock_in).getTime()) / 3_600_000
      const hoursWorked = Math.max(0, Math.round((rawHours - mins / 60) * 100) / 100)
      await a.updateTimeEntry(todayEntry.id, { clock_out: clockOutIso, break_minutes: Math.round(mins), hours_worked: hoursWorked })
      setBreakMinutes('0')
      void qc.invalidateQueries({ queryKey: ['hr-time-entries', entityId, selectedTs.id] })
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

          <div className="mb-4 bg-slate-900 rounded-lg p-3 border border-slate-700">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-slate-400">{t('hr.timeClock')} · {fmtDate(todayStr)}</p>
                {!todayEntry?.clock_in && <p className="text-sm text-slate-300 mt-0.5">{t('hr.notClockedIn')}</p>}
                {todayEntry?.clock_in && !todayEntry?.clock_out && (
                  <p className="text-sm text-green-400 mt-0.5">{t('hr.clockedInAt', { time: fmtTime(todayEntry.clock_in) })}</p>
                )}
                {todayEntry?.clock_in && todayEntry?.clock_out && (
                  <p className="text-sm text-slate-300 mt-0.5">
                    {t('hr.workedSummary', { hours: fmtN(todayEntry.hours_worked), in: fmtTime(todayEntry.clock_in), out: fmtTime(todayEntry.clock_out) })}
                  </p>
                )}
                {!todayInWeek && <p className="text-xs text-amber-400 mt-1">{t('hr.outsideWeek')}</p>}
              </div>
              <div className="flex items-end gap-2">
                {todayEntry?.clock_in && !todayEntry?.clock_out && (
                  <Field label={t('hr.breakMinutes')}>
                    <input type="number" min="0" className={`${cls} w-24`} value={breakMinutes} onChange={e => setBreakMinutes(e.target.value)} />
                  </Field>
                )}
                {!todayEntry?.clock_in && (
                  <button className={btnPrimary} onClick={handleClockIn} disabled={saving || !todayInWeek}>{saving ? '…' : t('hr.clockIn')}</button>
                )}
                {todayEntry?.clock_in && !todayEntry?.clock_out && (
                  <button className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-sm rounded disabled:opacity-40" onClick={handleClockOut} disabled={saving}>{saving ? '…' : t('hr.clockOut')}</button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-700 bg-slate-900">
                {['hr.date','hr.clockIn','hr.clockOut','hr.hours','hr.type','hr.overtime','common.notes'].map(k => <th key={k} className="px-3 py-2">{t(k)}</th>)}
              </tr></thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-slate-700/50">
                    <td className="px-3 py-2 text-slate-100">{fmtDate(entry.entry_date)}</td>
                    <td className="px-3 py-2 text-slate-300">{entry.clock_in ? fmtTime(entry.clock_in) : '—'}</td>
                    <td className="px-3 py-2 text-slate-300">{entry.clock_out ? fmtTime(entry.clock_out) : '—'}</td>
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
  const [activeGroup, setActiveGroup] = useState(TAB_TO_GROUP.get('employees')!)
  const [selectedEntityId, setSelectedEntityId] = useState(HR_ENTITIES[0].id)

  const selectGroup = (groupId: string) => {
    setActiveGroup(groupId)
    setActiveTab(TAB_GROUPS.find(g => g.id === groupId)!.tabs[0])
  }

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

      <div className="flex gap-1 mb-1 overflow-x-auto">
        {TAB_GROUPS.map(g => (
          <button key={g.id} onClick={() => selectGroup(g.id)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-t-md whitespace-nowrap transition-colors ${
              activeGroup === g.id ? 'bg-slate-800 text-white' : 'bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}>
            {t(g.labelKey, g.id)}
          </button>
        ))}
      </div>
      <div className="flex overflow-x-auto border-b border-slate-700 mb-5 gap-1 bg-slate-800/50 rounded-t-md">
        {TAB_GROUPS.find(g => g.id === activeGroup)!.tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap pb-2 px-3 pt-2 text-sm border-b-2 ${activeTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {t(`hr.tab_${tab}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0">
        {activeTab === 'employees'       && <EmployeesTab entityId={selectedEntityId} />}
        {activeTab === 'payroll'         && <PayrollTab entityId={selectedEntityId} />}
        {activeTab === 'advances_loans'  && <AdvancesLoansTab entityId={selectedEntityId} />}
        {activeTab === 'leave'           && <LeaveTab entityId={selectedEntityId} />}
        {activeTab === 'performance'     && <PerformanceTab entityId={selectedEntityId} />}
        {activeTab === 'recruitment'     && <RecruitmentTab entityId={selectedEntityId} />}
        {activeTab === 'training'        && <TrainingTab entityId={selectedEntityId} />}
        {activeTab === 'disciplinary'    && <DisciplinaryTab entityId={selectedEntityId} />}
        {activeTab === 'attendance'      && <AttendanceTab entityId={selectedEntityId} />}
      </div>
    </div>
  )
}
