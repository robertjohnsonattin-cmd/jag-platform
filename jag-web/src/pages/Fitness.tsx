import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { fitnessApi } from '../api/fitness'
import { familyApi, type FamilyMember } from '../api/family'
import type {
  Exercise, ExerciseCategory, MuscleGroup, TrackingType,
  WorkoutProgram, WorkoutProgramDetail, ProgramGoal, ProgramStatus, ProgramWorkoutWithExercises,
  WorkoutSession, WorkoutSessionDetail, WeightUnit,
  PersonalRecord, ProgressMetric,
  FitnessProfile, FitnessLevel, ActivityLevel, EquipmentAccess, BiologicalSex, AiSuggestionResult,
} from '../types/fitness'

// Shared family-member directory (mirrors the hook used in Lifestyle.tsx).
function useFamilyMembers() {
  const { data: members = [] } = useQuery<FamilyMember[]>({
    queryKey: ['family-members'],
    queryFn: () => familyApi.list(),
    staleTime: 60_000,
  })
  const nameOf = (id: string | null | undefined): string => {
    if (!id) return ''
    const m = members.find(x => x.id === id)
    return m ? `${m.first_name} ${m.last_name}` : ''
  }
  return { members, nameOf }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<ExerciseCategory, string> = {
  STRENGTH: '🏋️', CARDIO: '🏃', FLEXIBILITY: '🧘', BALANCE: '🤸', SPORT: '⚽',
}
const GOAL_LABELS: Record<ProgramGoal, string> = {
  STRENGTH: 'Strength', HYPERTROPHY: 'Hypertrophy', WEIGHT_LOSS: 'Weight Loss',
  ENDURANCE: 'Endurance', GENERAL_FITNESS: 'General Fitness', REHAB: 'Rehab', OTHER: 'Other',
}
const STATUS_COLORS: Record<ProgramStatus, string> = {
  ACTIVE: 'bg-emerald-900 text-emerald-200', COMPLETED: 'bg-blue-900 text-blue-200',
  PAUSED: 'bg-orange-900 text-orange-200', ARCHIVED: 'bg-slate-700 text-slate-300',
}
const RECORD_LABELS: Record<string, string> = {
  MAX_WEIGHT: 'Max Weight', MAX_1RM_EST: 'Est. 1RM', MAX_REPS: 'Max Reps',
  MAX_VOLUME: 'Max Volume', BEST_TIME: 'Best Time', BEST_DISTANCE: 'Best Distance',
}
const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest', BACK: 'Back', LEGS: 'Legs', SHOULDERS: 'Shoulders', ARMS: 'Arms',
  CORE: 'Core', FULL_BODY: 'Full Body', CARDIO: 'Cardio', OTHER: 'Other',
}
const TRACKING_TYPE_LABELS: Record<TrackingType, string> = {
  REPS_WEIGHT: 'Reps + Weight', REPS_ONLY: 'Reps Only', TIME: 'Time', DISTANCE: 'Distance',
}
const METRICS_BY_TRACKING: Record<TrackingType, { value: ProgressMetric; label: string }[]> = {
  REPS_WEIGHT: [{ value: 'weight', label: 'Max Weight' }, { value: 'est_1rm', label: 'Est. 1RM' }, { value: 'volume', label: 'Session Volume' }],
  REPS_ONLY:   [{ value: 'reps', label: 'Max Reps' }],
  TIME:        [{ value: 'time', label: 'Duration' }],
  DISTANCE:    [{ value: 'distance', label: 'Distance' }],
}

const today = () => new Date().toISOString().split('T')[0]
const fmtDate = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtNum = (n: number) => Math.round(n * 100) / 100

function MemberSelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const { members } = useFamilyMembers()
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
      {allowAll && <option value="">All family members</option>}
      {!allowAll && <option value="">Select family member…</option>}
      {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
    </select>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Programs tab
// ══════════════════════════════════════════════════════════════════════════

function AddProgramModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { members } = useFamilyMembers()
  const [form, setForm] = useState({
    family_member_id: '', name: '', goal: 'GENERAL_FITNESS' as ProgramGoal,
    description: '', start_date: today(),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.family_member_id) { setError('Select a family member.'); return }
    if (!form.name.trim()) { setError('Program name is required.'); return }
    setSaving(true); setError('')
    try {
      await fitnessApi.createProgram({
        family_member_id: form.family_member_id, name: form.name.trim(), goal: form.goal,
        description: form.description || undefined, start_date: form.start_date,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">New Program</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Family Member *</label>
              <select value={form.family_member_id} onChange={e => set('family_member_id', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                <option value="">Select…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Goal</label>
              <select value={form.goal} onChange={e => set('goal', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(GOAL_LABELS) as ProgramGoal[]).map(g => <option key={g} value={g}>{GOAL_LABELS[g]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Program Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Push/Pull/Legs"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Program'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddWorkoutDayModal({ programId, dayOrder, onClose, onSaved }: {
  programId: string; dayOrder: number; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      await fitnessApi.addProgramWorkout(programId, { name: name.trim(), day_order: dayOrder })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Add Workout Day</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Day Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Day 1 - Push"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddProgramExerciseModal({ programId, workoutId, exercises, onClose, onSaved }: {
  programId: string; workoutId: string; exercises: Exercise[]; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    exercise_id: exercises[0]?.id ?? '', target_sets: '3', target_reps_min: '8', target_reps_max: '12',
    target_weight: '', rest_seconds: '90',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.exercise_id) { setError('Select an exercise.'); return }
    setSaving(true); setError('')
    try {
      await fitnessApi.addProgramExercise(programId, workoutId, {
        exercise_id: form.exercise_id,
        target_sets: form.target_sets ? Number(form.target_sets) : undefined,
        target_reps_min: form.target_reps_min ? Number(form.target_reps_min) : undefined,
        target_reps_max: form.target_reps_max ? Number(form.target_reps_max) : undefined,
        target_weight: form.target_weight ? Number(form.target_weight) : undefined,
        rest_seconds: form.rest_seconds ? Number(form.rest_seconds) : undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Add Exercise</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Exercise *</label>
            <select value={form.exercise_id} onChange={e => set('exercise_id', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
              {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Sets</label>
              <input type="number" min="1" value={form.target_sets} onChange={e => set('target_sets', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reps Min</label>
              <input type="number" min="1" value={form.target_reps_min} onChange={e => set('target_reps_min', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reps Max</label>
              <input type="number" min="1" value={form.target_reps_max} onChange={e => set('target_reps_max', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Weight (optional)</label>
              <input type="number" min="0" step="0.5" value={form.target_weight} onChange={e => set('target_weight', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Rest (seconds)</label>
              <input type="number" min="0" value={form.rest_seconds} onChange={e => set('rest_seconds', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgramDetail({ programId, exercises, onClose, onChanged }: {
  programId: string; exercises: Exercise[]; onClose: () => void; onChanged: () => void
}) {
  const qc = useQueryClient()
  const [showAddDay, setShowAddDay] = useState(false)
  const [addExerciseFor, setAddExerciseFor] = useState<string | null>(null)

  const { data: prog, isLoading } = useQuery<WorkoutProgramDetail>({
    queryKey: ['fitness-program', programId],
    queryFn: () => fitnessApi.getProgram(programId),
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['fitness-program', programId] })
    onChanged()
  }

  const deleteProgram = async () => {
    if (!confirm('Delete this program? This removes all its workout days.')) return
    await fitnessApi.deleteProgram(programId)
    onClose()
    onChanged()
  }

  if (isLoading || !prog) return <div className="bg-slate-800 rounded-lg p-6"><p className="text-slate-500 text-sm">Loading…</p></div>

  return (
    <div className="bg-slate-800 rounded-lg p-6 mt-4">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold">{prog.name}</h3>
          <p className="text-slate-400 text-sm">{GOAL_LABELS[prog.goal]} · Started {fmtDate(prog.start_date)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddDay(true)} className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500">+ Workout Day</button>
          <button onClick={deleteProgram} className="px-3 py-1.5 text-xs rounded bg-red-900 hover:bg-red-800 text-red-200">Delete</button>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>
      </div>
      {prog.description && <p className="text-sm text-slate-300 mb-4">{prog.description}</p>}

      {prog.workouts.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No workout days yet — add one to start planning exercises.</p>
      ) : (
        <div className="space-y-4">
          {prog.workouts.map(w => (
            <div key={w.id} className="bg-slate-900 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium">{w.name}</h4>
                <div className="flex gap-2">
                  <button onClick={() => setAddExerciseFor(w.id)} className="text-xs text-blue-400 hover:text-blue-300">+ Exercise</button>
                  <button
                    onClick={async () => { if (confirm('Remove this workout day?')) { await fitnessApi.deleteProgramWorkout(programId, w.id); refresh() } }}
                    className="text-xs text-red-400 hover:text-red-300">Remove</button>
                </div>
              </div>
              {w.exercises.length === 0 ? (
                <p className="text-slate-500 text-xs italic">No exercises planned yet.</p>
              ) : (
                <div className="space-y-1">
                  {w.exercises.map(pe => (
                    <div key={pe.id} className="flex items-center gap-3 text-sm bg-slate-800 rounded px-3 py-2">
                      <span className="flex-1">{pe.exercise_name}</span>
                      <span className="text-slate-400 text-xs">
                        {pe.target_sets ?? '–'} sets × {pe.target_reps_min && pe.target_reps_max ? `${pe.target_reps_min}-${pe.target_reps_max}` : '–'} reps
                        {pe.target_weight ? ` @ ${pe.target_weight}` : ''}
                      </span>
                      <button
                        onClick={async () => { await fitnessApi.deleteProgramExercise(programId, w.id, pe.id); refresh() }}
                        className="text-slate-500 hover:text-red-400 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddDay && (
        <AddWorkoutDayModal programId={programId} dayOrder={prog.workouts.length}
          onClose={() => setShowAddDay(false)} onSaved={() => { setShowAddDay(false); refresh() }} />
      )}
      {addExerciseFor && (
        <AddProgramExerciseModal programId={programId} workoutId={addExerciseFor} exercises={exercises}
          onClose={() => setAddExerciseFor(null)} onSaved={() => { setAddExerciseFor(null); refresh() }} />
      )}
    </div>
  )
}

function ProgramsTab() {
  const { nameOf } = useFamilyMembers()
  const [memberFilter, setMemberFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: programs = [], isLoading } = useQuery<WorkoutProgram[]>({
    queryKey: ['fitness-programs', memberFilter],
    queryFn: () => fitnessApi.getPrograms({ family_member_id: memberFilter || undefined }),
  })
  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ['fitness-exercises'],
    queryFn: () => fitnessApi.getExercises(),
    staleTime: 5 * 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['fitness-programs'] })

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <MemberSelect value={memberFilter} onChange={setMemberFilter} allowAll />
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500">+ New Program</button>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No programs yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {programs.map(p => (
            <button key={p.id} onClick={() => setSelected(p.id === selected ? null : p.id)}
              className={`text-left bg-slate-800 rounded-lg p-4 border transition-colors ${selected === p.id ? 'border-blue-500' : 'border-transparent hover:border-slate-600'}`}>
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium">{p.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {p.ai_generated && <span className="text-xs px-2 py-0.5 rounded bg-purple-900 text-purple-200">🤖 AI</span>}
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                </div>
              </div>
              <p className="text-xs text-slate-400">{nameOf(p.family_member_id)} · {GOAL_LABELS[p.goal]}</p>
              <p className="text-xs text-slate-500 mt-1">Started {fmtDate(p.start_date)}</p>
            </button>
          ))}
        </div>
      )}

      {selected && <ProgramDetail programId={selected} exercises={exercises} onClose={() => setSelected(null)} onChanged={refresh} />}

      {showAdd && <AddProgramModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh() }} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Log Workout tab
// ══════════════════════════════════════════════════════════════════════════

function AddSetForm({ sessionId, exercises, onLogged }: { sessionId: string; exercises: Exercise[]; onLogged: () => void }) {
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? '')
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg')
  const [durationSeconds, setDurationSeconds] = useState('')
  const [distance, setDistance] = useState('')
  const [distanceUnit, setDistanceUnit] = useState('km')
  const [isWarmup, setIsWarmup] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const exercise = exercises.find(e => e.id === exerciseId)
  const trackingType = exercise?.tracking_type ?? 'REPS_WEIGHT'

  const submit = async () => {
    if (!exerciseId) { setError('Select an exercise.'); return }
    setSaving(true); setError('')
    try {
      await fitnessApi.addLog(sessionId, {
        exercise_id: exerciseId,
        reps: reps ? Number(reps) : undefined,
        weight: weight ? Number(weight) : undefined,
        weight_unit: weightUnit,
        duration_seconds: durationSeconds ? Number(durationSeconds) : undefined,
        distance: distance ? Number(distance) : undefined,
        distance_unit: distanceUnit || undefined,
        is_warmup: isWarmup,
      })
      setReps(''); setWeight(''); setDurationSeconds(''); setDistance(''); setIsWarmup(false)
      onLogged()
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="bg-slate-900 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <select value={exerciseId} onChange={e => setExerciseId(e.target.value)}
          className="col-span-2 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
          {exercises.map(ex => <option key={ex.id} value={ex.id}>{CATEGORY_ICONS[ex.category]} {ex.name}</option>)}
        </select>

        {trackingType === 'REPS_WEIGHT' && (
          <>
            <input type="number" min="0" placeholder="Reps" value={reps} onChange={e => setReps(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <input type="number" min="0" step="0.5" placeholder="Weight" value={weight} onChange={e => setWeight(e.target.value)}
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
              <select value={weightUnit} onChange={e => setWeightUnit(e.target.value as WeightUnit)}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-2 text-sm">
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </>
        )}
        {trackingType === 'REPS_ONLY' && (
          <input type="number" min="0" placeholder="Reps" value={reps} onChange={e => setReps(e.target.value)}
            className="col-span-2 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
        )}
        {trackingType === 'TIME' && (
          <input type="number" min="0" placeholder="Duration (seconds)" value={durationSeconds} onChange={e => setDurationSeconds(e.target.value)}
            className="col-span-2 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
        )}
        {trackingType === 'DISTANCE' && (
          <div className="col-span-2 flex gap-2">
            <input type="number" min="0" step="0.01" placeholder="Distance" value={distance} onChange={e => setDistance(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            <select value={distanceUnit} onChange={e => setDistanceUnit(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-2 text-sm">
              <option value="km">km</option>
              <option value="mi">mi</option>
            </select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={isWarmup} onChange={e => setIsWarmup(e.target.checked)} /> Warm-up set (excluded from PRs)
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button onClick={submit} disabled={saving}
        className="w-full px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
        {saving ? 'Logging…' : '+ Log Set'}
      </button>
    </div>
  )
}

function ActiveSessionPanel({ sessionId, exercises, plannedWorkout, onCompleted }: {
  sessionId: string; exercises: Exercise[]; plannedWorkout?: ProgramWorkoutWithExercises; onCompleted: () => void
}) {
  const qc = useQueryClient()
  const { data: session } = useQuery<WorkoutSessionDetail>({
    queryKey: ['fitness-session', sessionId],
    queryFn: () => fitnessApi.getSession(sessionId),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['fitness-session', sessionId] })

  const complete = async () => {
    await fitnessApi.updateSession(sessionId, { status: 'COMPLETED' })
    qc.invalidateQueries({ queryKey: ['fitness-sessions'] })
    onCompleted()
  }

  if (!session) return null

  return (
    <div className="bg-slate-800 rounded-lg p-6 mt-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Session in progress · {fmtDate(session.session_date)}</h3>
        <button onClick={complete} className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500">✓ Complete Session</button>
      </div>

      {plannedWorkout && plannedWorkout.exercises.length > 0 && (
        <div className="space-y-1 mb-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Planned — {plannedWorkout.name}</p>
          {plannedWorkout.exercises.map(pe => (
            <div key={pe.id} className="flex items-center gap-3 text-sm bg-slate-900 rounded px-3 py-2">
              <span className="flex-1">{pe.exercise_name}</span>
              <span className="text-slate-400 text-xs">
                {pe.target_sets ?? '–'} sets × {pe.target_reps_min && pe.target_reps_max ? `${pe.target_reps_min}-${pe.target_reps_max}` : '–'} reps
                {pe.rest_seconds ? ` · ${pe.rest_seconds}s rest` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {session.logs.length > 0 && (
        <div className="space-y-1 mb-4">
          {session.logs.map(l => (
            <div key={l.id} className="flex items-center gap-3 text-sm bg-slate-900 rounded px-3 py-2">
              <span className="flex-1">{l.exercise_name}{l.is_warmup && <span className="text-xs text-slate-500 ml-2">(warm-up)</span>}</span>
              <span className="text-slate-400 text-xs">
                {l.reps != null && `${l.reps} reps`}
                {l.weight != null && ` @ ${l.weight}${l.weight_unit}`}
                {l.duration_seconds != null && `${l.duration_seconds}s`}
                {l.distance != null && `${l.distance}${l.distance_unit ?? ''}`}
              </span>
              <button
                onClick={async () => { await fitnessApi.deleteLog(sessionId, l.id); refresh() }}
                className="text-slate-500 hover:text-red-400 text-xs">✕</button>
            </div>
          ))}
        </div>
      )}

      <AddSetForm sessionId={sessionId} exercises={exercises} onLogged={refresh} />
    </div>
  )
}

function LogWorkoutTab({ initialMemberId, initialSessionId, initialPlannedWorkout }: {
  initialMemberId?: string; initialSessionId?: string; initialPlannedWorkout?: ProgramWorkoutWithExercises
}) {
  const qc = useQueryClient()
  const [memberId, setMemberId] = useState(initialMemberId ?? '')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId ?? null)

  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ['fitness-exercises'],
    queryFn: () => fitnessApi.getExercises(),
    staleTime: 5 * 60_000,
  })

  const { data: inProgress = [] } = useQuery<WorkoutSession[]>({
    queryKey: ['fitness-sessions-inprogress', memberId],
    queryFn: () => fitnessApi.getSessions({ family_member_id: memberId || undefined, status: 'IN_PROGRESS' }),
    enabled: !!memberId,
  })

  const startSession = async () => {
    if (!memberId) return
    const s = await fitnessApi.startSession({ family_member_id: memberId, session_date: today() })
    qc.invalidateQueries({ queryKey: ['fitness-sessions-inprogress'] })
    setActiveSessionId(s.id)
  }

  const currentSessionId = activeSessionId ?? inProgress[0]?.id ?? null

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <MemberSelect value={memberId} onChange={v => { setMemberId(v); setActiveSessionId(null) }} />
        {memberId && !currentSessionId && (
          <button onClick={startSession} className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500">▶ Start Workout</button>
        )}
      </div>

      {!memberId && <p className="text-slate-500 text-sm italic">Select a family member to start or resume a workout.</p>}

      {currentSessionId && (
        <ActiveSessionPanel sessionId={currentSessionId} exercises={exercises}
          plannedWorkout={currentSessionId === initialSessionId ? initialPlannedWorkout : undefined}
          onCompleted={() => setActiveSessionId(null)} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// History tab
// ══════════════════════════════════════════════════════════════════════════

function SessionHistoryRow({ session, onDeleted }: { session: WorkoutSession; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const { data: detail } = useQuery<WorkoutSessionDetail>({
    queryKey: ['fitness-session', session.id],
    queryFn: () => fitnessApi.getSession(session.id),
    enabled: expanded,
  })

  const del = async () => {
    if (!confirm('Delete this workout session?')) return
    await fitnessApi.deleteSession(session.id)
    onDeleted()
  }

  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-700/50">
        <span className="flex-1 text-sm font-medium">{session.workout_name ?? 'Ad-hoc workout'}</span>
        <span className="text-xs text-slate-400">{session.set_count ?? 0} sets</span>
        {session.status === 'IN_PROGRESS' && <span className="text-xs px-2 py-0.5 rounded bg-orange-900 text-orange-200">In Progress</span>}
        <span className="text-xs text-slate-500">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && detail && (
        <div className="px-4 pb-4 space-y-1">
          {detail.logs.length === 0 ? (
            <p className="text-slate-500 text-xs italic">No sets logged.</p>
          ) : detail.logs.map(l => (
            <div key={l.id} className="flex items-center gap-3 text-sm bg-slate-900 rounded px-3 py-2">
              <span className="flex-1">{l.exercise_name}{l.is_warmup && <span className="text-xs text-slate-500 ml-2">(warm-up)</span>}</span>
              <span className="text-slate-400 text-xs">
                {l.reps != null && `${l.reps} reps`}
                {l.weight != null && ` @ ${l.weight}${l.weight_unit}`}
                {l.duration_seconds != null && `${l.duration_seconds}s`}
                {l.distance != null && `${l.distance}${l.distance_unit ?? ''}`}
              </span>
            </div>
          ))}
          {session.notes && <p className="text-xs text-slate-500 italic mt-2">{session.notes}</p>}
          <div className="flex justify-end pt-2">
            <button onClick={del} className="text-xs text-red-400 hover:text-red-300">Delete session</button>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryTab() {
  const [memberId, setMemberId] = useState('')
  const qc = useQueryClient()
  const { data: sessions = [], isLoading } = useQuery<WorkoutSession[]>({
    queryKey: ['fitness-sessions', memberId],
    queryFn: () => fitnessApi.getSessions({ family_member_id: memberId || undefined }),
  })

  const grouped = sessions.reduce<Record<string, WorkoutSession[]>>((acc, s) => {
    (acc[s.session_date] ??= []).push(s)
    return acc
  }, {})

  return (
    <div>
      <div className="mb-4"><MemberSelect value={memberId} onChange={setMemberId} allowAll /></div>
      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No workout sessions logged yet.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, daySessions]) => (
            <div key={date}>
              <div className="text-xs font-semibold text-slate-400 mb-2">{fmtDate(date)}</div>
              <div className="space-y-2">
                {daySessions.map(s => (
                  <SessionHistoryRow key={s.id} session={s} onDeleted={() => qc.invalidateQueries({ queryKey: ['fitness-sessions'] })} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Progress tab
// ══════════════════════════════════════════════════════════════════════════

function ProgressTab() {
  const [memberId, setMemberId] = useState('')
  const [exerciseId, setExerciseId] = useState('')
  const [metric, setMetric] = useState<ProgressMetric>('weight')

  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ['fitness-exercises'],
    queryFn: () => fitnessApi.getExercises(),
    staleTime: 5 * 60_000,
  })
  const exercise = exercises.find(e => e.id === exerciseId)
  const availableMetrics = exercise ? METRICS_BY_TRACKING[exercise.tracking_type] : []

  const { data: points = [], isLoading } = useQuery({
    queryKey: ['fitness-progress', memberId, exerciseId, metric],
    queryFn: () => fitnessApi.getProgress(memberId, exerciseId, metric),
    enabled: !!memberId && !!exerciseId,
  })

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <MemberSelect value={memberId} onChange={setMemberId} />
        <select value={exerciseId} onChange={e => {
          setExerciseId(e.target.value)
          const ex = exercises.find(x => x.id === e.target.value)
          if (ex) setMetric(METRICS_BY_TRACKING[ex.tracking_type][0].value)
        }} className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
          <option value="">Select exercise…</option>
          {exercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
        </select>
        {exerciseId && (
          <select value={metric} onChange={e => setMetric(e.target.value as ProgressMetric)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
            {availableMetrics.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
      </div>

      {!memberId || !exerciseId ? (
        <p className="text-slate-500 text-sm italic">Select a family member and an exercise to see progress over time.</p>
      ) : isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : points.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No logged sets for this exercise yet.</p>
      ) : (
        <div className="bg-slate-800 rounded-lg p-6" style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points.map(p => ({ ...p, date: fmtDate(p.date), value: p.value != null ? fmtNum(p.value) : null }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Records tab
// ══════════════════════════════════════════════════════════════════════════

function RecordsTab() {
  const { nameOf } = useFamilyMembers()
  const [memberId, setMemberId] = useState('')
  const { data: records = [], isLoading } = useQuery<PersonalRecord[]>({
    queryKey: ['fitness-records', memberId],
    queryFn: () => fitnessApi.getRecords({ family_member_id: memberId || undefined }),
  })

  return (
    <div>
      <div className="mb-4"><MemberSelect value={memberId} onChange={setMemberId} allowAll /></div>
      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No personal records yet — log some sets to start setting PRs.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                {!memberId && <th className="px-4 py-2 text-left">Member</th>}
                <th className="px-4 py-2 text-left">Exercise</th>
                <th className="px-4 py-2 text-left">Record</th>
                <th className="px-4 py-2 text-right">Value</th>
                <th className="px-4 py-2 text-left">Achieved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-slate-800/50">
                  {!memberId && <td className="px-4 py-2">{nameOf(r.family_member_id)}</td>}
                  <td className="px-4 py-2">{r.exercise_name}</td>
                  <td className="px-4 py-2">🏆 {RECORD_LABELS[r.record_type] ?? r.record_type}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmtNum(r.value)} {r.unit}</td>
                  <td className="px-4 py-2 text-slate-400">{fmtDate(r.achieved_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Exercises (library) tab
// ══════════════════════════════════════════════════════════════════════════

function AddExerciseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '', category: 'STRENGTH' as ExerciseCategory, muscle_group: 'OTHER' as MuscleGroup,
    tracking_type: 'REPS_WEIGHT' as TrackingType, equipment: '', instructions: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { setError('Exercise name is required.'); return }
    setSaving(true); setError('')
    try {
      await fitnessApi.createExercise({
        name: form.name.trim(), category: form.category, muscle_group: form.muscle_group,
        tracking_type: form.tracking_type, equipment: form.equipment || undefined,
        instructions: form.instructions || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Add Custom Exercise</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Exercise Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Bulgarian Split Squat"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(CATEGORY_ICONS) as ExerciseCategory[]).map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Muscle Group</label>
              <select value={form.muscle_group} onChange={e => set('muscle_group', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[]).map(m => <option key={m} value={m}>{MUSCLE_GROUP_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">How it's tracked</label>
              <select value={form.tracking_type} onChange={e => set('tracking_type', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(TRACKING_TYPE_LABELS) as TrackingType[]).map(tt => <option key={tt} value={tt}>{TRACKING_TYPE_LABELS[tt]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Equipment</label>
              <input value={form.equipment} onChange={e => set('equipment', e.target.value)} placeholder="e.g. Dumbbells"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Instructions</label>
            <textarea value={form.instructions} onChange={e => set('instructions', e.target.value)} rows={2}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add Exercise'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExercisesTab() {
  const qc = useQueryClient()
  const [categoryFilter, setCategoryFilter] = useState<ExerciseCategory | ''>('')
  const [showAdd, setShowAdd] = useState(false)

  const { data: exercises = [], isLoading } = useQuery<Exercise[]>({
    queryKey: ['fitness-exercises-all', categoryFilter],
    queryFn: () => fitnessApi.getExercises(categoryFilter ? { category: categoryFilter } : undefined),
  })

  const grouped = exercises.reduce<Record<string, Exercise[]>>((acc, ex) => {
    (acc[ex.category] ??= []).push(ex)
    return acc
  }, {})

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as ExerciseCategory | '')}
          className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_ICONS) as ExerciseCategory[]).map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
        </select>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500">+ Add Custom Exercise</button>
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : exercises.length === 0 ? (
        <p className="text-slate-500 text-sm italic">No exercises found.</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, list]) => (
            <div key={category}>
              <div className="text-xs font-semibold text-slate-400 mb-2">
                {CATEGORY_ICONS[category as ExerciseCategory]} {category} ({list.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {list.map(ex => (
                  <div key={ex.id} className="bg-slate-800 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{ex.name}</span>
                      {ex.is_custom && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900 text-blue-200 shrink-0">Custom</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {MUSCLE_GROUP_LABELS[ex.muscle_group]} · {TRACKING_TYPE_LABELS[ex.tracking_type]}
                      {ex.equipment ? ` · ${ex.equipment}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddExerciseModal onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['fitness-exercises-all'] }); qc.invalidateQueries({ queryKey: ['fitness-exercises'] }) }} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// AI Coach tab
// ══════════════════════════════════════════════════════════════════════════

const FITNESS_LEVEL_LABELS: Record<FitnessLevel, string> = {
  BEGINNER: 'Beginner', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced',
}
const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  SEDENTARY: 'Sedentary', LIGHTLY_ACTIVE: 'Lightly Active', MODERATELY_ACTIVE: 'Moderately Active',
  VERY_ACTIVE: 'Very Active', EXTREMELY_ACTIVE: 'Extremely Active',
}
const EQUIPMENT_ACCESS_LABELS: Record<EquipmentAccess, string> = {
  HOME_BASIC: 'Home — basic (dumbbells, bands)', HOME_FULL: 'Home — full setup',
  COMMERCIAL_GYM: 'Commercial gym', BODYWEIGHT_ONLY: 'Bodyweight only', OTHER: 'Other',
}
const ENERGY_ICONS = ['😴', '🥱', '🙂', '💪', '⚡']
const SORENESS_ICONS = ['✨', '🙂', '😐', '😣', '🤕']

function FitnessProfileModal({ familyMemberId, profile, onClose, onSaved }: {
  familyMemberId: string; profile: FitnessProfile | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    primary_goal: profile?.primary_goal ?? 'GENERAL_FITNESS' as ProgramGoal,
    fitness_level: profile?.fitness_level ?? 'BEGINNER' as FitnessLevel,
    activity_level: profile?.activity_level ?? 'MODERATELY_ACTIVE' as ActivityLevel,
    biological_sex: profile?.biological_sex ?? 'UNSPECIFIED' as BiologicalSex,
    height_cm: profile?.height_cm != null ? String(profile.height_cm) : '',
    weight_kg: profile?.weight_kg != null ? String(profile.weight_kg) : '',
    body_fat_pct: profile?.body_fat_pct != null ? String(profile.body_fat_pct) : '',
    equipment_access: profile?.equipment_access ?? 'HOME_BASIC' as EquipmentAccess,
    days_per_week_target: profile?.days_per_week_target != null ? String(profile.days_per_week_target) : '',
    injuries_limitations: profile?.injuries_limitations ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    setSaving(true); setError('')
    try {
      await fitnessApi.saveProfile({
        family_member_id: familyMemberId, primary_goal: form.primary_goal, fitness_level: form.fitness_level,
        activity_level: form.activity_level, biological_sex: form.biological_sex,
        height_cm: form.height_cm ? Number(form.height_cm) : undefined,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined,
        body_fat_pct: form.body_fat_pct ? Number(form.body_fat_pct) : undefined,
        equipment_access: form.equipment_access,
        days_per_week_target: form.days_per_week_target ? Number(form.days_per_week_target) : undefined,
        injuries_limitations: form.injuries_limitations || undefined,
      })
      onSaved()
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold">Fitness Profile</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Primary Goal</label>
              <select value={form.primary_goal} onChange={e => set('primary_goal', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(GOAL_LABELS) as ProgramGoal[]).map(g => <option key={g} value={g}>{GOAL_LABELS[g]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Fitness Level</label>
              <select value={form.fitness_level} onChange={e => set('fitness_level', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(FITNESS_LEVEL_LABELS) as FitnessLevel[]).map(l => <option key={l} value={l}>{FITNESS_LEVEL_LABELS[l]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Activity Level (outside of workouts)</label>
              <select value={form.activity_level} onChange={e => set('activity_level', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(ACTIVITY_LEVEL_LABELS) as ActivityLevel[]).map(a => <option key={a} value={a}>{ACTIVITY_LEVEL_LABELS[a]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Biological Sex (optional — helps calibrate programming)</label>
              <select value={form.biological_sex} onChange={e => set('biological_sex', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                <option value="UNSPECIFIED">Prefer not to say</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Height (cm)</label>
              <input type="number" min="0" value={form.height_cm} onChange={e => set('height_cm', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Weight (kg)</label>
              <input type="number" min="0" step="0.1" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Body Fat % (optional)</label>
              <input type="number" min="0" max="100" step="0.1" value={form.body_fat_pct} onChange={e => set('body_fat_pct', e.target.value)}
                placeholder="Don't know"
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Equipment Access</label>
              <select value={form.equipment_access} onChange={e => set('equipment_access', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                {(Object.keys(EQUIPMENT_ACCESS_LABELS) as EquipmentAccess[]).map(eq => <option key={eq} value={eq}>{EQUIPMENT_ACCESS_LABELS[eq]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Days/Week Target</label>
              <input type="number" min="1" max="7" value={form.days_per_week_target} onChange={e => set('days_per_week_target', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Injuries / Limitations</label>
            <textarea value={form.injuries_limitations} onChange={e => set('injuries_limitations', e.target.value)} rows={2}
              placeholder="e.g. lower back sensitivity, avoid overhead pressing"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SuggestedWorkoutCard({ result, onStarted, onRegenerate, regenerating }: {
  result: AiSuggestionResult; onStarted: (memberId: string, sessionId: string, workout: ProgramWorkoutWithExercises) => void
  onRegenerate: () => void; regenerating: boolean
}) {
  const [starting, setStarting] = useState(false)
  const workout = result.program.workouts[0]

  const start = async () => {
    setStarting(true)
    try {
      const s = await fitnessApi.startSession({
        family_member_id: result.program.family_member_id,
        program_workout_id: workout.id,
        session_date: new Date().toISOString().slice(0, 10),
      })
      onStarted(result.program.family_member_id, s.id, workout)
    } catch (e) { alert((e as Error).message); setStarting(false) }
  }

  return (
    <div className="bg-slate-800 rounded-lg p-6 mt-4 border border-purple-800">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-lg font-semibold">🤖 {result.program.name}</h3>
          <p className="text-slate-400 text-sm">{result.focus_summary} · ~{result.estimated_duration_minutes} min</p>
        </div>
      </div>
      {result.coaching_note && (
        <p className="text-sm text-purple-200 bg-purple-950/40 rounded-lg px-4 py-2 mb-4 italic">💬 {result.coaching_note}</p>
      )}
      <div className="space-y-1 mb-4">
        {workout.exercises.map(pe => (
          <div key={pe.id} className="flex items-center gap-3 text-sm bg-slate-900 rounded px-3 py-2">
            <span className="flex-1">{pe.exercise_name}</span>
            <span className="text-slate-400 text-xs">
              {pe.target_sets ?? '–'} sets × {pe.target_reps_min && pe.target_reps_max ? `${pe.target_reps_min}-${pe.target_reps_max}` : '–'} reps
              {pe.rest_seconds ? ` · ${pe.rest_seconds}s rest` : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={start} disabled={starting}
          className="flex-1 px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
          {starting ? 'Starting…' : '🚀 Start This Workout'}
        </button>
        <button onClick={onRegenerate} disabled={regenerating}
          className="px-4 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50">
          {regenerating ? 'Regenerating…' : '🔄 Regenerate'}
        </button>
      </div>
    </div>
  )
}

function AiCoachTab({ onWorkoutStarted }: {
  onWorkoutStarted: (memberId: string, sessionId: string, workout: ProgramWorkoutWithExercises) => void
}) {
  const qc = useQueryClient()
  const [memberId, setMemberId] = useState('')
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [energy, setEnergy] = useState(3)
  const [soreness, setSoreness] = useState(1)
  const [timeAvailable, setTimeAvailable] = useState('45')
  const [focusOverride, setFocusOverride] = useState<ProgramGoal | ''>('')
  const [notes, setNotes] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AiSuggestionResult | null>(null)

  const { data: profile, isLoading: profileLoading } = useQuery<FitnessProfile | null>({
    queryKey: ['fitness-profile', memberId],
    queryFn: () => fitnessApi.getProfile(memberId),
    enabled: !!memberId,
  })

  const suggest = async () => {
    setSuggesting(true); setError('')
    try {
      const r = await fitnessApi.suggestWorkout({
        family_member_id: memberId, energy_level: energy, soreness_level: soreness,
        time_available_minutes: timeAvailable ? Number(timeAvailable) : undefined,
        focus_override: focusOverride || undefined, notes: notes || undefined,
      })
      setResult(r)
      qc.invalidateQueries({ queryKey: ['fitness-programs'] })
    } catch (e) { setError((e as Error).message) } finally { setSuggesting(false) }
  }

  return (
    <div>
      <div className="mb-4"><MemberSelect value={memberId} onChange={v => { setMemberId(v); setResult(null) }} /></div>

      {!memberId ? (
        <p className="text-slate-500 text-sm italic">Select a family member to get an AI-suggested workout.</p>
      ) : profileLoading ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium">Fitness Profile</h3>
              <button onClick={() => setShowProfileModal(true)} className="text-xs text-blue-400 hover:text-blue-300">
                {profile ? 'Edit' : '+ Set Up Profile'}
              </button>
            </div>
            {profile ? (
              <p className="text-xs text-slate-400">
                {GOAL_LABELS[profile.primary_goal]} · {FITNESS_LEVEL_LABELS[profile.fitness_level]} · {ACTIVITY_LEVEL_LABELS[profile.activity_level]}
                {profile.weight_kg ? ` · ${profile.weight_kg}kg` : ''}{profile.height_cm ? ` · ${profile.height_cm}cm` : ''}
              </p>
            ) : (
              <p className="text-xs text-slate-500 italic">No profile yet — set one up so the coach knows your goals and stats.</p>
            )}
          </div>

          {profile && (
            <div className="bg-slate-800 rounded-lg p-4">
              <h3 className="font-medium mb-3">How are you feeling today?</h3>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Energy — {ENERGY_ICONS[energy - 1]}</label>
                  <input type="range" min="1" max="5" value={energy} onChange={e => setEnergy(Number(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Soreness — {SORENESS_ICONS[soreness - 1]}</label>
                  <input type="range" min="1" max="5" value={soreness} onChange={e => setSoreness(Number(e.target.value))} className="w-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Time available (min)</label>
                  <input type="number" min="10" value={timeAvailable} onChange={e => setTimeAvailable(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Override today's focus (optional)</label>
                  <select value={focusOverride} onChange={e => setFocusOverride(e.target.value as ProgramGoal | '')}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm">
                    <option value="">Use profile goal ({GOAL_LABELS[profile.primary_goal]})</option>
                    {(Object.keys(GOAL_LABELS) as ProgramGoal[]).map(g => <option key={g} value={g}>{GOAL_LABELS[g]}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-slate-400 mb-1">Anything else? (optional)</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. traveling, only have resistance bands today"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button onClick={suggest} disabled={suggesting}
                className="w-full px-4 py-2 text-sm rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50">
                {suggesting ? '✨ Thinking…' : '✨ Suggest My Workout'}
              </button>
            </div>
          )}

          {result && (
            <SuggestedWorkoutCard result={result} onStarted={onWorkoutStarted} onRegenerate={suggest} regenerating={suggesting} />
          )}
        </div>
      )}

      {showProfileModal && memberId && (
        <FitnessProfileModal familyMemberId={memberId} profile={profile ?? null}
          onClose={() => setShowProfileModal(false)}
          onSaved={() => { setShowProfileModal(false); qc.invalidateQueries({ queryKey: ['fitness-profile', memberId] }) }} />
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'ai' | 'programs' | 'log' | 'history' | 'progress' | 'records' | 'exercises'

export default function Fitness() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('ai')
  const [startedMemberId, setStartedMemberId] = useState<string | undefined>()
  const [startedSessionId, setStartedSessionId] = useState<string | undefined>()
  const [startedWorkout, setStartedWorkout] = useState<ProgramWorkoutWithExercises | undefined>()

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('fitness.title', 'Fitness')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('fitness.subtitle', 'Programs, workout logging, progress and personal records')}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-slate-800 rounded-lg p-1 w-fit overflow-x-auto">
        {([
          ['ai', t('fitness.tabAi', '✨ AI Coach')],
          ['exercises', t('fitness.tabExercises', 'Exercises')],
          ['programs', t('fitness.tabPrograms', 'Programs')],
          ['log', t('fitness.tabLog', 'Log Workout')],
          ['history', t('fitness.tabHistory', 'History')],
          ['progress', t('fitness.tabProgress', 'Progress')],
          ['records', t('fitness.tabRecords', 'Records')],
        ] as [Tab, string][]).map(([tb, label]) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              tab === tb ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai' && <AiCoachTab onWorkoutStarted={(memberId, sessionId, workout) => {
        setStartedMemberId(memberId); setStartedSessionId(sessionId); setStartedWorkout(workout); setTab('log')
      }} />}
      {tab === 'exercises' && <ExercisesTab />}
      {tab === 'programs' && <ProgramsTab />}
      {tab === 'log' && <LogWorkoutTab initialMemberId={startedMemberId} initialSessionId={startedSessionId} initialPlannedWorkout={startedWorkout} />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'progress' && <ProgressTab />}
      {tab === 'records' && <RecordsTab />}
    </div>
  )
}
