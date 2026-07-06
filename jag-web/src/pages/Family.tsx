import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { familyApi, type FamilyMember, type FamilyMemberInput, type Relationship, type PreferredLanguage } from '../api/family'
import { lifestyleApi, type LoyaltyProgramme, type TrackerEntry } from '../api/lifestyle'
import { ownershipApi } from '../api/ownership'

const fmtTTD = (n: number) => 'TTD ' + (n || 0).toLocaleString('en-TT', { maximumFractionDigits: 0 })

// Minimal shape of a DocVault file (only the fields the Family page needs).
interface DocFileLite {
  id:               string
  title:            string
  document_type:    string
  file_name:        string
  storage_path:     string
  family_member_id: string | null
}
const BUCKET_DOCUMENTS = 'jag-documents'

// ── Constants ───────────────────────────────────────────────────────────────────

const RELATIONSHIPS: Relationship[] = ['SELF', 'WIFE', 'DAUGHTER', 'FATHER', 'BROTHER', 'OTHER']
const LANGUAGES: PreferredLanguage[] = ['en', 'zh', 'es']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const RELATIONSHIP_ICON: Record<Relationship, string> = {
  SELF: '👤', WIFE: '💍', DAUGHTER: '👧', FATHER: '👴', BROTHER: '🧑', OTHER: '👥',
}

const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

// ── Date helpers ────────────────────────────────────────────────────────────────

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

// Days until the next anniversary of the DOB (0 = today). null if no DOB.
function daysToNextBirthday(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate())
  if (next < today) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate())
  return Math.round((next.getTime() - today.getTime()) / 86_400_000)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Add / Edit Modal ────────────────────────────────────────────────────────────

function MemberModal({ member, docs, programmes, onClose }: { member: FamilyMember | null; docs: DocFileLite[]; programmes: LoyaltyProgramme[]; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const editing = member !== null
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Health metrics for this member — lazily fetched (append-only, can grow).
  const { data: metrics = [] } = useQuery({
    queryKey: ['lifestyle-tracker', member?.id],
    queryFn: () => lifestyleApi.getTrackerEntries({ family_member_id: member!.id }),
    enabled: editing,
  })

  // Estate rollup (ownership) for this member — lazily fetched.
  const { data: holdings } = useQuery({
    queryKey: ['ownership-holdings', member?.id],
    queryFn: () => ownershipApi.holdings(member!.id),
    enabled: editing,
  })

  const handleDownload = async (doc: DocFileLite) => {
    setDownloadingId(doc.id)
    try {
      await api.download(`/files/download?bucket=${BUCKET_DOCUMENTS}&key=${encodeURIComponent(doc.storage_path)}`, doc.file_name)
    } finally {
      setDownloadingId(null)
    }
  }

  const [form, setForm] = useState({
    relationship:           (member?.relationship ?? 'OTHER') as Relationship,
    first_name:             member?.first_name ?? '',
    last_name:              member?.last_name ?? '',
    date_of_birth:          member?.date_of_birth ? member.date_of_birth.slice(0, 10) : '',
    email:                  member?.email ?? '',
    phone:                  member?.phone ?? '',
    preferred_language:     (member?.preferred_language ?? 'en') as PreferredLanguage,
    is_emergency_designate: member?.is_emergency_designate ?? false,
    notes:                  member?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const mutation = useMutation({
    mutationFn: () => {
      const payload: FamilyMemberInput = {
        relationship:           form.relationship,
        first_name:             form.first_name.trim(),
        last_name:              form.last_name.trim(),
        date_of_birth:          (form.date_of_birth && DATE_RE.test(form.date_of_birth)) ? form.date_of_birth : undefined,
        email:                  form.email.trim() || undefined,
        phone:                  form.phone.trim() || undefined,
        preferred_language:     form.preferred_language,
        is_emergency_designate: form.is_emergency_designate,
        notes:                  form.notes.trim() || undefined,
      }
      return editing ? familyApi.update(member.id, payload) : familyApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['family-members'] })
      onClose()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed.'),
  })

  const canSubmit = form.first_name.trim() && form.last_name.trim() && !mutation.isPending

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-white">
          {editing ? t('family.editMember') : t('family.addMember')}
        </h2>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.relationship')}</label>
              <select value={form.relationship} onChange={set('relationship')} className={cls}>
                {RELATIONSHIPS.map(r => (
                  <option key={r} value={r}>{RELATIONSHIP_ICON[r]} {t(`family.relationships.${r}`, r)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.language')}</label>
              <select value={form.preferred_language} onChange={set('preferred_language')} className={cls}>
                {LANGUAGES.map(l => (
                  <option key={l} value={l}>{t(`family.languages.${l}`, l)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.firstName')}</label>
              <input value={form.first_name} onChange={set('first_name')} className={cls} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.lastName')}</label>
              <input value={form.last_name} onChange={set('last_name')} className={cls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.dob')}</label>
              <input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} className={cls} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{t('family.phone')}</label>
              <input value={form.phone} onChange={set('phone')} className={cls} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('family.email')}</label>
            <input type="email" value={form.email} onChange={set('email')} className={cls} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_emergency_designate}
              onChange={e => setForm(f => ({ ...f, is_emergency_designate: e.target.checked }))}
              className="w-4 h-4 accent-orange-500" />
            <span className="text-slate-300 text-sm">🛡 {t('family.emergencyDesignate')}</span>
          </label>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className={cls} />
          </div>

          {editing && member.keycloak_user_id && (
            <p className="text-xs text-slate-500">🔑 {t('family.platformAccess')}</p>
          )}

          {editing && holdings && (holdings.entities.length > 0 || holdings.assets.length > 0) && (
            <div className="pt-2 border-t border-slate-700">
              <div className="flex items-baseline justify-between">
                <p className="text-xs text-slate-400">{t('family.estate')}</p>
                <p className="text-emerald-400 font-bold">{fmtTTD(holdings.total_attributed_ttd)}</p>
              </div>
              <div className="mt-2 space-y-1">
                {holdings.entities.map(e => (
                  <div key={e.subject_id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-300 truncate">🏢 {e.label} · {e.percent}%</span>
                    <span className="text-slate-400 shrink-0">{fmtTTD(e.attributed_value)}</span>
                  </div>
                ))}
                {holdings.assets.map(a => (
                  <div key={a.subject_id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-300 truncate">{a.subject_kind === 'PROPERTY' ? '🏠' : '📦'} {a.label} · {a.percent}%</span>
                    <span className="text-slate-400 shrink-0">{fmtTTD(a.attributed_value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {editing && (
            <div className="pt-2 border-t border-slate-700">
              <p className="text-xs text-slate-400 mb-2">{t('family.documents')} ({docs.length})</p>
              {docs.length === 0 ? (
                <p className="text-xs text-slate-500">{t('family.noDocuments')}</p>
              ) : (
                <div className="space-y-1.5">
                  {docs.map(d => (
                    <div key={d.id} className="flex items-center justify-between gap-2 bg-slate-900/40 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{d.title}</p>
                        <p className="text-slate-500 text-xs">{d.document_type}</p>
                      </div>
                      <button onClick={() => handleDownload(d)} disabled={downloadingId === d.id}
                        className="shrink-0 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50">
                        {downloadingId === d.id ? t('common.loading') : t('family.download')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {editing && programmes.length > 0 && (
            <div className="pt-2 border-t border-slate-700">
              <p className="text-xs text-slate-400 mb-2">{t('family.loyalty')} ({programmes.length})</p>
              <div className="space-y-1.5">
                {programmes.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-2 bg-slate-900/40 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-white text-sm truncate">{p.provider_name}{p.tier ? ` · ${p.tier}` : ''}</p>
                      <p className="text-slate-500 text-xs">{p.programme_type}</p>
                    </div>
                    <p className="shrink-0 text-xs text-slate-400">
                      {Number(p.points_balance) > 0 && <span>{Number(p.points_balance).toLocaleString()} pts</span>}
                      {Number(p.miles_balance) > 0 && <span> {Number(p.miles_balance).toLocaleString()} mi</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {editing && metrics.length > 0 && (
            <div className="pt-2 border-t border-slate-700">
              <p className="text-xs text-slate-400 mb-2">{t('family.healthMetrics')} ({metrics.length})</p>
              <div className="space-y-1">
                {metrics.slice(0, 8).map((mtr: TrackerEntry) => (
                  <div key={mtr.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400">{mtr.metric_type}</span>
                    <span className="text-white">{Number(mtr.value).toLocaleString()} {mtr.unit}</span>
                    <span className="text-slate-500 shrink-0">{fmtDate(mtr.entry_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button onClick={() => mutation.mutate()} disabled={!canSubmit}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Family() {
  const { t } = useTranslation()
  const [modalMember, setModalMember] = useState<FamilyMember | null>(null)
  const [showModal, setShowModal] = useState(false)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['family-members'],
    queryFn: () => familyApi.list(),
  })

  // All DocVault files (small personal dataset) — grouped by member for counts + modal list.
  const { data: docs = [] } = useQuery({
    queryKey: ['docvault-files'],
    queryFn: () => api.get<DocFileLite[]>('/docvault/files'),
  })
  const docsByMember = docs.reduce<Record<string, DocFileLite[]>>((acc, d) => {
    if (d.family_member_id) (acc[d.family_member_id] ??= []).push(d)
    return acc
  }, {})

  // Loyalty programmes — grouped by member for counts + modal list.
  const { data: programmes = [] } = useQuery({
    queryKey: ['lifestyle-programmes'],
    queryFn: () => lifestyleApi.getProgrammes(),
  })
  const progsByMember = programmes.reduce<Record<string, LoyaltyProgramme[]>>((acc, p) => {
    if (p.family_member_id) (acc[p.family_member_id] ??= []).push(p)
    return acc
  }, {})

  const emergencyCount = members.filter(m => m.is_emergency_designate).length
  const upcomingBirthdays = members.filter(m => {
    const d = daysToNextBirthday(m.date_of_birth)
    return d !== null && d <= 30
  })

  const openAdd = () => { setModalMember(null); setShowModal(true) }
  const openEdit = (m: FamilyMember) => { setModalMember(m); setShowModal(true) }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">{t('family.title')}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t('family.subtitle')}</p>
          </div>
          <button onClick={openAdd}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg transition-colors">
            {t('family.addMember')}
          </button>
        </div>

        {/* Summary chips */}
        {(emergencyCount > 0 || upcomingBirthdays.length > 0) && (
          <div className="flex gap-3 mt-3 flex-wrap">
            {emergencyCount > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-950/40 border border-blue-700 rounded-lg text-blue-300 text-xs">
                🛡 {t('family.emergencyCount', { count: emergencyCount })}
              </span>
            )}
            {upcomingBirthdays.map(m => (
              <span key={m.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/40 border border-amber-700 rounded-lg text-amber-300 text-xs">
                🎂 {t('family.upcomingBirthday', { name: m.first_name })}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading && <div className="flex items-center justify-center h-32 text-slate-400 text-sm">{t('common.loading')}</div>}

        {!isLoading && members.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <p className="text-4xl mb-3">👨‍👩‍👧</p>
            <p className="text-sm">{t('family.empty')}</p>
            <button onClick={openAdd} className="mt-3 text-orange-400 hover:text-orange-300 text-sm">{t('family.addMember')}</button>
          </div>
        )}

        {members.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {members.map(m => {
              const age = ageFromDob(m.date_of_birth)
              const docCount = docsByMember[m.id]?.length ?? 0
              const progCount = progsByMember[m.id]?.length ?? 0
              return (
                <button key={m.id} onClick={() => openEdit(m)}
                  className="text-left p-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700/60 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-2xl">{RELATIONSHIP_ICON[m.relationship]}</span>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {docCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-slate-300 text-xs rounded border border-slate-600" title={t('family.documents')}>📄 {docCount}</span>
                      )}
                      {progCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-slate-700 text-slate-300 text-xs rounded border border-slate-600" title={t('family.loyalty')}>✈ {progCount}</span>
                      )}
                      {m.is_emergency_designate && (
                        <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-300 text-xs rounded border border-blue-700">🛡</span>
                      )}
                      {m.keycloak_user_id && (
                        <span className="px-1.5 py-0.5 bg-emerald-900/40 text-emerald-300 text-xs rounded border border-emerald-700" title={t('family.platformAccess')}>🔑</span>
                      )}
                    </div>
                  </div>
                  <p className="text-white font-medium text-sm leading-tight">{m.first_name} {m.last_name}</p>
                  <p className="text-slate-400 text-xs mt-1">
                    {t(`family.relationships.${m.relationship}`, m.relationship)}
                    {age !== null && <span> · {t('family.ageYears', { count: age })}</span>}
                  </p>
                  <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                    {m.phone && <p>📞 {m.phone}</p>}
                    {m.email && <p className="truncate">✉ {m.email}</p>}
                    {m.date_of_birth && <p>🎂 {fmtDate(m.date_of_birth)}</p>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <MemberModal
          member={modalMember}
          docs={modalMember ? (docsByMember[modalMember.id] ?? []) : []}
          programmes={modalMember ? (progsByMember[modalMember.id] ?? []) : []}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
