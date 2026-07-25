import { api } from './client'
import type {
  Exercise, ExerciseCategory, MuscleGroup, TrackingType,
  WorkoutProgram, WorkoutProgramDetail, ProgramGoal, ProgramStatus,
  ProgramWorkout, ProgramExercise,
  WorkoutSession, WorkoutSessionDetail, SessionStatus,
  ExerciseLog, WeightUnit,
  PersonalRecord, ProgressPoint, ProgressMetric,
  FitnessProfile, FitnessLevel, ActivityLevel, EquipmentAccess, BiologicalSex,
  FitnessCheckin, AiSuggestionResult,
} from '../types/fitness'

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const fitnessApi = {
  // Exercise library
  getExercises: (params?: { category?: ExerciseCategory; muscle_group?: MuscleGroup }) =>
    api.get<Exercise[]>(`/lifestyle/fitness/exercises${qs(params ?? {})}`),
  createExercise: (data: {
    name: string; category: ExerciseCategory; muscle_group?: MuscleGroup; tracking_type: TrackingType
    equipment?: string; instructions?: string
  }) => api.post<Exercise>('/lifestyle/fitness/exercises', data),
  updateExercise: (id: string, data: Partial<{
    name: string; category: ExerciseCategory; muscle_group: MuscleGroup; tracking_type: TrackingType
    equipment: string; instructions: string; is_active: boolean
  }>) => api.patch<Exercise>(`/lifestyle/fitness/exercises/${id}`, data),

  // Programs
  getPrograms: (params?: { family_member_id?: string; status?: ProgramStatus }) =>
    api.get<WorkoutProgram[]>(`/lifestyle/fitness/programs${qs(params ?? {})}`),
  getProgram: (id: string) => api.get<WorkoutProgramDetail>(`/lifestyle/fitness/programs/${id}`),
  createProgram: (data: {
    family_member_id: string; name: string; goal?: ProgramGoal; description?: string
    status?: ProgramStatus; start_date: string; end_date?: string
  }) => api.post<WorkoutProgram>('/lifestyle/fitness/programs', data),
  updateProgram: (id: string, data: Partial<{
    name: string; goal: ProgramGoal; description: string; status: ProgramStatus
    start_date: string; end_date: string
  }>) => api.patch<WorkoutProgram>(`/lifestyle/fitness/programs/${id}`, data),
  deleteProgram: (id: string) => api.delete<{ deleted: boolean }>(`/lifestyle/fitness/programs/${id}`),

  // Program workout days
  addProgramWorkout: (programId: string, data: { name: string; day_order?: number; notes?: string }) =>
    api.post<ProgramWorkout>(`/lifestyle/fitness/programs/${programId}/workouts`, data),
  updateProgramWorkout: (programId: string, workoutId: string, data: Partial<{ name: string; day_order: number; notes: string }>) =>
    api.patch<ProgramWorkout>(`/lifestyle/fitness/programs/${programId}/workouts/${workoutId}`, data),
  deleteProgramWorkout: (programId: string, workoutId: string) =>
    api.delete<{ deleted: boolean }>(`/lifestyle/fitness/programs/${programId}/workouts/${workoutId}`),

  // Planned exercises within a workout day
  addProgramExercise: (programId: string, workoutId: string, data: {
    exercise_id: string; order_index?: number; target_sets?: number
    target_reps_min?: number; target_reps_max?: number; target_weight?: number
    target_duration_seconds?: number; target_distance?: number; rest_seconds?: number; notes?: string
  }) => api.post<ProgramExercise>(`/lifestyle/fitness/programs/${programId}/workouts/${workoutId}/exercises`, data),
  deleteProgramExercise: (programId: string, workoutId: string, id: string) =>
    api.delete<{ deleted: boolean }>(`/lifestyle/fitness/programs/${programId}/workouts/${workoutId}/exercises/${id}`),

  // Sessions
  getSessions: (params?: { family_member_id?: string; from_date?: string; to_date?: string; status?: SessionStatus }) =>
    api.get<WorkoutSession[]>(`/lifestyle/fitness/sessions${qs(params ?? {})}`),
  getSession: (id: string) => api.get<WorkoutSessionDetail>(`/lifestyle/fitness/sessions/${id}`),
  startSession: (data: {
    family_member_id: string; program_workout_id?: string; session_date: string
    duration_minutes?: number; perceived_exertion?: number; notes?: string
  }) => api.post<WorkoutSession>('/lifestyle/fitness/sessions', data),
  updateSession: (id: string, data: Partial<{
    duration_minutes: number; status: SessionStatus; perceived_exertion: number; notes: string
  }>) => api.patch<WorkoutSession>(`/lifestyle/fitness/sessions/${id}`, data),
  deleteSession: (id: string) => api.delete<{ deleted: boolean }>(`/lifestyle/fitness/sessions/${id}`),

  // Set logs
  addLog: (sessionId: string, data: {
    exercise_id: string; set_number?: number; reps?: number; weight?: number; weight_unit?: WeightUnit
    duration_seconds?: number; distance?: number; distance_unit?: string; rpe?: number
    is_warmup?: boolean; notes?: string
  }) => api.post<ExerciseLog>(`/lifestyle/fitness/sessions/${sessionId}/logs`, data),
  deleteLog: (sessionId: string, logId: string) =>
    api.delete<{ deleted: boolean }>(`/lifestyle/fitness/sessions/${sessionId}/logs/${logId}`),

  // Records + progress
  getRecords: (params?: { family_member_id?: string; exercise_id?: string }) =>
    api.get<PersonalRecord[]>(`/lifestyle/fitness/records${qs(params ?? {})}`),
  getProgress: (family_member_id: string, exercise_id: string, metric: ProgressMetric) =>
    api.get<ProgressPoint[]>(`/lifestyle/fitness/progress${qs({ family_member_id, exercise_id, metric })}`),

  // AI coach
  getProfile: (family_member_id: string) =>
    api.get<FitnessProfile | null>(`/lifestyle/fitness/ai/profile${qs({ family_member_id })}`),
  saveProfile: (data: {
    family_member_id: string; primary_goal?: ProgramGoal; fitness_level?: FitnessLevel
    activity_level?: ActivityLevel; biological_sex?: BiologicalSex; height_cm?: number; weight_kg?: number; body_fat_pct?: number
    equipment_access?: EquipmentAccess; days_per_week_target?: number; injuries_limitations?: string
  }) => api.put<FitnessProfile>('/lifestyle/fitness/ai/profile', data),
  getCheckins: (family_member_id: string) =>
    api.get<FitnessCheckin[]>(`/lifestyle/fitness/ai/checkins${qs({ family_member_id })}`),
  suggestWorkout: (data: {
    family_member_id: string; energy_level: number; soreness_level: number
    time_available_minutes?: number; focus_override?: ProgramGoal; notes?: string
  }) => api.post<AiSuggestionResult>('/lifestyle/fitness/ai/suggest', data),
}
