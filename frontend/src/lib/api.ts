// Data access for the screens. Each function returns a view model shaped for
// one screen, from one of two sources that never mix:
//
//   Demo mode (no Supabase keys): lib/demo.ts, an in-memory copy of the
//   wireframe data, so every screen is clickable without a backend.
//   Supabase mode: lib/live/*, queries run as the signed-in user (RLS), plus
//   the FastAPI backend (lib/backend.ts) for writes that change several tables.
//
// Fields are nullable where a brand-new account has no data yet; screens show
// an empty state for those, never a made-up number.

import type {
  AnswerType, BodyModel, CheckinStatus, DietType, ExerciseLevel, GoalType, MealType, MuscleGroup, OnPlan,
  PhotoPose, SessionStatus, TrainLocation, UnitSystem, WeekStatus,
} from '@/types/db'
import { backend } from './backend'
import { demo } from './demo'
import { liveClient } from './live/client'
import { liveCoach } from './live/coach'
import { liveMessages } from './live/messages'
import { livePrograms } from './live/programs'
import { draftFromAnswers } from './programs'
import { today } from './dates'
import { isDemo } from './supabase'

export { ApiError } from './backend'

// ---------- Shared ----------
export interface Person { id: string; full_name: string; first_name: string; initials: string }
export interface WeekPoint { label: string; kg: number | null }
export interface CoachNote { coach: Person; title: string; date: string; body: string }
export interface Targets { calories: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; steps: number; sleep_h: number }

// ---------- Client ----------
export interface DaySummary {
  date: string
  is_today: boolean
  logged: boolean
  workout: { name: string; status: SessionStatus | 'planned' } | null
  meals_on_plan: number
  meals_planned: number
  steps: number | null
}

export interface ExerciseLine { name: string; sets: number; reps: string; weight_kg?: number; note?: string }

export interface TodayWorkout {
  name: string
  duration_min: number | null
  exercises: ExerciseLine[]
  sets_done: number
  sets_total: number
}

export interface Meal {
  id: string
  meal_type: MealType
  eaten_at: string
  title: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  on_plan: OnPlan
  photo_url: string | null
}

export interface FoodDay {
  date: string
  /** null until the coach sets targets */
  targets: Targets | null
  meals: Meal[]
  planned: MealType[]
  day_rating: OnPlan | null
}

export interface Habits {
  steps_today: number | null
  water_ml_today: number | null
  sleep_last_night: number | null
  weight_today: number | null
  steps_avg: number | null
  water_ml_avg: number | null
  sleep_avg: number | null
  note: string | null
}

/** One day's habit log. Undefined fields are left as they are. */
export interface DailyPatch { steps?: number | null; water_ml?: number | null; sleep_hours?: number | null; weight_kg?: number | null }

export interface ClientHome {
  today: string
  me: Person & { body_model: BodyModel }
  /** null until a coach is linked */
  coach: Person | null
  /** week 1 is the week containing start_date; weeks is null without a program */
  program: { week: number; weeks: number | null; start_date: string; has_program: boolean; next: NextProgram | null }
  days: DaySummary[]
  week: { workouts_done: number; workouts_planned: number; meals_on_plan: number; meals_planned: number; avg_protein_g: number | null }
  /** 'none' = no check-in open yet; next_date says when the next one opens */
  check_in: { status: CheckinStatus | 'none'; minutes: number; next_date: string | null }
  workout: TodayWorkout | null
  food: FoodDay
  habits: Habits
  weight: { points: WeekPoint[]; current: number | null; change: number | null; goal: number | null; start_date: string }
  coach_note: CoachNote | null
  bests: { exercise: string; reps: number; kg: number; change: number }[]
}

export interface MuscleExercise {
  name: string
  role: 'primary' | 'secondary'
  sets_this_week: number
  cue?: string
  level: ExerciseLevel
  equipment: string
}
export interface MuscleDetail {
  muscle: MuscleGroup
  hard_sets: number
  exercises: MuscleExercise[]
  note?: { kind: 'research' | 'coach_tip'; text: string; source_url?: string }
}

export interface TrainWeek {
  today: string
  week: number
  weeks: number | null
  body_model: BodyModel
  sets: Record<MuscleGroup, number>
  has_program: boolean
  /** an assigned program that starts later */
  next_program: NextProgram | null
  units: UnitSystem
  /** this week's planned workouts, Monday first; empty without a program */
  plan: PlannedWorkout[]
  /** a started, unfinished workout (from any day) */
  open_workout: OpenWorkout | null
  recent: WorkoutSummary[]
}

// ---------- Workouts ----------
/** An exercise from the shared library (or the coach's own), as the picker shows it. */
export interface LibraryExercise {
  id: string
  name: string
  level: ExerciseLevel
  equipment: string
  cue: string | null
  primary: MuscleGroup[]
  secondary: MuscleGroup[]
}

/** One slot of a planned workout, with this week's program swaps applied. */
export interface PlannedExercise {
  template_exercise_id: string
  exercise_id: string
  name: string
  sets: number
  reps: string
  rpe: number | null
  rest_seconds: number | null
  cue: string | null
  /** the coach's note for this exercise */
  notes: string | null
}

export type PlannedStatus = 'done' | 'in_progress' | 'today' | 'missed' | 'upcoming' | 'anytime'

export interface PlannedWorkout {
  template_id: string
  name: string
  /** this week's date for it; null if the coach gave it no day */
  date: string | null
  notes: string | null
  exercises: PlannedExercise[]
  status: PlannedStatus
  /** the session that did it (done or in progress) */
  session_id: string | null
}

export interface OpenWorkout { id: string; name: string; performed_on: string; started_at: string | null; sets_done: number }

export interface LoggedSet { set_number: number; weight_kg: number | null; reps: number | null; rpe: number | null }

/** A set as saved: which exercise, and which planned slot it was logged against (null = added by the client). */
export interface SetWrite extends LoggedSet { exercise_id: string; template_exercise_id: string | null }

export interface WorkoutLog {
  id: string
  name: string
  template_id: string | null
  performed_on: string
  started_at: string | null
  finished_at: string | null
  duration_min: number | null
  notes: string
  units: UnitSystem
  /** the coach's note on this workout (workout_templates.notes) */
  coach_notes: string | null
  /** the planned slots in order; empty for the client's own workout */
  plan: PlannedExercise[]
  /** every saved (ticked) set */
  sets: SetWrite[]
}

/** The client's most recent sets of an exercise, before this session. */
export interface LastTime { date: string; sets: LoggedSet[] }

export interface WorkoutSummary {
  id: string
  name: string
  performed_on: string
  finished: boolean
  duration_min: number | null
  sets: number
  /** Σ weight × reps, in kg */
  volume_kg: number
  muscles: MuscleGroup[]
  notes: string | null
  exercises: { name: string; sets: LoggedSet[] }[]
}

/** A program the coach assigned that hasn't started yet. */
export interface NextProgram { name: string; start_date: string }

export interface CheckinQuestion { id: string; prompt: string; answer_type: AnswerType }
export interface CheckinAnswerValue { value_number?: number | null; value_text?: string | null }

export interface CheckinDraft {
  /** check_ins.id; set when the draft comes from Supabase. */
  id?: string
  week_start: string
  week: number
  auto: { workouts_done: number; workouts_planned: number; meals_on_plan: number; meals_planned: number; steps_avg: number | null; avg_weight_kg: number | null }
  weight_kg: number | null
  waist_cm: number | null
  hips_cm: number | null
  energy: number | null
  sleep: number | null
  stress: number | null
  hunger: number | null
  /** storage paths (saved) or blob: URLs (picked, not uploaded yet) */
  photos: Partial<Record<PhotoPose, string>>
  /** what to show for each photo (signed URLs or blob: URLs) */
  photo_previews?: Partial<Record<PhotoPose, string>>
  wins: string
  struggles: string
  question: string
  /** the coach's own questions */
  questions?: CheckinQuestion[]
  answers?: Record<string, CheckinAnswerValue>
  status: CheckinStatus
}

export interface ClientProgress {
  start_date: string
  week: number
  weeks: number | null
  weight: { points: WeekPoint[]; current: number | null; change: number | null; goal: number | null }
  plan: { label: string; pct: number | null; partial?: boolean }[]
  plan_target: number
  waist: { cm: number; change: number } | null
  lift: { exercise: string; reps: number; kg: number; change: number } | null
  coach_note: CoachNote | null
}

// ---------- Programs (coach builder) ----------
export interface ProgramExercise {
  /** null until saved */
  id: string | null
  exercise_id: string
  name: string
  sets: number
  reps: string
  rpe: number | null
  rest_seconds: number | null
  notes: string
}

export interface ProgramWorkout {
  id: string | null
  name: string
  /** 0 = Sunday; null = any day */
  day_of_week: number | null
  notes: string
  exercises: ProgramExercise[]
}

/** template: reusable; draft: not assigned yet; upcoming/active/ended: assigned to the client. */
export type ProgramStatus = 'template' | 'draft' | 'upcoming' | 'active' | 'ended'

export interface Program {
  /** null = generated, not saved yet */
  id: string | null
  /** null for a template */
  client_id: string | null
  name: string
  weeks: number
  goal: GoalType | null
  level: ExerciseLevel | null
  days_per_week: number | null
  status: ProgramStatus
  /** when an assigned program starts */
  start_date: string | null
  /** the start date picked for a draft */
  draft_start: string | null
  /** program week today, when active */
  week: number | null
  workouts: ProgramWorkout[]
  /** from the generator (unsaved drafts only) */
  warnings?: string[]
}

/** The Programs page's "Clients" view: setup answers and where each client's program stands. */
export interface ProgramClientRow {
  client: Person
  setup_done: boolean
  goal: GoalType | null
  experience: ExerciseLevel | null
  training_days: number | null
  train_location: TrainLocation | null
  injuries: string | null
  current: { id: string; name: string; week: number; weeks: number; start_date: string } | null
  upcoming: { id: string; name: string; start_date: string } | null
  draft: { id: string; name: string } | null
}

export interface ProgramTemplateRow {
  id: string
  name: string
  goal: GoalType | null
  level: ExerciseLevel | null
  days_per_week: number | null
  weeks: number
  workouts: number
}

// ---------- Messages ----------
// One conversation per client (messages.client_id): the client and their coach.
export interface ChatMessage {
  id: string
  body: string
  created_at: string
  from_me: boolean
  sender: Person
  /** set when the message is check-in feedback (sent with a review) */
  check_in: { id: string; week_start: string } | null
  read_at: string | null
}

export interface MessageThread {
  client: Person
  /** who the signed-in user is talking to: the coach (client app) or the client (coach app); null without a coach */
  other: Person | null
  /** oldest first */
  messages: ChatMessage[]
  can_send: boolean
}

/** A row in the coach's conversation list. */
export interface Conversation {
  client: Person
  last: { body: string; created_at: string; from_me: boolean; feedback: boolean } | null
  /** the client's messages the coach hasn't read */
  unread: number
}

/** A past check-in as the client sent it, with the coach's feedback (read-only). */
export interface CheckinSummary {
  id: string
  week_start: string
  status: CheckinStatus
  submitted_at: string | null
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
  feedback: ChatMessage[]
}

// ---------- Coach ----------
export type ClientWeekStatus = 'on_track' | 'slipping' | 'overdue' | 'awaiting'

export interface ClientRow {
  client: Person
  goal: GoalType | null
  week: number
  weeks: number | null
  days_logged: number
  workouts_done: number
  workouts_planned: number
  food_pct: number | null
  weight_trend: number[]
  weight_change: number | null
  last_check_in: string
  status: ClientWeekStatus
  /** in their first program week */
  is_new: boolean
  setup_done: boolean
  has_targets: boolean
}

export interface QueueItem {
  check_in_id: string
  client: Person
  submitted_at: string
  submitted_label: string
  plan_pct: number | null
  weight_change: number | null
  flags: string[]
  has_question: boolean
  status: CheckinStatus
}

export interface AttentionItem { client: Person; status: ClientWeekStatus; text: string; action: string }

export interface CoachDashboard {
  today: string
  coach: Person
  invite_code: string | null
  stats: {
    active: number; new_this_month: number; checked_in: number; reviewed: number; waiting: number
    plan_pct: number | null; plan_change: number | null; attention: Person[]
  }
  queue: QueueItem[]
  attention: AttentionItem[]
  clients: ClientRow[]
  total_clients: number
}

export interface CheckinReview {
  check_in_id: string
  client: Person
  goal: GoalType | null
  week: number
  weeks: number | null
  start_date: string
  check_in_weekday: string
  status: WeekStatus | null
  week_start: string
  submitted_at: string
  avg_weight_kg: number | null
  weight_change: number | null
  waist_cm: number | null
  waist_change: number | null
  workouts_done: number
  workouts_planned: number
  skipped_note: string | null
  meals_pct: number | null
  meals_on_plan: number
  meals_planned: number
  energy: number | null
  sleep: number | null
  stress: number | null
  hunger: number | null
  wins: string
  struggles: string
  question: string | null
  answers: { prompt: string; value: string }[]
  weights: WeekPoint[]
  goal_kg: number | null
  projection_kg: number | null
  plan_by_week: { label: string; training: number; food: number }[]
  photos: { pose: PhotoPose; url: string | null }[]
  draft: string
  draft_saved_at: string | null
  /** targets in force now; null if the coach hasn't set any */
  targets: Targets | null
  suggestion: {
    title: string
    text: string
    /** What POST /programs/swap needs; present when the swap can be applied in one click. */
    swap?: SwapRequest
  } | null
  private_notes: string
  queue_position: number
  queue_total: number
  prev_id: string | null
  next_id: string | null
}

export interface CheckinLists {
  today: string
  week_start: string
  checked_in: number
  total: number
  to_review: QueueItem[]
  not_in: { client: Person; due_label: string; status: ClientWeekStatus }[]
  done: QueueItem[]
}

/** A client's setup answers and current targets, for the coach. */
export interface ClientDetail {
  client: Person
  email: string
  setup_done: boolean
  goal: GoalType | null
  start_date: string
  week: number
  date_of_birth: string | null
  height_cm: number | null
  start_weight_kg: number | null
  goal_weight_kg: number | null
  check_in_day: number
  experience: ExerciseLevel | null
  training_days: number | null
  train_location: TrainLocation | null
  injuries: string | null
  diet: DietType | null
  foods_to_avoid: string | null
  meals_per_day: number | null
  targets: Targets | null
  targets_from: string | null
  /** the program running now (or starting next), and any unassigned draft */
  program: { id: string; name: string; status: ProgramStatus; week: number | null; weeks: number; start_date: string | null } | null
  draft_program_id: string | null
}

export interface SwapRequest { template_exercise_id: string; to_exercise_id: string; from_week: number; to_week: number }

// ---------- API ----------
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 120))

export const api = {
  // client
  clientHome: (): Promise<ClientHome> => (isDemo ? wait(demo.clientHome()) : liveClient.home()),
  trainWeek: (): Promise<TrainWeek> => (isDemo ? wait(demo.trainWeek()) : liveClient.trainWeek()),
  muscle: (m: MuscleGroup): Promise<MuscleDetail> => (isDemo ? wait(demo.muscle(m)) : liveClient.muscle(m)),
  foodDay: (date: string): Promise<FoodDay> => (isDemo ? wait(demo.foodDay(date)) : liveClient.foodDay(date)),
  rateDay: (date: string, rating: OnPlan) => (isDemo ? wait(demo.rateDay(date, rating)) : liveClient.rateDay(date, rating)),
  logMeal: (date: string, meal: Omit<Meal, 'id'>) => (isDemo ? wait(demo.logMeal(date, meal)) : liveClient.logMeal(date, meal)),
  logDaily: (date: string, patch: DailyPatch) => (isDemo ? wait(demo.logDaily(date, patch)) : liveClient.logDaily(date, patch)),
  /** null when no check-in is open (ClientHome.check_in.next_date says when it opens) */
  checkinDraft: (): Promise<CheckinDraft | null> => (isDemo ? wait(demo.checkinDraft()) : liveClient.checkinDraft()),
  saveCheckin: (patch: Partial<CheckinDraft>) => (isDemo ? wait(demo.saveCheckin(patch)) : liveClient.saveCheckin(patch)),
  /** Demo: marks the in-memory draft sent. Live: POST /checkins/{id}/submit (uploads photos first). */
  submitCheckin: (draft: CheckinDraft): Promise<CheckinDraft> => (isDemo ? wait(demo.submitCheckin()) : liveClient.submitCheckin(draft)),
  progress: (): Promise<ClientProgress> => (isDemo ? wait(demo.progress()) : liveClient.progress()),
  setBodyModel: (m: BodyModel) => (isDemo ? wait(demo.setBodyModel(m)) : liveClient.setBodyModel(m)),

  // workouts (client writes straight to Supabase, RLS: only their own sessions and sets)
  exerciseLibrary: (): Promise<LibraryExercise[]> => (isDemo ? wait(demo.exerciseLibrary()) : liveClient.exerciseLibrary()),
  /** Starts a session (templateId null = the client's own workout), or returns the one already open. */
  startWorkout: (templateId: string | null): Promise<{ id: string }> =>
    isDemo ? wait(demo.startWorkout(templateId)) : liveClient.startWorkout(templateId),
  workoutLog: (id: string): Promise<WorkoutLog> => (isDemo ? wait(demo.workoutLog(id)) : liveClient.workoutLog(id)),
  lastTime: (sessionId: string, exerciseIds: string[]): Promise<Record<string, LastTime>> =>
    isDemo ? wait(demo.lastTime(sessionId, exerciseIds)) : liveClient.lastTime(sessionId, exerciseIds),
  saveSet: (sessionId: string, set: SetWrite) => (isDemo ? wait(demo.saveSet(sessionId, set)) : liveClient.saveSet(sessionId, set)),
  deleteSet: (sessionId: string, exerciseId: string, setNumber: number) =>
    isDemo ? wait(demo.deleteSet(sessionId, exerciseId, setNumber)) : liveClient.deleteSet(sessionId, exerciseId, setNumber),
  saveWorkoutNote: (id: string, notes: string) => (isDemo ? wait(demo.saveWorkoutNote(id, notes)) : liveClient.saveWorkoutNote(id, notes)),
  finishWorkout: (id: string): Promise<WorkoutSummary> => (isDemo ? wait(demo.finishWorkout(id)) : liveClient.finishWorkout(id)),
  /** Deletes an open session with nothing logged. */
  discardWorkout: (id: string) => (isDemo ? wait(demo.discardWorkout(id)) : liveClient.discardWorkout(id)),

  // coach
  coachDashboard: (): Promise<CoachDashboard> => (isDemo ? wait(demo.coachDashboard()) : liveCoach.dashboard()),
  checkinLists: (): Promise<CheckinLists> => (isDemo ? wait(demo.checkinLists()) : liveCoach.checkinLists()),
  checkinReview: (id: string): Promise<CheckinReview> => (isDemo ? wait(demo.checkinReview(id)) : liveCoach.checkinReview(id)),
  saveReviewDraft: (id: string, patch: { draft?: string; private_notes?: string }) =>
    isDemo ? wait(demo.saveReviewDraft(id, patch)) : liveCoach.saveReviewDraft(id, patch),
  sendReview: (id: string, body: { message: string; mark_reviewed: boolean; targets: Targets | null }) =>
    isDemo ? wait(demo.sendReview(id, body)) : backend<{ next_id: string | null }>(`/checkins/${id}/review`, body),
  applySuggestion: (id: string, swap?: SwapRequest) => (isDemo ? wait(demo.applySuggestion(id)) : liveCoach.applySuggestion(id, swap)),
  clientDetail: (clientId: string): Promise<ClientDetail> => (isDemo ? wait(demo.clientDetail(clientId)) : liveCoach.clientDetail(clientId)),
  /** The coach sets targets that apply from today. */
  setTargets: (clientId: string, targets: Targets) => (isDemo ? wait(demo.setTargets(clientId, targets)) : liveCoach.setTargets(clientId, targets)),
  // messages (both apps; plain messages go straight to Supabase, RLS + a rate-limit trigger, 0014)
  /** clientId null = the signed-in client's own conversation with their coach */
  messageThread: (clientId: string | null): Promise<MessageThread> =>
    isDemo ? wait(demo.messageThread(clientId)) : liveMessages.thread(clientId),
  sendMessage: (clientId: string | null, body: string): Promise<ChatMessage> =>
    isDemo ? wait(demo.sendMessage(clientId, body)) : liveMessages.send(clientId, body),
  /** Marks the other side's messages in this conversation read. */
  markThreadRead: (clientId: string | null) => (isDemo ? wait(demo.markThreadRead(clientId)) : liveMessages.markRead(clientId)),
  unreadMessages: (): Promise<number> => (isDemo ? wait(demo.unreadMessages()) : liveMessages.unreadCount()),
  conversations: (): Promise<Conversation[]> => (isDemo ? wait(demo.conversations()) : liveMessages.conversations()),
  checkinSummary: (id: string): Promise<CheckinSummary> => (isDemo ? wait(demo.checkinSummary(id)) : liveMessages.checkinSummary(id)),

  // programs (coach; save/assign/copy are database functions run as the coach, RLS, 0015)
  programClients: (): Promise<ProgramClientRow[]> => (isDemo ? wait(demo.programClients()) : livePrograms.clients()),
  programTemplates: (): Promise<ProgramTemplateRow[]> => (isDemo ? wait(demo.programTemplates()) : livePrograms.templates()),
  program: (id: string): Promise<Program> => (isDemo ? wait(demo.program(id)) : livePrograms.get(id)),
  /** A first draft built in the browser from the client's setup answers (programGen.ts). Not saved. */
  generateProgram: async (clientId: string): Promise<Program> => {
    const [detail, library] = await Promise.all([api.clientDetail(clientId), api.exerciseLibrary()])
    return draftFromAnswers(detail, library, today())
  },
  saveProgram: (p: Program): Promise<{ id: string }> => (isDemo ? wait(demo.saveProgram(p)) : livePrograms.save(p)),
  /** Makes it the client's program from `start`; the previous one stops there. */
  assignProgram: (id: string, start: string) => (isDemo ? wait(demo.assignProgram(id, start)) : livePrograms.assign(id, start)),
  /** clientId null = save as a template; otherwise a new draft for that client. */
  copyProgram: (id: string, clientId: string | null): Promise<{ id: string }> =>
    isDemo ? wait(demo.copyProgram(id, clientId)) : livePrograms.copy(id, clientId),
  /** Drafts and templates only. */
  deleteProgram: (id: string) => (isDemo ? wait(demo.deleteProgram(id)) : livePrograms.remove(id)),

  /** A client's logged workouts, newest first (read-only for the coach). */
  clientWorkouts: (clientId: string): Promise<WorkoutSummary[]> =>
    isDemo ? wait(demo.clientWorkouts(clientId)) : liveCoach.clientWorkouts(clientId),
}

/** Everything that shows logged training; invalidated after each set is saved. */
export const TRAINING_KEYS = [['train'], ['client-home'], ['progress'], ['muscle'], ['checkin']] as const

export type Api = typeof api

/**
 * Coach screens refetch every 30 s and when the window regains focus, so a
 * client's new logs show up without a reload. Chosen over Supabase Realtime:
 * the coach views combine several tables (a change would trigger a refetch
 * anyway), polling needs no publication or extra RLS setup, and 30 s is plenty
 * for coaching. Client screens refresh from their own writes instead.
 */
export const COACH_REFRESH = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const

/**
 * Messages poll instead of using Realtime (reasons in docs/api.md): an open
 * conversation every 5 s, the conversation list and unread badges every 15 s.
 * React Query pauses both while the tab is hidden and refetches on focus.
 */
export const THREAD_REFRESH = { refetchInterval: 5_000, refetchOnWindowFocus: true } as const
export const UNREAD_REFRESH = { refetchInterval: 15_000, refetchOnWindowFocus: true } as const
