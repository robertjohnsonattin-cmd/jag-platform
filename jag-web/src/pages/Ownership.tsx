import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { familyApi, type FamilyMember } from '../api/family'
import {
  ownershipApi,
  type OwnershipStake, type SubjectKind, type SubjectOption,
} from '../api/ownership'

// ── Helpers ─────────────────────────────────────────────────────────────────────

const fmtTTD = (n: number) => 'TTD ' + (n || 0).toLocaleString('en-TT', { maximumFractionDigits: 0 })
const KIND_ICON: Record<SubjectKind, string> = { ENTITY: '🏢', PROPERTY: '🏠', ITEM: '📦' }
const cls = 'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500'

function memberName(members: FamilyMember[], id: string): string {
  const m = members.find(x => x.id === id)
  return m ? `${m.first_name} ${m.last_name}` : '—'
}

// ── Add / Edit Stake Modal ───────────────────────────────────────────────────────

function StakeModal({
  members, subjects, lockMemberId, lockSubject, editStake, onClose,
}: {
  members: FamilyMember[]
  subjects: SubjectOption[]
  lockMemberId?: string
  lockSubject?: { kind: SubjectKind; id: string; label: string }
  editStake?: OwnershipStake
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const editing = !!editStake

  const [memberId, setMemberId] = useState(editStake?.family_member_id ?? lockMemberId ?? '')
  const [subjectKey, setSubjectKey] = useState(
    editStake ? `${editStake.subject_kind}:${editStake.subject_id}`
      : lockSubject ? `${lockSubject.kind}:${lockSubject.id}` : '',
  )
  const [percent, setPercent] = useState(editStake ? String(parseFloat(editStake.ownership_percent)) : '')
  const [notes, setNotes] = useState(editStake?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ownership-stakes'] })
    qc.invalidateQueries({ queryKey: ['ownership-allocation'] })
    qc.invalidateQueries({ queryKey: ['ownership-holdings'] })
  }

  const mutation = useMutation({
    mutationFn: () => {
      const pct = parseFloat(percent)
      if (editing) {
        return ownershipApi.update(editStake.id, { ownership_percent: pct, notes: notes.trim() || null })
      }
      const subj = subjects.find(s => `${s.kind}:${s.id}` === subjectKey)
        ?? (lockSubject ? { kind: lockSubject.kind, id: lockSubject.id, label: lockSubject.label } : undefined)
      if (!subj) throw new Error('Pick a subject.')
      return ownershipApi.create({
        family_member_id: memberId,
        subject_kind: subj.kind,
        subject_id: subj.id,
        subject_label: subj.label,
        ownership_percent: pct,
        notes: notes.trim() || undefined,
      })
    },
    onSuccess: () => { invalidate(); onClose() },
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed.'),
  })

  const pctNum = parseFloat(percent)
  const canSubmit = memberId && (editing || subjectKey) && pctNum > 0 && pctNum <= 100 && !mutation.isPending

  // Group subjects for the picker.
  const groups: { label: string; items: SubjectOption[] }[] = [
    { label: t('ownership.entities'),   items: subjects.filter(s => s.kind === 'ENTITY') },
    { label: t('ownership.properties'), items: subjects.filter(s => s.kind === 'PROPERTY') },
    { label: t('ownership.items'),      items: subjects.filter(s => s.kind === 'ITEM') },
  ].filter(g => g.items.length > 0)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4 text-white">
          {editing ? t('ownership.editStake') : t('ownership.addOwner')}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('ownership.owner')}</label>
            <select value={memberId} onChange={e => setMemberId(e.target.value)} disabled={editing || !!lockMemberId} className={`${cls} disabled:opacity-60`}>
              <option value="">{t('ownership.selectPerson')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('ownership.subject')}</label>
            {editing || lockSubject ? (
              <p className="text-white text-sm bg-slate-900/40 rounded-lg px-3 py-2">
                {KIND_ICON[editStake?.subject_kind ?? lockSubject!.kind]} {editStake?.subject_label ?? lockSubject!.label}
              </p>
            ) : (
              <select value={subjectKey} onChange={e => setSubjectKey(e.target.value)} className={cls}>
                <option value="">{t('ownership.selectSubject')}</option>
                {groups.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map(s => <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>{s.label}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('ownership.percent')}</label>
            <input type="number" min="0.01" max="100" step="0.01" value={percent} onChange={e => setPercent(e.target.value)} placeholder="100" className={cls} />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">{t('common.notes')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={cls} />
          </div>
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button onClick={() => mutation.mutate()} disabled={!canSubmit}
            className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

// ── By Person card (fetches holdings) ─────────────────────────────────────────────

function PersonCard({ member, onAddStake }: { member: FamilyMember; onAddStake: () => void }) {
  const { t } = useTranslation()
  const { data: holdings } = useQuery({
    queryKey: ['ownership-holdings', member.id],
    queryFn: () => ownershipApi.holdings(member.id),
  })
  const total = holdings?.total_attributed_ttd ?? 0
  const entityRows = holdings?.entities ?? []
  const assetRows = holdings?.assets ?? []
  const empty = entityRows.length === 0 && assetRows.length === 0

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-white font-semibold">{member.first_name} {member.last_name}</p>
          <p className="text-emerald-400 text-lg font-bold mt-0.5">{fmtTTD(total)}</p>
          <p className="text-slate-500 text-xs">{t('ownership.attributedEstate')}</p>
        </div>
        <button onClick={onAddStake} className="text-xs text-orange-400 hover:text-orange-300 shrink-0">+ {t('ownership.addStake')}</button>
      </div>

      {empty ? (
        <p className="text-slate-500 text-xs">{t('ownership.noHoldings')}</p>
      ) : (
        <div className="space-y-1">
          {entityRows.map(e => (
            <div key={e.subject_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300 truncate">🏢 {e.label} · {e.percent}%</span>
              <span className="text-slate-400 shrink-0">{fmtTTD(e.attributed_value)}</span>
            </div>
          ))}
          {assetRows.map(a => (
            <div key={a.subject_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300 truncate">{KIND_ICON[a.subject_kind]} {a.label} · {a.percent}%</span>
              <span className="text-slate-400 shrink-0">{fmtTTD(a.attributed_value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────

export default function Ownership() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'entity' | 'person'>('entity')
  const [modal, setModal] = useState<{ lockMemberId?: string; lockSubject?: { kind: SubjectKind; id: string; label: string }; editStake?: OwnershipStake } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const { data: members = [] }   = useQuery({ queryKey: ['family-members'], queryFn: () => familyApi.list() })
  const { data: stakes = [] }    = useQuery({ queryKey: ['ownership-stakes'], queryFn: () => ownershipApi.list() })
  const { data: subjectsData }   = useQuery({ queryKey: ['ownership-subjects'], queryFn: () => ownershipApi.subjects() })
  const { data: allocation = [] }= useQuery({ queryKey: ['ownership-allocation'], queryFn: () => ownershipApi.allocation() })

  const allSubjects: SubjectOption[] = subjectsData
    ? [...subjectsData.entities, ...subjectsData.properties, ...subjectsData.items]
    : []

  const del = useMutation({
    mutationFn: (id: string) => ownershipApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ownership-stakes'] })
      qc.invalidateQueries({ queryKey: ['ownership-allocation'] })
      qc.invalidateQueries({ queryKey: ['ownership-holdings'] })
      setConfirmDel(null)
    },
  })

  // By-Entity rows: every known entity + any asset subject that already has stakes.
  const entitySubjects = subjectsData?.entities ?? []
  const assetSubjectsWithStakes: { kind: SubjectKind; id: string; label: string }[] = []
  for (const s of stakes) {
    if (s.subject_kind !== 'ENTITY' && !assetSubjectsWithStakes.some(a => a.kind === s.subject_kind && a.id === s.subject_id)) {
      assetSubjectsWithStakes.push({ kind: s.subject_kind, id: s.subject_id, label: s.subject_label })
    }
  }
  const entityRows = [
    ...entitySubjects.map(e => ({ kind: 'ENTITY' as SubjectKind, id: e.id, label: e.label })),
    ...assetSubjectsWithStakes,
  ]

  const ownersOf = (kind: SubjectKind, id: string) => stakes.filter(s => s.subject_kind === kind && s.subject_id === id)
  const allocOf = (kind: SubjectKind, id: string) =>
    allocation.find(a => a.subject_kind === kind && a.subject_id === id)?.allocated_percent ?? 0

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-6 py-4 border-b border-slate-700">
        <h1 className="text-xl font-semibold text-white">{t('ownership.title')}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t('ownership.subtitle')}</p>
        <div className="flex gap-2 mt-3">
          {(['entity', 'person'] as const).map(tb => (
            <button key={tb} onClick={() => setTab(tb)}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${tab === tb ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {t(`ownership.tab_${tb}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* ── By Entity ── */}
        {tab === 'entity' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {entityRows.map(subj => {
              const owners = ownersOf(subj.kind, subj.id)
              const allocated = allocOf(subj.kind, subj.id)
              const full = Math.abs(allocated - 100) < 0.01
              return (
                <div key={`${subj.kind}:${subj.id}`} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-white font-medium text-sm">{KIND_ICON[subj.kind]} {subj.label}</p>
                    {owners.length > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${full ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700' : 'bg-amber-900/40 text-amber-300 border border-amber-700'}`}>
                        {allocated}%
                      </span>
                    )}
                  </div>
                  {owners.length === 0 ? (
                    <p className="text-slate-500 text-xs mb-2">{t('ownership.noOwners')}</p>
                  ) : (
                    <div className="space-y-1 mb-2">
                      {owners.map(o => (
                        <div key={o.id} className="flex items-center justify-between gap-2 text-xs group">
                          <span className="text-slate-300 truncate">{memberName(members, o.family_member_id)}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            <button onClick={() => setModal({ editStake: o })} className="text-slate-400 hover:text-white">{parseFloat(o.ownership_percent)}%</button>
                            {confirmDel === o.id ? (
                              <button onClick={() => del.mutate(o.id)} className="text-red-400 hover:text-red-300">{t('common.confirm')}</button>
                            ) : (
                              <button onClick={() => setConfirmDel(o.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100">×</button>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setModal({ lockSubject: subj })} className="text-xs text-orange-400 hover:text-orange-300">+ {t('ownership.addOwner')}</button>
                </div>
              )
            })}
          </div>
        )}

        {/* ── By Person ── */}
        {tab === 'person' && (
          members.length === 0 ? (
            <p className="text-slate-500 text-sm">{t('ownership.noMembers')}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {members.map(m => (
                <PersonCard key={m.id} member={m} onAddStake={() => setModal({ lockMemberId: m.id })} />
              ))}
            </div>
          )
        )}
      </div>

      {modal && (
        <StakeModal
          members={members}
          subjects={allSubjects}
          lockMemberId={modal.lockMemberId}
          lockSubject={modal.lockSubject}
          editStake={modal.editStake}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
