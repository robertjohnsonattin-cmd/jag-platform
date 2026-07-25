export type ExerciseCategory = 'STRENGTH' | 'CARDIO' | 'FLEXIBILITY' | 'BALANCE' | 'SPORT'
export type MuscleGroup =
  | 'CHEST' | 'BACK' | 'LEGS' | 'SHOULDERS' | 'ARMS' | 'CORE' | 'FULL_BODY' | 'CARDIO' | 'OTHER'
export type TrackingType = 'REPS_WEIGHT' | 'TIME' | 'DISTANCE' | 'REPS_ONLY'
export type ProgramGoal =
  | 'STRENGTH' | 'HYPERTROPHY' | 'WEIGHT_LOSS' | 'ENDURANCE' | 'GENERAL_FITNESS' | 'REHAB' | 'OTHER'
export type ProgramStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED'
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED'
export type RecordType = 'MAX_WEIGHT' | 'MAX_1RM_EST' | 'MAX_REPS' | 'MAX_VOLUME' | 'BEST_TIME' | 'BEST_DISTANCE'
export type WeightUnit = 'lb' | 'kg'
export type ProgressMetric = 'weight' | 'est_1rm' | 'volume' | 'reps' | 'distance' | 'time'

export interface Exercise {
  id: string
  name: string
  category: ExerciseCategory
  muscle_group: MuscleGroup
  tracking_type: TrackingType
  equipment: string | null
  instructions: string | null
  is_custom: boolean
  is_active: boolean
  created_at: string
}

export interface WorkoutProgram {
  id: string
  family_member_id: string
  name: string
  goal: ProgramGoal
  description: string | null
  status: ProgramStatus
  start_date: string
  end_date: string | null
  ai_generated: boolean
  created_at: string
}

export interface ProgramWorkout {
  id: string
  program_id: string
  name: string
  day_order: number
  notes: string | null
}

export interface ProgramExercise {
  id: string
  program_workout_id: string
  exercise_id: string
  exercise_name: string
  tracking_type: TrackingType
  muscle_group: MuscleGroup
  order_index: number
  target_sets: number | null
  target_reps_min: number | null
  target_reps_max: number | null
  target_weight: number | null
  target_duration_seconds: number | null
  target_distance: number | null
  rest_seconds: number | null
  notes: string | null
}

export interface ProgramWorkoutWithExercises extends ProgramWorkout {
  exercises: ProgramExercise[]
}

export interface WorkoutProgramDetail extends WorkoutProgram {
  workouts: ProgramWorkoutWithExercises[]
}

export interface WorkoutSession {
  id: string
  family_member_id: string
  program_workout_id: string | null
  workout_name: string | null
  session_date: string
  duration_minutes: number | null
  status: SessionStatus
  perceived_exertion: number | null
  notes: string | null
  set_count?: number
  created_at: string
}

export interface ExerciseLog {
  id: string
  session_id: string
  exercise_id: string
  exercise_name: string
  tracking_type: TrackingType
  set_number: number
  reps: number | null
  weight: number | null
  weight_unit: WeightUnit
  duration_seconds: number | null
  distance: number | null
  distance_unit: string | null
  rpe: number | null
  is_warmup: boolean
  notes: string | null
  created_at: string
}

export interface WorkoutSessionDetail extends WorkoutSession {
  logs: ExerciseLog[]
}

export interface PersonalRecord {
  id: string
  family_member_id: string
  exercise_id: string
  exercise_name: string
  tracking_type: TrackingType
  record_type: RecordType
  value: number
  unit: string
  achieved_date: string
}

export interface ProgressPoint {
  date: string
  value: number | null
}

export type FitnessLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
export type ActivityLevel = 'SEDENTARY' | 'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE' | 'EXTREMELY_ACTIVE'
export type EquipmentAccess = 'HOME_BASIC' | 'HOME_FULL' | 'COMMERCIAL_GYM' | 'BODYWEIGHT_ONLY' | 'OTHER'
export type BiologicalSex = 'MALE' | 'FEMALE' | 'UNSPECIFIED'

export interface FitnessProfile {
  id: string
  family_member_id: string
  primary_goal: ProgramGoal
  fitness_level: FitnessLevel
  activity_level: ActivityLevel
  biological_sex: BiologicalSex
  height_cm: number | null
  weight_kg: number | null
  body_fat_pct: number | null
  equipment_access: EquipmentAccess
  days_per_week_target: number | null
  injuries_limitations: string | null
  last_modified_at: string
}

export interface FitnessCheckin {
  id: string
  family_member_id: string
  checkin_date: string
  energy_level: number
  soreness_level: number
  time_available_minutes: number | null
  focus_override: ProgramGoal | null
  notes: string | null
  suggested_program_id: string | null
  created_at: string
}

export interface AiSuggestionResult {
  program: WorkoutProgramDetail
  checkin: FitnessCheckin
  focus_summary: string
  coaching_note: string
  estimated_duration_minutes: number
}
