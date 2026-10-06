// Row types for the Yuktara Postgres schema (supabase/migrations).
// Hand-written for now; replace with `supabase gen types typescript` once the
// project is linked in CI.

export type UUID = string
export type ISODate = string // 'YYYY-MM-DD'
export type Timestamp = string // ISO 8601, UTC

// ---------- Enums ----------
export type UserRole = 'coach' | 'client'
export type UnitSystem = 'metric' | 'imperial'
export type ClientStatus = 'active' | 'paused' | 'archived'
export type GoalType = 'fat_loss' | 'muscle_gain' | 'performance' | 'health'
export type SessionStatus = 'done' | 'partial' | 'skipped'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type OnPlan = 'yes' | 'partly' | 'no'
export type CheckinStatus = 'due' | 'submitted' | 'reviewed' | 'missed'
export type AnswerType = 'scale' | 'number' | 'text' | 'yes_no'
export type PhotoPose = 'front' | 'side' | 'back'
export type WeekStatus = 'on_track' | 'slipping' | 'off_track'
export type BodyModel = 'female' | 'male'
export type ExerciseLevel = 'beginner' | 'intermediate' | 'advanced'
export type MuscleRole = 'primary' | 'secondary'
export type NoteKind = 'research' | 'coach_tip'
export type TrainLocation = 'gym' | 'home' | 'both'
export type DietType = 'none' | 'vegetarian' | 'eggetarian' | 'vegan' | 'halal' | 'other'
export type MuscleGroup =
  | 'chest' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques' | 'traps' | 'upper_back' | 'lats' | 'lower_back'
  | 'glutes' | 'quads' | 'hamstrings' | 'adductors' | 'calves'

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'traps',
  'upper_back', 'lats', 'lower_back', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves',
]

// ---------- Accounts ----------
export interface User {
  id: UUID
  role: UserRole
  email: string
  full_name: string
  avatar_url: string | null
  timezone: string
  unit_system: UnitSystem
  invite_code: string | null // coaches only
  created_at: Timestamp
}

export interface ClientProfile {
  user_id: UUID
  coach_id: UUID | null // null until linked by invite code or by the coach
  status: ClientStatus
  goal: GoalType | null // null until profile setup is finished
  start_date: ISODate
  height_cm: number | null
  start_weight_kg: number | null
  goal_weight_kg: number | null
  check_in_day: number // 0 = Sunday … 6 = Saturday
  body_model: BodyModel
  coach_notes: string | null // private to the coach
  // Profile setup window (0010_onboarding.sql)
  date_of_birth: ISODate | null
  phone: string | null
  experience: ExerciseLevel | null
  training_days: number | null
  train_location: TrainLocation | null
  injuries: string | null
  diet: DietType | null
  foods_to_avoid: string | null
  meals_per_day: number | null
  cleared_to_exercise: boolean
  setup_completed_at: Timestamp | null
}

// ---------- Training plan ----------
export interface Program {
  id: UUID
  coach_id: UUID
  client_id: UUID | null // null = template
  name: string
  start_date: ISODate | null
  weeks: number
  is_template: boolean
}

export interface WorkoutTemplate {
  id: UUID
  program_id: UUID
  name: string // e.g. Upper A
  day_of_week: number | null
  position: number
  notes: string | null
}

export interface TemplateExercise {
  id: UUID
  workout_template_id: UUID
  exercise_id: UUID
  position: number
  target_sets: number
  target_reps: string // e.g. '6–8'
  target_rpe: number | null
  rest_seconds: number | null
}

export interface Exercise {
  id: UUID
  name: string
  level: ExerciseLevel
  equipment: string | null
  cue: string | null
  video_url: string | null
  created_by: UUID | null // null = library
}

export interface ExerciseMuscle {
  exercise_id: UUID
  muscle: MuscleGroup
  role: MuscleRole
  note_kind: NoteKind | null
  note: string | null
  source_url: string | null
}

// ---------- Training log ----------
export interface WorkoutSession {
  id: UUID
  client_id: UUID
  workout_template_id: UUID | null
  performed_on: ISODate
  started_at: Timestamp | null
  duration_min: number | null
  status: SessionStatus
  effort: number | null // 1–10
  notes: string | null
}

export interface SetLog {
  id: UUID
  session_id: UUID
  exercise_id: UUID
  set_number: number
  reps: number | null
  weight_kg: number | null
  rpe: number | null
  is_warmup: boolean
}

export interface MuscleWeekSets {
  client_id: UUID
  week_start: ISODate
  muscle: MuscleGroup
  hard_sets: number
}

// ---------- Nutrition and habits ----------
export interface NutritionTarget {
  id: UUID
  client_id: UUID
  effective_from: ISODate
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  water_ml: number | null
  steps: number | null
  set_by: UUID
}

export interface MealLog {
  id: UUID
  client_id: UUID
  eaten_at: Timestamp
  meal_type: MealType
  title: string
  photo_url: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  on_plan: OnPlan | null
}

export interface MealItem {
  id: UUID
  meal_log_id: UUID
  food_name: string
  quantity: number
  unit: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

export interface DailyLog {
  id: UUID
  client_id: UUID
  log_date: ISODate
  steps: number | null
  water_ml: number | null
  sleep_hours: number | null
  weight_kg: number | null
}

// ---------- Weekly check-in ----------
export interface CheckIn {
  id: UUID
  client_id: UUID
  week_start: ISODate // a Monday
  status: CheckinStatus
  submitted_at: Timestamp | null
  avg_weight_kg: number | null
  waist_cm: number | null
  hips_cm: number | null
  energy: number | null
  sleep: number | null
  stress: number | null
  hunger: number | null
  wins: string | null
  struggles: string | null
  question: string | null
  reviewed_by: UUID | null
  reviewed_at: Timestamp | null
}

export interface CheckinQuestion {
  id: UUID
  coach_id: UUID
  prompt: string
  answer_type: AnswerType
  position: number
  is_active: boolean
}

export interface CheckinAnswer {
  id: UUID
  check_in_id: UUID
  question_id: UUID
  value_number: number | null
  value_text: string | null
}

export interface ProgressPhoto {
  id: UUID
  check_in_id: UUID
  pose: PhotoPose
  photo_url: string // private bucket path
  taken_on: ISODate
}

export interface Message {
  id: UUID
  client_id: UUID
  sender_id: UUID
  check_in_id: UUID | null // null = chat
  body: string
  created_at: Timestamp
  read_at: Timestamp | null
}

export interface WeeklySummary {
  client_id: UUID
  week_start: ISODate
  workouts_planned: number
  workouts_done: number
  training_pct: number
  meals_logged: number
  meals_on_plan: number
  nutrition_pct: number
  avg_calories: number | null
  avg_protein_g: number | null
  avg_weight_kg: number | null
  weight_change_kg: number | null
  status: WeekStatus
}
