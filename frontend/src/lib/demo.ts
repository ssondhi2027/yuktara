// In-memory demo data: Sunday, Oct 4 2026, week 6 of Aisha's 12-week program,
// as drawn in the "Yuktara — Client & Coach UI" wireframes. Mutations change
// this copy so the prototype responds to clicks; a reload resets it.

import type { BodyModel, ExerciseLevel, MealType, MuscleGroup, OnPlan } from '@/types/db'
import type {
  CheckinDraft, CheckinLists, CheckinReview, ClientDetail, ClientHome, ClientProgress, ClientRow,
  ChatMessage, CheckinSummary, FoodDraft, PlanWeek, ClientHistory, CoachClientRow, CoachDashboard, CoachNote, CoachQuestion, CoachSettings, Conversation,
  MyProfile, NutritionRow, ProfilePatch, TargetVersion, DailyPatch, DaySummary, FoodDay, LastTime,
  LibraryExercise, Meal, MessageThread, MuscleDetail, NextProgram, Person, PlannedExercise, Program, ProgramClientRow,
  ProgramTemplateRow, ProgramWorkout, QueueItem, SetWrite, Targets, TodayWorkout, TrainWeek, WorkoutLog, WorkoutSummary,
} from './api'
import type { ClientStatus, DietType, ExerciseLevel as Level, GoalType, TrainLocation } from '@/types/db'
import { addDays, pinToday } from './dates'
import { bodyWeight } from './units'
import { ApiError } from './backend'
import { inSetOrder, minutesSince, OWN_WORKOUT, summarize, weekPlan, type PlanTemplate } from './workouts'
import { generateProgram } from './programGen'
import { mondayOf, plusDays, progressFrom, type Period, type ProgressDetail, type ProgressRaw } from './progress'
import { weightSignals } from './forecast'
import type { ExerciseDraft } from './exercises'
import { SHARED_FOODS } from './foodList'
import { isTrainingDay, mealsFor, type Food, type FoodLine, type MealPlan } from './meals'
import { planForDay, planWeekFrom } from './mealPlans'
import { programStatus, programWeekOf } from './programs'
import { getCurrentUser } from './session'
import { isDemo } from './supabase'

const TODAY = '2026-10-04'
const WEEK_START = '2026-09-28'

// Demo mode runs on the date the wireframes were drawn for.
if (isDemo) pinToday(TODAY)

/**
 * The demo accounts (demo mode only; passwords aren't checked):
 * coach@demo.test opens the coach app, any other email is the client.
 */
export const DEMO_ACCOUNTS = {
  coach: { id: 'coach-ss', email: 'coach@demo.test', full_name: 'Simranvir Sondhi' },
  client: { id: 'c-aisha', email: 'aisha.rahman@example.com', full_name: 'Aisha Rahman' },
  invite_code: 'SIMRAN-7Q4',
}

const person = (id: string, full_name: string): Person => {
  const parts = full_name.split(' ')
  return { id, full_name, first_name: parts[0], initials: parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase() }
}

const coach = person('coach-ss', 'Simranvir Sondhi')
const signedIn = () => {
  const u = getCurrentUser()
  return u?.full_name ? person(u.id, u.full_name) : null
}
const aisha = person('c-aisha', 'Aisha Rahman')

// ---------- Client: Aisha ----------
const targets: Targets = { calories: 2100, protein_g: 140, carbs_g: 210, fat_g: 70, water_ml: 2500, steps: 9000, sleep_h: 7.5 }

const workout: TodayWorkout = {
  name: 'Full body C',
  duration_min: 50,
  sets_done: 3,
  sets_total: 19,
  exercises: [
    { name: 'Back squat', sets: 4, reps: '6', weight_kg: 82.5 },
    { name: 'Romanian deadlift', sets: 3, reps: '8', weight_kg: 70 },
    { name: 'Dumbbell bench press', sets: 3, reps: '10', weight_kg: 18 },
    { name: 'Seated cable row', sets: 3, reps: '12', weight_kg: 45 },
    { name: 'Walking lunge', sets: 3, reps: '10', note: 'each leg' },
    { name: 'Plank', sets: 3, reps: '45 s' },
  ],
}

const days: DaySummary[] = ([
  { date: '2026-09-28', workout: { name: 'Upper A', status: 'done' }, meals_on_plan: 3, meals_planned: 3, steps: 9410 },
  { date: '2026-09-29', workout: { name: 'Lower A', status: 'done' }, meals_on_plan: 3, meals_planned: 3, steps: 10220 },
  { date: '2026-09-30', workout: null, meals_on_plan: 2, meals_planned: 3, steps: 7080 },
  { date: '2026-10-01', workout: { name: 'Upper B', status: 'skipped' }, meals_on_plan: 2, meals_planned: 3, steps: 6010 },
  { date: '2026-10-02', workout: null, meals_on_plan: 3, meals_planned: 3, steps: 8790 },
  { date: '2026-10-03', workout: null, meals_on_plan: 1, meals_planned: 2, steps: 11270 },
  { date: TODAY, workout: { name: 'Full body C', status: 'planned' }, meals_on_plan: 3, meals_planned: 3, steps: 6420 },
] as Omit<DaySummary, 'is_today' | 'logged'>[]).map((d) => ({ ...d, is_today: d.date === TODAY, logged: d.date !== TODAY }))

const meal = (id: string, meal_type: MealType, time: string, title: string, calories: number, p: number, c: number, f: number, on_plan: OnPlan = 'yes'): Meal => ({
  id, meal_type, eaten_at: `${TODAY}T${time}:00`, title, calories, protein_g: p, carbs_g: c, fat_g: f, on_plan, photo_url: null,
})

const foodDays = new Map<string, FoodDay>()
foodDays.set(TODAY, {
  date: TODAY,
  targets,
  targets_from: '2026-08-24',
  next_targets: null,
  planned: ['breakfast', 'snack', 'lunch', 'dinner'],
  day_rating: 'yes',
  plan: null,
  meals: [
    meal('m1', 'breakfast', '08:10', 'Greek yogurt, berries, granola', 420, 32, 48, 11),
    meal('m2', 'snack', '10:45', 'Protein shake', 210, 30, 12, 5),
    meal('m3', 'lunch', '12:30', 'Chicken rice bowl', 610, 48, 72, 14),
  ],
})

function pastFoodDay(date: string): FoodDay {
  const at = (t: string) => `${date}T${t}:00`
  return {
    date,
    targets,
    targets_from: '2026-08-24',
    next_targets: null,
    planned: ['breakfast', 'lunch', 'dinner'],
    day_rating: 'yes',
    plan: null,
    meals: [
      { ...meal(`${date}-b`, 'breakfast', '08:00', 'Oats, whey, banana', 480, 38, 66, 9), eaten_at: at('08:00') },
      { ...meal(`${date}-l`, 'lunch', '12:45', 'Turkey wrap and salad', 590, 44, 58, 18), eaten_at: at('12:45') },
      { ...meal(`${date}-d`, 'dinner', '19:10', 'Salmon, potatoes, greens', 720, 46, 70, 26), eaten_at: at('19:10') },
    ],
  }
}

let bodyModel: BodyModel = 'female'

const habitsToday = { steps_today: 6420 as number | null, water_ml_today: 1500 as number | null, sleep_last_night: (7 + 10 / 60) as number | null, weight_today: 71.6 as number | null }

const sets: Record<MuscleGroup, number> = {
  chest: 9, shoulders: 6, biceps: 4, triceps: 6, forearms: 0, abs: 3, obliques: 0, traps: 2,
  upper_back: 8, lats: 8, lower_back: 0, glutes: 10, quads: 12, hamstrings: 6, adductors: 2, calves: 4,
}

// Exercise library: muscle roles drive the body map (each working set counts
// once for every primary muscle of its exercise).
const library: { name: string; level: ExerciseLevel; equipment: string; primary: MuscleGroup[]; secondary: MuscleGroup[]; week: number; cue: string }[] = [
  { name: "Barbell bench press", level: 'intermediate', equipment: 'barbell', primary: ['chest'], secondary: ['triceps', 'shoulders'], week: 0, cue: "Feet planted, bar to mid-chest, press back over the shoulders." },
  { name: "Dumbbell bench press", level: 'beginner', equipment: 'dumbbells', primary: ['chest'], secondary: ['triceps', 'shoulders'], week: 6, cue: "Shoulder blades pinned, elbows about 45 degrees." },
  { name: "Incline dumbbell press", level: 'beginner', equipment: 'dumbbells', primary: ['chest'], secondary: ['shoulders', 'triceps'], week: 3, cue: "Bench at 30 degrees, lower to the upper chest." },
  { name: "Push-up", level: 'beginner', equipment: 'bodyweight', primary: ['chest'], secondary: ['triceps', 'shoulders', 'abs'], week: 0, cue: "Body in one line, chest to the floor." },
  { name: "Cable fly", level: 'beginner', equipment: 'cable', primary: ['chest'], secondary: ['shoulders'], week: 0, cue: "Soft elbows, hug a big tree." },
  { name: "Overhead press", level: 'intermediate', equipment: 'barbell', primary: ['shoulders'], secondary: ['triceps', 'traps'], week: 3, cue: "Squeeze glutes, press up and slightly back." },
  { name: "Seated dumbbell shoulder press", level: 'beginner', equipment: 'dumbbells', primary: ['shoulders'], secondary: ['triceps'], week: 0, cue: "Back against the pad, press to just short of lockout." },
  { name: "Lateral raise", level: 'beginner', equipment: 'dumbbells', primary: ['shoulders'], secondary: ['traps'], week: 3, cue: "Lead with the elbows, stop at shoulder height." },
  { name: "Rear delt fly", level: 'beginner', equipment: 'dumbbells', primary: ['shoulders'], secondary: ['upper_back'], week: 0, cue: "Hinge forward, sweep the arms wide, no swinging." },
  { name: "Face pull", level: 'beginner', equipment: 'cable', primary: ['shoulders', 'upper_back'], secondary: ['traps'], week: 2, cue: "Pull to the eyes, thumbs back." },
  { name: "Dumbbell curl", level: 'beginner', equipment: 'dumbbells', primary: ['biceps'], secondary: ['forearms'], week: 4, cue: "Elbows pinned to the sides." },
  { name: "Barbell curl", level: 'beginner', equipment: 'barbell', primary: ['biceps'], secondary: ['forearms'], week: 0, cue: "No hip swing, full range." },
  { name: "Hammer curl", level: 'beginner', equipment: 'dumbbells', primary: ['biceps', 'forearms'], secondary: [], week: 0, cue: "Thumbs up the whole way." },
  { name: "Incline dumbbell curl", level: 'intermediate', equipment: 'dumbbells', primary: ['biceps'], secondary: [], week: 0, cue: "Let the arms hang behind the body." },
  { name: "Rope pushdown", level: 'beginner', equipment: 'cable', primary: ['triceps'], secondary: [], week: 6, cue: "Elbows still, spread the rope at the bottom." },
  { name: "Overhead triceps extension", level: 'beginner', equipment: 'cable', primary: ['triceps'], secondary: [], week: 0, cue: "Elbows point forward, reach long." },
  { name: "Close-grip bench press", level: 'intermediate', equipment: 'barbell', primary: ['triceps', 'chest'], secondary: ['shoulders'], week: 0, cue: "Hands shoulder-width, elbows tucked." },
  { name: "Dips", level: 'intermediate', equipment: 'bodyweight', primary: ['triceps', 'chest'], secondary: ['shoulders'], week: 0, cue: "Slight lean, shoulders down." },
  { name: "Farmer's carry", level: 'beginner', equipment: 'dumbbells', primary: ['forearms', 'traps'], secondary: ['obliques', 'abs'], week: 0, cue: "Tall posture, short quick steps." },
  { name: "Wrist curl", level: 'beginner', equipment: 'dumbbells', primary: ['forearms'], secondary: [], week: 0, cue: "Forearms on the bench, curl just the wrists." },
  { name: "Reverse curl", level: 'beginner', equipment: 'barbell', primary: ['forearms'], secondary: ['biceps'], week: 0, cue: "Overhand grip, wrists straight." },
  { name: "Dead hang", level: 'beginner', equipment: 'pull-up bar', primary: ['forearms'], secondary: ['lats'], week: 0, cue: "Shoulders active, breathe." },
  { name: "Plank", level: 'beginner', equipment: 'bodyweight', primary: ['abs'], secondary: ['obliques'], week: 3, cue: "Ribs down, squeeze glutes, breathe." },
  { name: "Hanging knee raise", level: 'intermediate', equipment: 'pull-up bar', primary: ['abs'], secondary: ['obliques'], week: 0, cue: "Curl the pelvis up, no swinging." },
  { name: "Cable crunch", level: 'beginner', equipment: 'cable', primary: ['abs'], secondary: [], week: 0, cue: "Round the spine, hips stay still." },
  { name: "Dead bug", level: 'beginner', equipment: 'bodyweight', primary: ['abs'], secondary: ['obliques'], week: 0, cue: "Low back stays on the floor." },
  { name: "Ab wheel rollout", level: 'advanced', equipment: 'ab wheel', primary: ['abs'], secondary: ['lats', 'obliques'], week: 0, cue: "Hips and ribs move together." },
  { name: "Side plank", level: 'beginner', equipment: 'bodyweight', primary: ['obliques'], secondary: ['abs'], week: 0, cue: "Hips high, straight line head to heel." },
  { name: "Pallof press", level: 'beginner', equipment: 'cable', primary: ['obliques'], secondary: ['abs'], week: 0, cue: "Resist the twist, press straight out." },
  { name: "Cable woodchop", level: 'beginner', equipment: 'cable', primary: ['obliques'], secondary: ['abs', 'shoulders'], week: 0, cue: "Rotate through the hips and trunk." },
  { name: "Suitcase carry", level: 'beginner', equipment: 'dumbbells', primary: ['obliques', 'forearms'], secondary: ['traps'], week: 0, cue: "Weight in one hand, stay level." },
  { name: "Dumbbell shrug", level: 'beginner', equipment: 'dumbbells', primary: ['traps'], secondary: ['forearms'], week: 0, cue: "Straight up to the ears, pause." },
  { name: "Seated cable row", level: 'beginner', equipment: 'cable', primary: ['upper_back', 'lats'], secondary: ['biceps'], week: 4, cue: "Chest tall, pull to the belly button." },
  { name: "Chest-supported dumbbell row", level: 'beginner', equipment: 'dumbbells', primary: ['upper_back', 'lats'], secondary: ['biceps', 'shoulders'], week: 0, cue: "Chest on the pad, drive the elbows back." },
  { name: "Bent-over barbell row", level: 'intermediate', equipment: 'barbell', primary: ['upper_back', 'lats'], secondary: ['lower_back', 'biceps'], week: 0, cue: "Flat back, bar to the lower ribs." },
  { name: "Lat pulldown", level: 'beginner', equipment: 'cable', primary: ['lats', 'upper_back'], secondary: ['biceps'], week: 4, cue: "Pull elbows down to the ribs." },
  { name: "Pull-up", level: 'intermediate', equipment: 'pull-up bar', primary: ['lats', 'upper_back'], secondary: ['biceps', 'forearms'], week: 0, cue: "Full hang to chin over the bar." },
  { name: "Single-arm dumbbell row", level: 'beginner', equipment: 'dumbbells', primary: ['lats', 'upper_back'], secondary: ['biceps'], week: 0, cue: "Pull the elbow to the hip." },
  { name: "Straight-arm pulldown", level: 'beginner', equipment: 'cable', primary: ['lats'], secondary: ['triceps'], week: 0, cue: "Arms long, sweep the bar to the thighs." },
  { name: "Back extension", level: 'beginner', equipment: 'bench', primary: ['lower_back'], secondary: ['glutes', 'hamstrings'], week: 0, cue: "Hinge at the hips, stop in line with the legs." },
  { name: "Bird dog", level: 'beginner', equipment: 'bodyweight', primary: ['lower_back'], secondary: ['glutes', 'abs'], week: 0, cue: "Reach long, keep the hips square." },
  { name: "Deadlift", level: 'intermediate', equipment: 'barbell', primary: ['glutes', 'hamstrings', 'lower_back'], secondary: ['quads', 'traps', 'forearms'], week: 0, cue: "Bar over mid-foot, push the floor away." },
  { name: "Good morning", level: 'intermediate', equipment: 'barbell', primary: ['hamstrings', 'lower_back'], secondary: ['glutes'], week: 0, cue: "Soft knees, hips back, flat back." },
  { name: "Hip thrust", level: 'beginner', equipment: 'barbell', primary: ['glutes'], secondary: ['hamstrings'], week: 0, cue: "Chin tucked, ribs down, pause at the top." },
  { name: "Glute bridge", level: 'beginner', equipment: 'bodyweight', primary: ['glutes'], secondary: ['hamstrings'], week: 0, cue: "Drive through the heels, squeeze at the top." },
  { name: "Cable kickback", level: 'beginner', equipment: 'cable', primary: ['glutes'], secondary: [], week: 0, cue: "Small lean, kick back without arching." },
  { name: "Back squat", level: 'intermediate', equipment: 'barbell', primary: ['quads', 'glutes'], secondary: ['adductors', 'lower_back'], week: 4, cue: "Brace, sit between the hips, drive the floor away." },
  { name: "Goblet squat", level: 'beginner', equipment: 'dumbbells', primary: ['quads', 'glutes'], secondary: ['abs', 'adductors'], week: 0, cue: "Elbows inside the knees, chest up." },
  { name: "Leg press", level: 'beginner', equipment: 'machine', primary: ['quads'], secondary: ['glutes', 'adductors'], week: 4, cue: "Lower until the hips start to tuck." },
  { name: "Walking lunge", level: 'beginner', equipment: 'dumbbells', primary: ['quads', 'glutes'], secondary: ['adductors'], week: 4, cue: "Long stride, back knee kisses the floor." },
  { name: "Bulgarian split squat", level: 'intermediate', equipment: 'dumbbells', primary: ['quads', 'glutes'], secondary: ['adductors'], week: 0, cue: "Front foot far enough that the heel stays down." },
  { name: "Leg extension", level: 'beginner', equipment: 'machine', primary: ['quads'], secondary: [], week: 0, cue: "Pause at the top, lower slowly." },
  { name: "Romanian deadlift", level: 'intermediate', equipment: 'barbell', primary: ['hamstrings', 'glutes'], secondary: ['lower_back', 'forearms'], week: 0, cue: "Soft knees, push the hips back, bar close to the legs." },
  { name: "Lying leg curl", level: 'beginner', equipment: 'machine', primary: ['hamstrings'], secondary: ['calves'], week: 6, cue: "Hips pressed down, slow lowering." },
  { name: "Nordic curl", level: 'advanced', equipment: 'bodyweight', primary: ['hamstrings'], secondary: [], week: 0, cue: "Fall as slowly as you can." },
  { name: "Copenhagen plank", level: 'intermediate', equipment: 'bench', primary: ['adductors'], secondary: ['obliques'], week: 2, cue: "Top leg on the bench, hips lifted." },
  { name: "Adductor machine", level: 'beginner', equipment: 'machine', primary: ['adductors'], secondary: [], week: 0, cue: "Slow squeeze, controlled return." },
  { name: "Sumo squat", level: 'beginner', equipment: 'dumbbells', primary: ['adductors', 'quads', 'glutes'], secondary: [], week: 0, cue: "Wide stance, toes out, knees track the toes." },
  { name: "Standing calf raise", level: 'beginner', equipment: 'machine', primary: ['calves'], secondary: [], week: 4, cue: "Full stretch at the bottom, pause at the top." },
  { name: "Seated calf raise", level: 'beginner', equipment: 'machine', primary: ['calves'], secondary: [], week: 0, cue: "Pause in the stretch." },
  { name: "Jump rope", level: 'beginner', equipment: 'jump rope', primary: ['calves'], secondary: ['quads'], week: 0, cue: "Light, quick bounces on the balls of the feet." },
]

const exId = (name: string) => `ex-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
const exerciseLibrary: LibraryExercise[] = library.map((e) => ({
  id: exId(e.name), name: e.name, level: e.level, equipment: e.equipment, cue: e.cue, primary: e.primary, secondary: e.secondary,
}))
const exerciseById = new Map(exerciseLibrary.map((e) => [e.id, e]))

// ---------- Aisha's program and workout log ----------
// Four workouts a week; Full body C (today) is in progress with 3 sets done,
// matching the Home screen. Last Sunday's Full body C gives "last time".
const PROGRAM_START = '2026-08-24'

let slotSeq = 0
const slot = (name: string, sets: number, reps: string, rpe: number | null = 8, rest: number | null = 90): PlannedExercise => {
  const e = exerciseLibrary.find((x) => x.name === name)!
  return { template_exercise_id: `te-${++slotSeq}`, exercise_id: e.id, name, cue: e.cue, sets, reps, rpe, rest_seconds: rest, notes: null }
}

const templates: PlanTemplate[] = [
  { id: 'wt-upper-a', name: 'Upper A', day_of_week: 1, notes: null, exercises: [
    slot('Dumbbell bench press', 3, '8–10'), slot('Seated cable row', 3, '10–12'), slot('Seated dumbbell shoulder press', 3, '10'),
    slot('Lat pulldown', 3, '10'), slot('Rope pushdown', 2, '12', 9, 60),
  ] },
  { id: 'wt-lower-a', name: 'Lower A', day_of_week: 2, notes: null, exercises: [
    slot('Back squat', 4, '6', 8, 180), slot('Romanian deadlift', 3, '8', 7, 120), slot('Walking lunge', 3, '10'), slot('Standing calf raise', 3, '12', 9, 60),
  ] },
  { id: 'wt-upper-b', name: 'Upper B', day_of_week: 4, notes: null, exercises: [
    slot('Incline dumbbell press', 3, '10'), slot('Single-arm dumbbell row', 3, '10'), slot('Lateral raise', 3, '15', 9, 60), slot('Dumbbell curl', 3, '12', 9, 60),
  ] },
  { id: 'wt-full-c', name: 'Full body C', day_of_week: 0, notes: 'Keep the RDLs light: lower back first.', exercises: [
    slot('Back squat', 4, '6', 8, 180), slot('Romanian deadlift', 3, '8', 7, 120), { ...slot('Dumbbell bench press', 3, '10', 8, null), superset: 'A' },
    { ...slot('Seated cable row', 3, '12'), superset: 'A' }, slot('Walking lunge', 3, '10', 8, 60), slot('Plank', 3, '45', null, 45),
  ] },
]

interface DemoSession {
  id: string; template_id: string | null; performed_on: string; started_at: string | null; finished_at: string | null
  duration_min: number | null; notes: string; sets: SetWrite[]; effort?: number | null; skipped?: boolean
}

/** Sets for one planned slot: [kg, reps, rpe] each. */
function logged(t: PlanTemplate, i: number, sets: [number | null, number, number | null][]): SetWrite[] {
  const x = t.exercises[i]
  return sets.map(([kg, reps, rpe], n) => ({ exercise_id: x.exercise_id, template_exercise_id: x.template_exercise_id, set_number: n + 1, weight_kg: kg, reps, rpe }))
}
const [upperA, lowerA, , fullC] = templates
const sessions = new Map<string, DemoSession>([
  ['w-prev-c', { id: 'w-prev-c', template_id: fullC.id, performed_on: '2026-09-27', started_at: '2026-09-27T17:30:00', finished_at: '2026-09-27T18:24:00', duration_min: 54, notes: '', sets: [
    ...logged(fullC, 0, [[80, 6, 8], [80, 6, 8], [80, 6, 8.5], [80, 5, 9]]), ...logged(fullC, 1, [[67.5, 8, 7], [67.5, 8, 7], [67.5, 8, 7.5]]),
    // Bench press with a drop after the last set (16 kg × 9 → 12 kg × 10).
    ...logged(fullC, 2, [[16, 10, 8], [16, 10, 8], [16, 9, 9]]), { ...logged(fullC, 2, [[12, 10, null]])[0], set_number: 4, drop_of: 3 },
    ...logged(fullC, 3, [[42.5, 12, 8], [42.5, 12, 8], [42.5, 11, 9]]),
    ...logged(fullC, 4, [[12, 10, 8], [12, 10, 8], [12, 10, 8]]), ...logged(fullC, 5, [[null, 45, null], [null, 45, null], [null, 40, null]]),
  ] }],
  ['w-upper-a', { id: 'w-upper-a', template_id: upperA.id, performed_on: '2026-09-28', started_at: '2026-09-28T07:05:00', finished_at: '2026-09-28T07:52:00', duration_min: 47, notes: '', sets: [
    ...logged(upperA, 0, [[18, 10, 8], [18, 10, 8], [18, 9, 9]]), ...logged(upperA, 1, [[45, 12, 8], [45, 12, 8], [45, 11, 9]]),
    ...logged(upperA, 2, [[14, 10, 8], [14, 9, 9], [14, 8, 9]]), ...logged(upperA, 3, [[50, 10, 8], [50, 10, 8.5], [50, 9, 9]]),
    ...logged(upperA, 4, [[20, 12, 9], [20, 12, 9]]),
  ] }],
  ['w-lower-a', { id: 'w-lower-a', template_id: lowerA.id, performed_on: '2026-09-29', started_at: '2026-09-29T18:10:00', finished_at: '2026-09-29T19:05:00', duration_min: 55, notes: 'Squats moved well.', sets: [
    ...logged(lowerA, 0, [[82.5, 6, 8], [82.5, 6, 8], [82.5, 6, 8.5], [82.5, 6, 9]]), ...logged(lowerA, 1, [[70, 8, 7], [70, 8, 7.5], [70, 8, 8]]),
    ...logged(lowerA, 2, [[12, 10, 8], [12, 10, 8], [12, 10, 8.5]]), ...logged(lowerA, 3, [[60, 12, 9], [60, 12, 9], [60, 11, 9.5]]),
  ] }],
  ['w-today', { id: 'w-today', template_id: fullC.id, performed_on: TODAY, started_at: `${TODAY}T17:55:00`, finished_at: null, duration_min: null, notes: '', sets: [
    ...logged(fullC, 0, [[82.5, 6, 8], [82.5, 6, 8.5], [82.5, 6, 9]]),
  ] }],
])

const sessionName = (s: DemoSession) => (s.template_id ? workoutNameOf(s.template_id) : null) ?? OWN_WORKOUT

function sessionSummary(s: DemoSession): WorkoutSummary {
  return summarize(
    { id: s.id, name: sessionName(s), performed_on: s.performed_on, finished: s.finished_at != null, duration_min: s.duration_min, notes: s.notes || null, effort: s.effort ?? null, skipped: !!s.skipped },
    s.sets.filter((x) => !x.is_warmup).map((x) => {
      const e = exerciseById.get(x.exercise_id)
      const slotOf = s.template_id ? planWorkout(s.template_id)?.exercises.find((p) => p.template_exercise_id === x.template_exercise_id) : undefined
      return { ...x, name: e?.name ?? 'Exercise', primary: e?.primary ?? [], superset: slotOf?.superset ?? null }
    }),
  )
}

const openSession = () => [...sessions.values()].find((s) => !s.finished_at) ?? null

function demoSession(id: string): DemoSession {
  const s = sessions.get(id)
  if (!s) throw new ApiError(404, "That workout doesn't exist.")
  return s
}

/** Logged sets count once for each primary muscle of their exercise (as muscle_sets_for_week does). */
function countSets(exerciseId: string, by: number) {
  for (const m of exerciseById.get(exerciseId)?.primary ?? []) sets[m] = Math.max(0, sets[m] + by)
}

const muscleNotes: Partial<Record<MuscleGroup, MuscleDetail['note']>> = {
  glutes: { kind: 'research', text: 'About 10–20 hard sets a week suits most lifters for growth. You hit 10 this week.', source_url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/' },
  lower_back: { kind: 'coach_tip', text: 'Keep RDLs light while your lower back settles. Back extensions with a pause are a good swap.' },
  forearms: { kind: 'coach_tip', text: "Carries count. Two rounds of farmer's carry after your last session covers it." },
  obliques: { kind: 'coach_tip', text: 'Add 2 sets of side plank on a rest day to tick these off.' },
}

let checkin: CheckinDraft = {
  week_start: WEEK_START,
  week: 6,
  auto: { workouts_done: 3, workouts_planned: 4, meals_on_plan: 17, meals_planned: 20, steps_avg: 8450, avg_weight_kg: 71.8 },
  weight_kg: 71.8,
  waist_cm: null,
  hips_cm: null,
  energy: null,
  sleep: null,
  stress: null,
  hunger: null,
  photos: {},
  wins: '',
  struggles: '',
  question: '',
  status: 'due',
}

const coachNote: CoachNote = {
  coach,
  title: 'Week 5 feedback',
  date: 'Sep 28',
  body: "Great week, Aisha. Protein is consistently up. Let's add a 4th set on squats next week.",
}

const aishaWeights = [74.6, 74.0, 73.3, 72.8, 72.2, 71.8]

// ---------- Coach: Simranvir's roster ----------
type RosterBase = Omit<ClientRow, 'is_new' | 'setup_done' | 'has_targets' | 'goal' | 'weeks' | 'food_pct' | 'weight_change'> & {
  goal: GoalType; weeks: number; food_pct: number; weight_change: number
}
interface Roster extends RosterBase { submitted_at?: string; submitted_label?: string; plan_pct?: number; flags?: string[]; has_question?: boolean; reviewed?: boolean; checked_in?: boolean; queue_change?: number }

const trend = (end: number, drift: number, wobble = 0.15) =>
  Array.from({ length: 6 }, (_, i) => +(end - drift * (5 - i) + (i % 2 ? wobble : -wobble) * (i < 5 ? 1 : 0)).toFixed(1))

const roster: Roster[] = [
  { client: aisha, goal: 'fat_loss', week: 6, weeks: 12, days_logged: 7, workouts_done: 3, workouts_planned: 4, food_pct: 85, weight_trend: aishaWeights, weight_change: -0.4, last_check_in: 'Today 6:40 PM', status: 'on_track', submitted_at: `${TODAY}T18:40:00`, submitted_label: 'Today 6:40 PM', plan_pct: 80, has_question: true, checked_in: true },
  { client: person('c-marco', 'Marco Bianchi'), goal: 'muscle_gain', week: 3, weeks: 16, days_logged: 7, workouts_done: 4, workouts_planned: 4, food_pct: 92, weight_trend: trend(78.4, -0.1, 0.05), weight_change: 0.3, last_check_in: 'Today 9:40 AM', status: 'on_track', submitted_at: `${TODAY}T09:40:00`, submitted_label: 'Today 9:40 AM', plan_pct: 92, checked_in: true },
  { client: person('c-priya', 'Priya Nair'), goal: 'fat_loss', week: 9, weeks: 12, days_logged: 4, workouts_done: 2, workouts_planned: 4, food_pct: 61, weight_trend: [66.1, 65.6, 65.5, 65.7, 65.9, 66.1], weight_change: 0.2, last_check_in: 'Sat 9:15 PM', status: 'slipping', submitted_at: '2026-10-03T21:15:00', submitted_label: 'Sat 9:15 PM', plan_pct: 61, flags: ['2 sessions missed', 'Sleep 2 of 5'], checked_in: true },
  { client: person('c-daniel', 'Daniel Kim'), goal: 'performance', week: 5, weeks: 10, days_logged: 6, workouts_done: 3, workouts_planned: 3, food_pct: 88, weight_trend: [80.2, 80.0, 80.1, 79.9, 80.0, 79.9], weight_change: -0.1, last_check_in: 'Today 7:05 AM', status: 'on_track', submitted_at: `${TODAY}T07:05:00`, submitted_label: 'Today 7:05 AM', plan_pct: 88, checked_in: true },
  { client: person('c-sofia', 'Sofia Alvarez'), goal: 'health', week: 2, weeks: 12, days_logged: 2, workouts_done: 1, workouts_planned: 3, food_pct: 54, weight_trend: [70.4, 70.3, 70.3, 70.2, 70.2, 70.2], weight_change: -0.2, last_check_in: 'Due today, 8 PM', status: 'awaiting' },
  { client: person('c-harpreet', 'Harpreet Gill'), goal: 'muscle_gain', week: 11, weeks: 12, days_logged: 7, workouts_done: 4, workouts_planned: 4, food_pct: 90, weight_trend: [68.1, 68.3, 68.6, 68.8, 69.1, 69.5], weight_change: 0.4, last_check_in: 'Today 10:02 AM · reviewed', status: 'on_track', submitted_at: `${TODAY}T10:02:00`, submitted_label: 'Today 10:02 AM', plan_pct: 90, reviewed: true, checked_in: true },
  { client: person('c-jordan', 'Jordan Lee'), goal: 'fat_loss', week: 4, weeks: 12, days_logged: 2, workouts_done: 2, workouts_planned: 4, food_pct: 66, weight_trend: [92.0, 91.2, 90.3, 89.5, 88.6, 87.7], weight_change: -0.9, last_check_in: 'Sep 20 · missed Sep 27', status: 'overdue' },
  { client: person('c-mei', 'Mei Chen'), goal: 'health', week: 7, weeks: 12, days_logged: 6, workouts_done: 3, workouts_planned: 3, food_pct: 80, weight_trend: [58.6, 58.3, 58.5, 58.2, 58.3, 58.1], weight_change: -0.2, last_check_in: 'Today 8:55 AM', status: 'on_track', submitted_at: `${TODAY}T08:55:00`, submitted_label: 'Today 8:55 AM', plan_pct: 80, checked_in: true },
  { client: person('c-noah', 'Noah Patel'), goal: 'fat_loss', week: 8, weeks: 12, days_logged: 7, workouts_done: 4, workouts_planned: 4, food_pct: 84, weight_trend: trend(84.2, 0.5), weight_change: -0.5, last_check_in: 'Today 11:20 AM', status: 'on_track', submitted_at: `${TODAY}T11:20:00`, submitted_label: 'Today 11:20 AM', plan_pct: 84, checked_in: true },
  { client: person('c-grace', 'Grace Liu'), goal: 'fat_loss', week: 3, weeks: 12, days_logged: 7, workouts_done: 3, workouts_planned: 3, food_pct: 90, weight_trend: trend(63.4, 0.3), weight_change: -0.3, last_check_in: 'Today 12:05 PM', status: 'on_track', submitted_at: `${TODAY}T12:05:00`, submitted_label: 'Today 12:05 PM', plan_pct: 90, checked_in: true },
  { client: person('c-liam', "Liam O'Connor"), goal: 'muscle_gain', week: 6, weeks: 16, days_logged: 7, workouts_done: 4, workouts_planned: 4, food_pct: 87, weight_trend: trend(76.1, -0.2), weight_change: 0.2, last_check_in: 'Today 8:10 AM · reviewed', status: 'on_track', submitted_at: `${TODAY}T08:10:00`, submitted_label: 'Today 8:10 AM', plan_pct: 87, reviewed: true, checked_in: true },
  { client: person('c-ana', 'Ana Souza'), goal: 'performance', week: 9, weeks: 10, days_logged: 6, workouts_done: 4, workouts_planned: 4, food_pct: 83, weight_trend: trend(61.0, 0), weight_change: 0, last_check_in: 'Today 7:40 AM · reviewed', status: 'on_track', submitted_at: `${TODAY}T07:40:00`, submitted_label: 'Today 7:40 AM', plan_pct: 83, reviewed: true, checked_in: true },
  { client: person('c-ethan', 'Ethan Brooks'), goal: 'fat_loss', week: 10, weeks: 12, days_logged: 7, workouts_done: 3, workouts_planned: 3, food_pct: 89, weight_trend: trend(88.0, 0.6), weight_change: -0.6, last_check_in: 'Sat 6:30 PM · reviewed', status: 'on_track', submitted_at: '2026-10-03T18:30:00', submitted_label: 'Sat 6:30 PM', plan_pct: 89, reviewed: true, checked_in: true },
  { client: person('c-fatima', 'Fatima Zahra'), goal: 'health', week: 5, weeks: 12, days_logged: 6, workouts_done: 2, workouts_planned: 3, food_pct: 81, weight_trend: trend(64.5, 0.1), weight_change: -0.1, last_check_in: 'Sep 28 · checks in Mondays', status: 'on_track' },
  { client: person('c-ravi', 'Ravi Menon'), goal: 'muscle_gain', week: 2, weeks: 16, days_logged: 5, workouts_done: 3, workouts_planned: 4, food_pct: 78, weight_trend: trend(70.2, -0.2), weight_change: 0.2, last_check_in: 'Sep 29 · checks in Tuesdays', status: 'on_track' },
  { client: person('c-chloe', 'Chloe Martin'), goal: 'fat_loss', week: 7, weeks: 12, days_logged: 7, workouts_done: 3, workouts_planned: 4, food_pct: 86, weight_trend: trend(69.8, 0.4), weight_change: -0.4, last_check_in: 'Sep 30 · checks in Wednesdays', status: 'on_track' },
  { client: person('c-lucas', 'Lucas Weber'), goal: 'performance', week: 4, weeks: 10, days_logged: 6, workouts_done: 4, workouts_planned: 4, food_pct: 85, weight_trend: trend(74.0, 0), weight_change: 0, last_check_in: 'Oct 1 · checks in Thursdays', status: 'on_track' },
  { client: person('c-hana', 'Hana Sato'), goal: 'health', week: 1, weeks: 12, days_logged: 3, workouts_done: 1, workouts_planned: 2, food_pct: 70, weight_trend: [59.0, 59.0, 59.0, 59.0, 59.0, 58.9], weight_change: -0.1, last_check_in: 'First check-in today', status: 'awaiting' },
]

const ciId = (r: Roster) => `ci-${r.client.id.slice(2)}`
const byCiId = (id: string) => roster.find((r) => ciId(r) === id)

function queueItem(r: Roster): QueueItem {
  return {
    check_in_id: ciId(r),
    client: r.client,
    submitted_at: r.submitted_at!,
    submitted_label: r.submitted_label!,
    plan_pct: r.plan_pct ?? r.food_pct,
    weight_change: r.weight_change,
    flags: r.flags ?? [],
    has_question: !!r.has_question,
    status: r.reviewed ? 'reviewed' : 'submitted',
  }
}

/** Flagged check-ins first (flags, then questions), then oldest first. */
function reviewQueue(): QueueItem[] {
  const rank = (q: QueueItem) => (q.flags.length ? 0 : q.has_question ? 1 : 2)
  return roster
    .filter((r) => r.checked_in && !r.reviewed)
    .map(queueItem)
    .sort((a, b) => rank(a) - rank(b) || a.submitted_at.localeCompare(b.submitted_at))
}

const reviewState = new Map<string, { draft: string; draft_saved_at: string | null; private_notes: string; targets: Targets; suggestion_applied: boolean }>()
reviewState.set('ci-aisha', {
  draft: "Huge week. 4 sets at 82.5 kg is a new best. Yes to hip thrusts for the next 2 weeks; I've swapped them into Full body C and kept a light RDL as a warm-up. On late work nights, aim for lights out by 11.",
  draft_saved_at: `${TODAY}T18:52:00`,
  private_notes: 'Oct 4: lower back tight after RDLs. Check form video next week.',
  targets: { ...targets },
  suggestion_applied: false,
})

function reviewFor(r: Roster) {
  const id = ciId(r)
  if (!reviewState.has(id)) {
    reviewState.set(id, { draft: '', draft_saved_at: null, private_notes: '', targets: { ...targets, calories: 2300, protein_g: 150 }, suggestion_applied: false })
  }
  return reviewState.get(id)!
}

// ---------- Programs ----------
// Aisha keeps her hand-built program (the week on Train); the other clients get
// programs generated from their goals; Sofia and Hana have none yet.
interface DemoProgram {
  id: string; client_id: string | null; is_template: boolean; assigned: boolean; name: string; weeks: number
  goal: GoalType | null; level: Level | null; days_per_week: number | null; start_date: string | null; draft_start: string | null
  workouts: ProgramWorkout[]
}

const LEVEL_CYCLE: Level[] = ['beginner', 'intermediate', 'advanced']
const PLACE_CYCLE: TrainLocation[] = ['gym', 'gym', 'home', 'both']
const DAYS_BY_GOAL: Record<GoalType, number[]> = { muscle_gain: [4, 5, 6], fat_loss: [3, 4, 2], performance: [4, 3, 5], health: [3, 2, 4] }

/** Setup answers for the demo roster (Aisha's match her program). */
function answersOf(clientId: string): { experience: Level; training_days: number; train_location: TrainLocation; injuries: string | null } {
  if (clientId === aisha.id) return { experience: 'intermediate', training_days: 4, train_location: 'gym', injuries: 'Lower back gets tight after heavy deadlifts.' }
  const i = Math.max(0, roster.findIndex((r) => r.client.id === clientId))
  const goal = roster[i]?.goal ?? 'health'
  return {
    experience: LEVEL_CYCLE[i % 3], training_days: DAYS_BY_GOAL[goal][i % 3], train_location: PLACE_CYCLE[i % 4],
    injuries: i % 5 === 2 ? 'Left knee aches on deep lunges.' : null,
  }
}

function withIds(id: string, workouts: ProgramWorkout[]): ProgramWorkout[] {
  return workouts.map((w, i) => ({
    ...w, id: w.id ?? `${id}-w${i}-${crypto.randomUUID().slice(0, 4)}`,
    exercises: w.exercises.map((x, j) => ({ ...x, id: x.id ?? `${id}-w${i}-x${j}-${crypto.randomUUID().slice(0, 4)}` })),
  }))
}

function generated(id: string, client_id: string | null, goal: GoalType, level: Level, days: number, place: TrainLocation): DemoProgram {
  const g = generateProgram({ goal, experience: level, training_days: days, train_location: place }, exerciseLibrary)
  return {
    id, client_id, is_template: client_id == null, assigned: false, name: g.name, weeks: g.weeks, goal, level, days_per_week: days,
    start_date: null, draft_start: null,
    workouts: withIds(id, g.workouts.map((w) => ({
      id: null, name: w.name, day_of_week: w.day_of_week, notes: w.notes,
      exercises: w.exercises.map((x) => ({ id: null, exercise_id: x.exercise_id, name: x.name, sets: x.sets, reps: x.reps, rpe: x.rpe, rest_seconds: x.rest_seconds, notes: x.notes })),
    }))),
  }
}

const programs = new Map<string, DemoProgram>()
programs.set('prog-aisha', {
  id: 'prog-aisha', client_id: aisha.id, is_template: false, assigned: true, name: 'Recomp block', weeks: 12, goal: 'fat_loss',
  level: 'intermediate', days_per_week: 4, start_date: PROGRAM_START, draft_start: null,
  workouts: templates.map((t) => ({
    id: t.id, name: t.name, day_of_week: t.day_of_week, notes: t.notes ?? '',
    exercises: t.exercises.map((x) => ({ id: x.template_exercise_id, exercise_id: x.exercise_id, name: x.name, sets: x.sets, reps: x.reps, rpe: x.rpe, rest_seconds: x.rest_seconds, notes: x.notes ?? '', superset: x.superset ?? null })),
  })),
})
for (const r of roster) {
  if (r.client.id === aisha.id || ['c-sofia', 'c-hana'].includes(r.client.id)) continue
  const a = answersOf(r.client.id)
  const p = generated(`prog-${r.client.id}`, r.client.id, r.goal, a.experience, a.training_days, a.train_location)
  programs.set(p.id, { ...p, assigned: true, weeks: r.weeks, start_date: addDays(WEEK_START, -(r.week - 1) * 7) })
}
{
  const t = generated('tpl-fat-loss', null, 'fat_loss', 'beginner', 3, 'gym')
  programs.set(t.id, { ...t, name: 'Fat loss starter: full body, 3 days' })
}

/** Names of workouts taken out of a program that logged sessions still point at. */
const retiredWorkouts = new Map<string, string>()

function workoutNameOf(id: string): string | null {
  for (const p of programs.values()) {
    const w = p.workouts.find((x) => x.id === id)
    if (w) return w.name
  }
  return retiredWorkouts.get(id) ?? null
}

const statusOf = (p: DemoProgram) => programStatus({ is_template: p.is_template, assigned: p.assigned, start_date: p.start_date, weeks: p.weeks }, TODAY)

function currentProgram(clientId: string): DemoProgram | null {
  return [...programs.values()]
    .filter((p) => p.client_id === clientId && p.assigned && p.start_date && p.start_date <= TODAY)
    .sort((a, b) => b.start_date!.localeCompare(a.start_date!))[0] ?? null
}

function upcomingProgram(clientId: string): DemoProgram | null {
  return [...programs.values()]
    .filter((p) => p.client_id === clientId && p.assigned && p.start_date && p.start_date > TODAY)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!))[0] ?? null
}

function nextProgram(clientId: string): NextProgram | null {
  const p = upcomingProgram(clientId)
  return p ? { name: p.name, start_date: p.start_date! } : null
}

/** A program's workouts as the client's Train tab plans them. */
function planOf(p: DemoProgram): PlanTemplate[] {
  return p.workouts.map((w) => ({
    id: w.id!, name: w.name, day_of_week: w.day_of_week, notes: w.notes || null,
    exercises: w.exercises.map((x): PlannedExercise => ({
      template_exercise_id: x.id!, exercise_id: x.exercise_id, name: x.name, sets: x.sets, reps: x.reps, rpe: x.rpe,
      rest_seconds: x.rest_seconds, cue: exerciseById.get(x.exercise_id)?.cue ?? null, notes: x.notes || null, superset: x.superset ?? null,
    })),
  }))
}

function planWorkout(id: string | null): PlanTemplate | undefined {
  if (!id) return undefined
  for (const p of programs.values()) {
    const t = planOf(p).find((w) => w.id === id)
    if (t) return t
  }
  return undefined
}

function toProgram(p: DemoProgram): Program {
  const status = statusOf(p)
  return {
    id: p.id, client_id: p.client_id, name: p.name, weeks: p.weeks, goal: p.goal, level: p.level, days_per_week: p.days_per_week,
    status, start_date: p.start_date, draft_start: p.draft_start,
    week: status === 'active' ? programWeekOf(p.start_date!, TODAY) : null,
    workouts: structuredClone(p.workouts),
  }
}

function demoProgram(id: string): DemoProgram {
  const p = programs.get(id)
  if (!p) throw new ApiError(404, "That program doesn't exist.")
  return p
}

// ---------- Coach pages: status, targets, notes, settings, questions ----------
const clientStatus: Record<string, ClientStatus> = { 'c-jordan': 'paused' }
const checkInDay: Record<string, number> = {}
const coachNotes: Record<string, string> = { [aisha.id]: 'Lower back tight after RDLs. Check form video next week.' }
const coachSettings: CoachSettings = { full_name: DEMO_ACCOUNTS.coach.full_name, invite_code: DEMO_ACCOUNTS.invite_code, default_check_in_day: 0 }
let questions: CoachQuestion[] = [
  { id: 'q-energy', prompt: 'How was your energy this week?', answer_type: 'scale', is_active: true, answers: 12 },
  { id: 'q-steps', prompt: 'Did you hit your step target most days?', answer_type: 'yes_no', is_active: true, answers: 9 },
  { id: 'q-cardio', prompt: 'Minutes of cardio this week', answer_type: 'number', is_active: false, answers: 4 },
]

/** Targets by start date. Sofia and Hana have none yet. */
const targetVersions: Record<string, TargetVersion[]> = Object.fromEntries(roster
  .filter((r) => !['c-sofia', 'c-hana'].includes(r.client.id))
  .map((r) => [r.client.id, r.client.id === aisha.id
    ? [{ effective_from: '2026-08-24', targets: { ...targets, calories: 2200, protein_g: 135 } }, { effective_from: '2026-09-21', targets: { ...targets } }]
    : [{ effective_from: addDays(WEEK_START, -(r.week - 1) * 7), targets: { ...targets, calories: r.goal === 'muscle_gain' ? 2600 : r.goal === 'fat_loss' ? 1900 : 2200 } }]]))

function targetsOn(clientId: string, date: string): TargetVersion | null {
  return (targetVersions[clientId] ?? []).filter((v) => v.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
}

function storedFoodDay(date: string): FoodDay {
  if (!foodDays.has(date)) {
    foodDays.set(date, date > TODAY
      ? { date, targets, targets_from: null, next_targets: null, meals: [], planned: ['breakfast', 'lunch', 'dinner'], day_rating: null, plan: null }
      : pastFoodDay(date))
  }
  return foodDays.get(date)!
}

const profileEdits: Partial<ProfilePatch> = {}
function demoProfile(): MyProfile {
  const a = answersOf(aisha.id)
  const prog = currentProgram(aisha.id)
  const cur = targetsOn(aisha.id, TODAY)
  return {
    full_name: aisha.full_name, email: DEMO_ACCOUNTS.client.email, units: 'imperial', height_cm: 165, goal_weight_kg: 68, start_weight_kg: 74.6,
    goal: 'fat_loss', experience: a.experience, diet: 'none' as DietType, foods_to_avoid: null, meals_per_day: 4,
    training_days: a.training_days, train_location: a.train_location, injuries: a.injuries, phone: '+1 555 0100',
    coach, check_in_day: checkInDay[aisha.id] ?? 0, start_date: '2026-08-24',
    targets: cur ? structuredClone(cur) : null,
    program: prog ? { name: prog.name, week: programWeekOf(prog.start_date!, TODAY), weeks: prog.weeks } : null,
    ...profileEdits,
  }
}

// ---------- Aisha's history for the Progress page ----------
// Generated once, deterministically, from her program and weekly weights; the
// workouts already in the demo log (from Sep 27) are used as they are.
let progressRawCache: Omit<ProgressRaw, 'targets' | 'programs' | 'sessions'> & { generated: ProgressRaw['sessions'] } | null = null

function aishaProgressRaw(): ProgressRaw {
  if (!progressRawCache) {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const jitter = (spread: number) => (rand() - 0.5) * 2 * spread
    const days: ProgressRaw['days'] = []
    const meals: ProgressRaw['meals'] = []
    const generated: ProgressRaw['sessions'] = []
    const prog = programs.get('prog-aisha')!
    const loads: Record<string, number> = {}
    for (let d = PROGRAM_START; d <= TODAY; d = plusDays(d, 1)) {
      const week = Math.floor((new Date(`${d}T00:00:00`).getTime() - new Date(`${PROGRAM_START}T00:00:00`).getTime()) / (7 * 86_400_000))
      const dow = new Date(`${d}T00:00:00`).getDay()
      const weighIn = dow !== 3 && dow !== 6 // about five weigh-ins a week
      days.push({
        date: d,
        weight_kg: weighIn ? Math.round((aishaWeights[Math.min(week, aishaWeights.length - 1)] + jitter(0.4)) * 10) / 10 : null,
        steps: Math.round(8600 + jitter(2600)),
        water_ml: Math.round((2200 + jitter(500)) / 50) * 50,
        sleep_h: Math.round((7 + jitter(0.9)) * 4) / 4,
      })
      const onPlan = rand()
      meals.push(
        { date: d, calories: Math.round(480 + jitter(80)), protein_g: Math.round(36 + jitter(6)), on_plan: 'yes' },
        { date: d, calories: Math.round(640 + jitter(110)), protein_g: Math.round(46 + jitter(8)), on_plan: onPlan > 0.25 ? 'yes' : 'partly' },
        { date: d, calories: Math.round(820 + jitter(160)), protein_g: Math.round(50 + jitter(10)), on_plan: onPlan > 0.82 ? 'no' : 'yes' },
      )
      // Her four workouts on their days, loads creeping up; one Upper B missed in week 6, as on Home.
      if (d < '2026-09-27') {
        for (const w of prog.workouts.filter((x) => x.day_of_week === dow)) {
          generated.push({
            date: d, template_id: w.id,
            sets: w.exercises.flatMap((x) => {
              const e = exerciseById.get(x.exercise_id)
              const start = loads[x.exercise_id] ??= e?.equipment === 'bodyweight' ? 0 : e?.equipment === 'barbell' ? 60 : 12
              const kg = start ? Math.round((start + week * (e?.equipment === 'barbell' ? 2.5 : 1)) * 2) / 2 : null
              // RPE as logged: the planned RPE, half a point either side from set to set.
              return Array.from({ length: x.sets }, (_, n) => ({
                exercise_id: x.exercise_id, name: x.name, kg, reps: Number(String(x.reps).match(/\d+/)?.[0] ?? 8),
                rpe: kg && x.rpe != null ? x.rpe + (((week + n) % 3) - 1) * 0.5 : null, primary: e?.primary ?? [],
              }))
            }),
          })
        }
      }
    }
    progressRawCache = {
      today: TODAY, start_date: PROGRAM_START, goal_weight_kg: 68, days, meals, generated,
      check_ins: Array.from({ length: 5 }, (_, i) => ({
        week_start: plusDays(mondayOf(PROGRAM_START), 7 * i),
        waist_cm: Math.round((82 - i * 0.9) * 10) / 10, hips_cm: Math.round((101 - i * 0.6) * 10) / 10,
        energy: [3, 3, 4, 4, 4][i], sleep: [3, 4, 3, 4, 3][i], stress: [3, 3, 2, 2, 2][i], hunger: [4, 3, 3, 3, 3][i],
      })),
    }
  }
  const { generated, ...rest } = progressRawCache
  const logged = [...sessions.values()].filter((s) => s.finished_at && !s.skipped).map((s) => ({
    date: s.performed_on, template_id: s.template_id,
    sets: s.sets.filter((x) => !x.is_warmup).map((x) => ({ exercise_id: x.exercise_id, name: exerciseById.get(x.exercise_id)?.name ?? 'Exercise', kg: x.weight_kg, reps: x.reps, rpe: x.rpe, drop: x.drop_of != null, primary: exerciseById.get(x.exercise_id)?.primary ?? [] })),
  }))
  return {
    ...rest,
    targets: (targetVersions[aisha.id] ?? []).map((v) => ({ from: v.effective_from, calories: v.targets.calories, protein_g: v.targets.protein_g, water_ml: v.targets.water_ml || null, steps: v.targets.steps || null, sleep_h: v.targets.sleep_h || null })),
    programs: [...programs.values()].filter((p) => p.client_id === aisha.id && p.assigned && p.start_date && p.start_date <= TODAY)
      .map((p) => ({ start_date: p.start_date!, weeks: p.weeks, planned: p.workouts.filter((w) => w.day_of_week != null).length })),
    sessions: [...generated, ...logged.filter((s) => s.date >= '2026-09-27')],
  }
}

// Other clients' Progress for the coach's Insights card and list flags: their
// weekly weights (three weigh-ins a week), nothing else logged. Goal weights are
// made up from the goal: 6 kg down for fat loss, 4 kg up for muscle gain.
const demoGoalKg = (r: Roster) =>
  r.client.id === aisha.id ? 68 : r.goal === 'fat_loss' ? Math.round(r.weight_trend[0] - 6) : r.goal === 'muscle_gain' ? Math.round(r.weight_trend[0] + 4) : null

function rosterProgressRaw(r: Roster): ProgressRaw {
  if (r.client.id === aisha.id) return aishaProgressRaw()
  const thisWeek = mondayOf(TODAY)
  const start = plusDays(thisWeek, -7 * (r.week - 1))
  const days: ProgressRaw['days'] = r.weight_trend.flatMap((kg, i) => {
    const week = plusDays(thisWeek, -7 * (r.weight_trend.length - 1 - i))
    return week < start ? [] : [0, 2, 4].map((n) => ({ date: plusDays(week, n), weight_kg: kg, steps: null, water_ml: null, sleep_h: null }))
  }).filter((d) => d.date <= TODAY)
  return { today: TODAY, start_date: start, goal_weight_kg: demoGoalKg(r), days, meals: [], targets: [], programs: [], sessions: [], check_ins: [] }
}

// ---------- Food list and meal plans ----------
// The shared list (lib/foodList.ts, the same one the database seeds), the coach's
// own foods, and meal plans kept in memory. Aisha has a plan from Sep 28.
const foodSlug = (name: string) => `food-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`
const demoFoods: Food[] = SHARED_FOODS.map((f) => ({
  id: foodSlug(f.name), name: f.name, basis: f.basis, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
  servings: f.servings.map(([name, amount]) => ({ name, amount })),
}))
const foodNamed = (name: string) => demoFoods.find((f) => f.name === name)!
const line = (name: string, quantity: number, unit?: string): FoodLine => ({ food: foodNamed(name), quantity, unit: unit ?? foodNamed(name).basis })

const mealPlans: MealPlan[] = [
  {
    id: 'plan-aisha-1', client_id: aisha.id, name: 'Fat loss, 4 meals', effective_from: '2026-09-28', split: false,
    meals: [
      { day: 'every', meal_type: 'breakfast', notes: 'Any berries work; frozen is fine.', lines: [line('Oats', 60), line('Greek yogurt 2%', 1, '1 pot'), line('Berries, mixed', 1, '1 cup')] },
      { day: 'every', meal_type: 'snack', notes: '', lines: [line('Whey protein', 1, '1 scoop'), line('Banana', 1, '1 medium'), line('Almonds', 1, '1 handful')] },
      { day: 'every', meal_type: 'lunch', notes: 'Or swap rice for quinoa.', lines: [line('Chicken breast, grilled', 150), line('Rice, white, cooked', 1, '1 cup'), line('Mixed salad', 1, '1 bowl'), line('Olive oil', 1, '1 tbsp')] },
      { day: 'every', meal_type: 'dinner', notes: 'Paneer tikka instead of salmon on veggie days.', lines: [line('Salmon fillet, cooked', 1, '1 fillet'), line('Sweet potato, baked', 1, '1 medium'), line('Broccoli, cooked', 1, '1 cup'), line('Roti (chapati)', 1, '1 roti')] },
    ],
  },
  {
    id: 'plan-template-1', client_id: null, name: 'Fat loss, 3 meals', effective_from: null, split: false,
    meals: [
      { day: 'every', meal_type: 'breakfast', notes: '', lines: [line('Egg', 2, '1 large egg'), line('Bread, wholemeal', 2, '1 slice'), line('Avocado', 1, '1/2 avocado')] },
      { day: 'every', meal_type: 'lunch', notes: '', lines: [line('Dal (cooked lentils)', 1, '1 bowl'), line('Rice, brown, cooked', 1, '1 cup'), line('Plain yogurt (curd)', 1, '1 bowl')] },
      { day: 'every', meal_type: 'dinner', notes: '', lines: [line('Chicken curry', 1, '1 bowl'), line('Roti (chapati)', 2, '1 roti'), line('Mixed salad', 1, '1 bowl')] },
    ],
  },
]
const clonePlan = (p: MealPlan): MealPlan => ({ ...p, meals: p.meals.map((m) => ({ ...m, lines: m.lines.map((l) => ({ ...l })) })) })
const aishaTraining = (date: string) => {
  const p = currentProgram(aisha.id)
  return isTrainingDay(p ? [{ start_date: p.start_date, weeks: p.weeks, days: p.workouts.map((w) => w.day_of_week) }] : [], date)
}
const planOn = (clientId: string, date: string) =>
  mealPlans.filter((p) => p.client_id === clientId && p.effective_from && p.effective_from <= date).sort((a, b) => b.effective_from!.localeCompare(a.effective_from!))[0]

// ---------- Messages ----------
// Aisha's conversation with the coach (with last week's check-in feedback),
// plus short threads with Priya (2 unread) and Marco.
interface DemoMessage { id: string; client_id: string; sender_id: string; body: string; created_at: string; check_in_id: string | null; read_at: string | null }

const PREV_CHECK_IN = { id: 'ci-aisha-w5', week_start: '2026-09-21' }
const messages: DemoMessage[] = [
  { id: 'msg-1', client_id: aisha.id, sender_id: coach.id, body: coachNote.body, created_at: '2026-09-27T19:10:00', check_in_id: PREV_CHECK_IN.id, read_at: '2026-09-27T20:02:00' },
  { id: 'msg-2', client_id: aisha.id, sender_id: aisha.id, body: "Late one at work again. OK if I do Thursday's session on Friday morning instead?", created_at: '2026-09-30T21:05:00', check_in_id: null, read_at: '2026-10-01T07:31:00' },
  { id: 'msg-3', client_id: aisha.id, sender_id: coach.id, body: 'Totally fine. Keep the RDLs light on Friday, and try to get to bed a bit earlier tonight.', created_at: '2026-10-01T07:40:00', check_in_id: null, read_at: '2026-10-01T08:15:00' },
  { id: 'msg-4', client_id: aisha.id, sender_id: aisha.id, body: "Check-in sent! There's a question in there about hip thrusts.", created_at: `${TODAY}T18:41:00`, check_in_id: null, read_at: `${TODAY}T18:50:00` },
  { id: 'msg-5', client_id: aisha.id, sender_id: coach.id, body: "Got it, I'll review it tonight.", created_at: `${TODAY}T18:52:00`, check_in_id: null, read_at: null },
  { id: 'msg-6', client_id: 'c-marco', sender_id: coach.id, body: 'Nice deadlift PR this week!', created_at: '2026-10-02T09:00:00', check_in_id: null, read_at: '2026-10-02T12:28:00' },
  { id: 'msg-7', client_id: 'c-marco', sender_id: 'c-marco', body: 'Thanks! It felt smooth.', created_at: '2026-10-02T12:30:00', check_in_id: null, read_at: '2026-10-02T13:00:00' },
  { id: 'msg-8', client_id: 'c-priya', sender_id: 'c-priya', body: 'Sorry, rough week with work travel. Back on track Monday.', created_at: '2026-10-03T21:20:00', check_in_id: null, read_at: null },
  { id: 'msg-9', client_id: 'c-priya', sender_id: 'c-priya', body: 'Can we keep the same targets for one more week?', created_at: '2026-10-03T21:22:00', check_in_id: null, read_at: null },
]

const isCoach = () => getCurrentUser()?.role === 'coach'
const demoAvatars: Record<string, string> = {}
/** The signed-in demo user's kg/lb choice (the avatar menu). */
const demoUnits = () => getCurrentUser()?.units ?? 'imperial'
const everyone = () => [coach, aisha, ...roster.map((r) => r.client)]

function demoChat(m: DemoMessage, me: string): ChatMessage {
  const sender = m.sender_id === aisha.id && !isCoach() ? signedIn() ?? aisha : everyone().find((p) => p.id === m.sender_id) ?? coach
  const ci = m.check_in_id === PREV_CHECK_IN.id ? PREV_CHECK_IN : m.check_in_id ? { id: m.check_in_id, week_start: WEEK_START } : null
  return { id: m.id, body: m.body, created_at: m.created_at, from_me: m.sender_id === me, sender, check_in: ci, read_at: m.read_at }
}

/** In the client app the demo conversation is Aisha's; in the coach app, the chosen client's. */
const demoThreadOf = (clientId: string | null) => ({ client: clientId ?? aisha.id, me: clientId ? coach.id : aisha.id })

// ---------- Exported demo API ----------
export const demo = {
  clientHome(): ClientHome {
    const food = demo.foodDay(TODAY)
    const done = days.filter((d) => d.workout?.status === 'done').length
    return {
      today: TODAY,
      // Demo data is Aisha's week, shown under the signed-in person's name.
      me: { ...(signedIn() ?? aisha), body_model: bodyModel },
      coach,
      program: { week: 6, weeks: currentProgram(aisha.id)?.weeks ?? null, start_date: '2026-08-24', has_program: !!currentProgram(aisha.id), next: nextProgram(aisha.id) },
      days,
      week: { workouts_done: done, workouts_planned: 4, meals_on_plan: 17, meals_planned: 20, avg_protein_g: 128 },
      check_in: { status: checkin.status, minutes: 4, next_date: null },
      workout: { ...workout, sets_done: sessions.get('w-today')?.sets.filter((x) => !x.is_warmup && x.drop_of == null).length ?? workout.sets_done },
      food,
      habits: { ...habitsToday, weight_today: habitsToday.weight_today, steps_avg: 8450, water_ml_avg: 2100, sleep_avg: 6 + 50 / 60, note: 'Sleep dipped on Wednesday and Thursday.' },
      weight: {
        points: aishaWeights.map((kg, i) => ({ label: `W${i + 1}`, kg })),
        current: 71.8, change: -2.8, goal: 68, start_date: '2026-08-24',
      },
      coach_note: coachNote,
      bests: [
        { exercise: 'Back squat', reps: 6, kg: 82.5, change: 7.5 },
        { exercise: 'Romanian deadlift', reps: 8, kg: 70, change: 10 },
        { exercise: 'Dumbbell bench press', reps: 10, kg: 18, change: 2 },
      ],
    }
  },

  trainWeek(): TrainWeek {
    const open = openSession()
    const all = [...sessions.values()]
    const current = currentProgram(aisha.id)
    return {
      today: TODAY, week: 6, weeks: current?.weeks ?? null, body_model: bodyModel, sets, has_program: !!current, units: demoUnits(),
      next_program: nextProgram(aisha.id),
      plan: weekPlan(current ? planOf(current) : [], all.map((s) => ({ id: s.id, workout_template_id: s.template_id, performed_on: s.performed_on, finished: s.finished_at != null, skipped: !!s.skipped, notes: s.notes })), TODAY, current?.start_date ?? PROGRAM_START),
      open_workout: open ? { id: open.id, name: sessionName(open), performed_on: open.performed_on, started_at: open.started_at, sets_done: open.sets.filter((x) => !x.is_warmup && x.drop_of == null).length } : null,
      recent: all.filter((s) => s.finished_at).sort((a, b) => b.performed_on.localeCompare(a.performed_on)).slice(0, 5).map(sessionSummary),
    }
  },

  // ----- workouts -----
  exerciseLibrary(): LibraryExercise[] {
    return exerciseLibrary
  },

  startWorkout(templateId: string | null) {
    const open = openSession()
    if (open) return { id: open.id }
    for (const s of [...sessions.values()]) if (s.skipped && s.template_id === templateId && s.performed_on >= WEEK_START) sessions.delete(s.id)
    const id = crypto.randomUUID()
    sessions.set(id, { id, template_id: templateId, performed_on: TODAY, started_at: new Date().toISOString(), finished_at: null, duration_min: null, notes: '', sets: [] })
    return { id }
  },

  skipWorkout(templateId: string, date: string, reason: string) {
    if ([...sessions.values()].some((s) => s.skipped && s.template_id === templateId && s.performed_on === date)) throw new ApiError(409, "It's already marked skipped.")
    const id = crypto.randomUUID()
    sessions.set(id, { id, template_id: templateId, performed_on: date, started_at: null, finished_at: new Date().toISOString(), duration_min: null, notes: reason.trim(), sets: [], skipped: true })
    const day = days.find((d) => d.date === date)
    if (day) day.workout = { name: sessionName(sessions.get(id)!), status: 'skipped' }
    return { id }
  },

  undoSkip(id: string) {
    const s = sessions.get(id)
    if (s?.skipped) {
      sessions.delete(id)
      const day = days.find((d) => d.date === s.performed_on)
      if (day?.workout?.status === 'skipped') day.workout = { name: sessionName(s), status: s.performed_on < TODAY ? 'skipped' : 'planned' }
    }
    return { ok: true }
  },

  workoutLog(id: string): WorkoutLog {
    const s = demoSession(id)
    return {
      id: s.id, name: sessionName(s), template_id: s.template_id, performed_on: s.performed_on, started_at: s.started_at,
      finished_at: s.finished_at, duration_min: s.duration_min, notes: s.notes, effort: s.effort ?? null, units: demoUnits(),
      coach_notes: planWorkout(s.template_id)?.notes ?? null,
      plan: planWorkout(s.template_id)?.exercises ?? [],
      sets: s.sets.map((x) => ({ ...x })),
    }
  },

  lastTime(sessionId: string, exerciseIds: string[]): Record<string, LastTime> {
    const out: Record<string, LastTime> = {}
    const before = [...sessions.values()].filter((s) => s.id !== sessionId).sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
    for (const id of exerciseIds) {
      const s = before.find((x) => x.sets.some((l) => l.exercise_id === id && !l.is_warmup))
      if (s) out[id] = { date: s.performed_on, sets: inSetOrder(s.sets.filter((l) => l.exercise_id === id && !l.is_warmup).map(({ set_number, weight_kg, reps, rpe, drop_of }) => ({ set_number, weight_kg, reps, rpe, drop_of: drop_of ?? null }))) }
    }
    return out
  },

  saveSet(sessionId: string, set: SetWrite) {
    const s = demoSession(sessionId)
    const i = s.sets.findIndex((x) => x.exercise_id === set.exercise_id && x.set_number === set.set_number)
    // The body map counts working sets only, so a set switched to or from warm-up moves the count.
    if (set.drop_of != null) {
      const head = s.sets.find((x) => x.exercise_id === set.exercise_id && x.set_number === set.drop_of)
      if (!head || head.is_warmup || head.drop_of != null) throw new ApiError(422, 'A drop follows a working set of the same exercise. Tick that set first.')
    }
    if (set.is_warmup && s.sets.some((x) => x.exercise_id === set.exercise_id && x.drop_of === set.set_number)) throw new ApiError(422, 'This set has drops. Remove them first.')
    // The body map counts hard sets: a working set and its drops once, warm-ups never.
    const counted = (x: SetWrite | undefined) => (x && !x.is_warmup && x.drop_of == null ? 1 : 0)
    const change = counted(set) - counted(i >= 0 ? s.sets[i] : undefined)
    if (i >= 0) s.sets[i] = { ...set }
    else s.sets.push({ ...set })
    if (change && s.performed_on >= WEEK_START) countSets(set.exercise_id, change)
    return { ok: true }
  },

  deleteSet(sessionId: string, exerciseId: string, setNumber: number) {
    const s = demoSession(sessionId)
    const gone = s.sets.find((x) => x.exercise_id === exerciseId && x.set_number === setNumber)
    // Unticking a working set takes its drops with it (as the database does).
    s.sets = s.sets.filter((x) => x !== gone && !(gone && gone.drop_of == null && x.exercise_id === exerciseId && x.drop_of === setNumber))
    if (gone && !gone.is_warmup && gone.drop_of == null && s.performed_on >= WEEK_START) countSets(exerciseId, -1)
    return { ok: true }
  },

  saveWorkoutNote(id: string, notes: string) {
    demoSession(id).notes = notes.trim()
    return { ok: true }
  },

  finishWorkout(id: string, effort: number | null): WorkoutSummary {
    const s = demoSession(id)
    if (!s.finished_at) {
      if (!s.sets.length) throw new ApiError(409, 'Tick at least one set first, or discard the workout.')
      s.finished_at = new Date().toISOString()
      s.effort = effort != null && Number.isInteger(effort) && effort >= 1 && effort <= 10 ? effort : null
      s.duration_min = minutesSince(s.started_at)
      const day = days.find((d) => d.date === s.performed_on)
      if (day && s.template_id) day.workout = { name: sessionName(s), status: 'done' }
    }
    return sessionSummary(s)
  },

  discardWorkout(id: string) {
    const s = demoSession(id)
    if (!s.finished_at) {
      for (const x of s.sets) if (!x.is_warmup && x.drop_of == null) countSets(x.exercise_id, -1)
      sessions.delete(id)
    }
    return { ok: true }
  },

  setBodyModel(m: BodyModel) {
    bodyModel = m
    return { body_model: m }
  },

  muscle(m: MuscleGroup): MuscleDetail {
    const exercises = library
      .filter((e) => e.primary.includes(m) || e.secondary.includes(m))
      .map((e) => ({ name: e.name, role: e.primary.includes(m) ? ('primary' as const) : ('secondary' as const), sets_this_week: e.week, cue: e.cue, level: e.level, equipment: e.equipment }))
      .sort((a, b) => (a.role === b.role ? b.sets_this_week - a.sets_this_week : a.role === 'primary' ? -1 : 1))
    return { muscle: m, hard_sets: sets[m], exercises, note: muscleNotes[m] }
  },

  foodDay(date: string): FoodDay {
    const day = storedFoodDay(date)
    const plan = planOn(aisha.id, date)
    const cur = targetsOn(aisha.id, date)
    const next = (targetVersions[aisha.id] ?? []).filter((v) => v.effective_from > date).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
    return {
      ...day, meals: day.meals, targets: cur?.targets ?? null, targets_from: cur?.effective_from ?? null,
      next_targets: next ? { targets: next.targets, from: next.effective_from } : null,
      plan: plan ? planForDay(plan, aishaTraining(date)) : null,
    }
  },

  // ----- food list and meal plans -----
  foods(): Food[] {
    return [...demoFoods].sort((a, b) => a.name.localeCompare(b.name))
  },

  saveFood(d: FoodDraft): { id: string } {
    if (!isCoach()) throw new ApiError(403, "You don't have access to that.")
    const name = d.name.trim()
    if (demoFoods.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.id !== d.id)) throw new ApiError(409, 'There\u2019s already a food with this name.')
    const food: Food = { id: d.id ?? `food-own-${crypto.randomUUID().slice(0, 8)}`, name, basis: d.basis, kcal: d.kcal, protein_g: d.protein_g, carbs_g: d.carbs_g, fat_g: d.fat_g, servings: d.servings.map((s) => ({ ...s })), custom: true }
    const i = demoFoods.findIndex((f) => f.id === food.id)
    if (i >= 0) {
      if (!demoFoods[i].custom) throw new ApiError(404, "That food doesn't exist (or isn't yours).")
      demoFoods[i] = food
      for (const p of mealPlans) for (const m of p.meals) for (const l of m.lines) if (l.food.id === food.id) l.food = food
    } else demoFoods.push(food)
    return { id: food.id! }
  },

  deleteFood(id: string) {
    const f = demoFoods.find((x) => x.id === id)
    if (!f?.custom) throw new ApiError(404, "That food doesn't exist (or isn't yours).")
    if (mealPlans.some((p) => p.meals.some((m) => m.lines.some((l) => l.food.id === id)))) throw new ApiError(409, "It's in a meal plan, so it can't be deleted. Rename it instead.")
    demoFoods.splice(demoFoods.indexOf(f), 1)
    return { ok: true }
  },

  mealPlans(clientId: string): MealPlan[] {
    return mealPlans.filter((p) => p.client_id === clientId).sort((a, b) => b.effective_from!.localeCompare(a.effective_from!)).map(clonePlan)
  },

  mealPlanTemplates(): MealPlan[] {
    return mealPlans.filter((p) => p.client_id == null).sort((a, b) => a.name.localeCompare(b.name)).map(clonePlan)
  },

  saveMealPlan(p: MealPlan): { id: string } {
    if (!isCoach()) throw new ApiError(403, "You don't have access to that.")
    if (p.client_id && !p.effective_from) throw new ApiError(409, 'Choose when the plan starts.')
    if (p.client_id && p.effective_from! < addDays(TODAY, -1)) throw new ApiError(409, 'A plan starts today or later; earlier days keep the plan they had.')
    const same = p.client_id ? mealPlans.find((x) => x.client_id === p.client_id && x.effective_from === p.effective_from) : mealPlans.find((x) => x.id === p.id)
    const saved = { ...clonePlan(p), id: same?.id ?? `plan-${crypto.randomUUID().slice(0, 8)}` }
    if (same) mealPlans.splice(mealPlans.indexOf(same), 1, saved)
    else mealPlans.push(saved)
    return { id: saved.id }
  },

  deleteMealPlan(id: string) {
    const i = mealPlans.findIndex((p) => p.id === id)
    if (i >= 0) mealPlans.splice(i, 1)
    return { ok: true }
  },

  planWeek(clientId: string, weekStart: string): PlanWeek {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d <= TODAY)
    const logged = clientId === aisha.id
      ? days.flatMap((d) => storedFoodDay(d).meals.map((m) => ({ date: d, meal_type: m.meal_type, on_plan: m.on_plan, nutrition: { calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g } })))
      : []
    const r = roster.find((x) => x.client.id === clientId)
    const p = currentProgram(clientId)
    return planWeekFrom(weekStart, mealPlans.filter((x) => x.client_id === clientId).map(clonePlan), logged, mealsFor(clientId === aisha.id ? 4 : 3),
      p ? [{ start_date: p.start_date, weeks: p.weeks, days: p.workouts.map((w) => w.day_of_week) }] : [], r ? targetsOn(clientId, TODAY)?.targets ?? null : null)
  },

  rateDay(date: string, rating: OnPlan) {
    storedFoodDay(date).day_rating = rating
    return { ok: true }
  },

  logMeal(date: string, m: Omit<Meal, 'id'>) {
    const day = storedFoodDay(date)
    const saved = { ...m, items: m.items?.map((x) => ({ ...x })), id: crypto.randomUUID() }
    day.meals.push(saved)
    day.meals.sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
    return saved
  },

  checkinDraft(): CheckinDraft {
    // The coach's active questions, in their order (Settings page).
    return { ...checkin, questions: questions.filter((q) => q.is_active).map((q) => ({ id: q.id!, prompt: q.prompt, answer_type: q.answer_type })), answers: checkin.answers ?? {} }
  },

  saveCheckin(patch: Partial<CheckinDraft>) {
    checkin = { ...checkin, ...patch }
    return checkin
  },

  submitCheckin() {
    checkin = { ...checkin, status: 'submitted' }
    return checkin
  },

  progress(): ClientProgress {
    return {
      start_date: '2026-08-24',
      week: 6,
      weeks: 12,
      weight: { points: aishaWeights.map((kg, i) => ({ label: `W${i + 1}`, kg })), current: 71.8, change: -2.8, goal: 68 },
      plan: [
        { label: 'W1', pct: 85 }, { label: 'W2', pct: 77 }, { label: 'W3', pct: 91 },
        { label: 'W4', pct: 78 }, { label: 'W5', pct: 94 }, { label: 'So far', pct: 80, partial: true },
      ],
      plan_target: 80,
      waist: { cm: 78, change: -4 },
      lift: { exercise: 'Back squat', reps: 6, kg: 82.5, change: 7.5 },
      coach_note: coachNote,
    }
  },

  // ----- coach -----
  coachDashboard(): CoachDashboard {
    const queue = reviewQueue()
    const checkedIn = roster.filter((r) => r.checked_in).length
    const reviewed = roster.filter((r) => r.reviewed).length
    const attention = roster.filter((r) => r.status === 'slipping' || r.status === 'overdue' || r.client.id === 'c-sofia')
    return {
      today: TODAY,
      coach,
      invite_code: DEMO_ACCOUNTS.invite_code,
      stats: {
        active: roster.length, new_this_month: 2, checked_in: checkedIn, reviewed, waiting: queue.length,
        plan_pct: 82, plan_change: 3, attention: attention.map((r) => r.client),
      },
      queue,
      attention: [
        { client: roster[2].client, status: 'slipping', text: 'Plan followed under 70% two weeks running. Sleep is down to about 5 hours.', action: 'Message Priya' },
        { client: roster[6].client, status: 'overdue', text: `Missed last week's check-in. Weight is dropping ${bodyWeight(0.9, demoUnits())} a week, faster than planned.`, action: 'Message Jordan' },
        { client: roster[4].client, status: 'awaiting', text: "Week 2. Logged 2 of 7 days and hasn't checked in yet (due 8 PM).", action: 'Send a reminder' },
      ],
      clients: roster.filter((r) => clientStatus[r.client.id] !== 'archived').map(({ client, goal, week, weeks, days_logged, workouts_done, workouts_planned, food_pct, weight_trend, weight_change, last_check_in, status }) => ({
        client, goal, week, weeks, days_logged, workouts_done, workouts_planned, food_pct, weight_trend, weight_change, last_check_in, status,
        is_new: week === 1, setup_done: true, has_targets: true,
      })),
      total_clients: roster.length,
    }
  },

  checkinLists(): CheckinLists {
    return {
      today: TODAY,
      week_start: WEEK_START,
      checked_in: roster.filter((r) => r.checked_in).length,
      total: roster.length,
      to_review: reviewQueue(),
      not_in: roster.filter((r) => !r.checked_in).map((r) => ({
        client: r.client,
        due_label: r.status === 'overdue' ? 'Missed Sep 27' : r.last_check_in,
        status: r.status,
      })),
      done: roster.filter((r) => r.reviewed).map(queueItem),
    }
  },

  checkinReview(id: string): CheckinReview {
    const r = byCiId(id)
    if (!r) throw new Error('Check-in not found')
    const st = reviewFor(r)
    const queue = reviewQueue()
    const idx = queue.findIndex((q) => q.check_in_id === id)
    const isAisha = r.client.id === 'c-aisha'
    const w = r.weight_trend
    const perWeek = (w[w.length - 1] - w[0]) / (w.length - 1)
    const remaining = r.weeks - r.week
    const goal = isAisha ? 68 : +(w[w.length - 1] + perWeek * remaining).toFixed(1)

    return {
      check_in_id: id,
      client: r.client,
      goal: r.goal,
      week: r.week,
      weeks: r.weeks,
      start_date: addDays(WEEK_START, -(r.week - 1) * 7),
      check_in_weekday: 'Sundays',
      status: r.status === 'slipping' ? 'slipping' : r.status === 'overdue' ? 'off_track' : 'on_track',
      week_start: WEEK_START,
      submitted_at: r.submitted_at ?? `${TODAY}T12:00:00`,
      avg_weight_kg: w[w.length - 1],
      weight_change: r.weight_change,
      waist_cm: isAisha ? 78 : 84,
      waist_change: isAisha ? -1 : -0.5,
      workouts_done: isAisha ? 3 : r.workouts_done,
      workouts_planned: r.workouts_planned,
      skipped_note: isAisha ? 'Skipped Thu' : r.workouts_done < r.workouts_planned ? `${r.workouts_planned - r.workouts_done} missed` : null,
      meals_pct: r.food_pct,
      meals_on_plan: Math.round((r.food_pct / 100) * 20),
      meals_planned: 20,
      energy: isAisha ? 4 : r.status === 'slipping' ? 2 : 4,
      sleep: isAisha ? 3 : r.status === 'slipping' ? 2 : 4,
      stress: isAisha ? 2 : r.status === 'slipping' ? 4 : 2,
      hunger: 3,
      wins: isAisha ? 'All 4 squat sets at 82.5 kg. Prepped lunches for the whole week.' : 'Hit every planned session and kept protein up.',
      struggles: isAisha
        ? "Late work nights Wed and Thu, about 6 h sleep. Skipped Thursday's session."
        : r.status === 'slipping' ? 'Work travel. Ate out most nights and slept badly.' : 'Nothing major. Weekend was a bit loose.',
      question: isAisha ? 'Can I swap Romanian deadlifts for hip thrusts? Lower back felt tight.' : null,
      weights: Array.from({ length: r.weeks }, (_, i) => ({ label: `W${i + 1}`, kg: i < w.length ? w[i] : null })),
      goal_kg: goal,
      projection_kg: isAisha ? 68.4 : goal,
      plan_by_week: isAisha
        ? [[100, 70], [75, 78], [100, 82], [75, 80], [100, 88], [75, 85]].map(([t, f], i) => ({ label: `W${i + 1}`, training: t, food: f }))
        : w.map((_, i) => ({ label: `W${i + 1}`, training: i % 2 ? 75 : 100, food: Math.max(50, r.food_pct - 6 + i * 2) })),
      photos: [
        { pose: 'front', url: isAisha ? 'placeholder' : null },
        { pose: 'side', url: isAisha ? 'placeholder' : null },
        { pose: 'back', url: null },
      ],
      draft: st.draft,
      draft_saved_at: st.draft_saved_at,
      targets: st.targets,
      suggestion: isAisha && !st.suggestion_applied
        ? { title: 'Suggested from her question', text: 'Swap Romanian deadlift for hip thrust in Full body C, weeks 7 and 8.' }
        : null,
      private_notes: st.private_notes,
      answers: [],
      queue_position: idx >= 0 ? idx + 1 : 0,
      queue_total: queue.length,
      prev_id: idx > 0 ? queue[idx - 1].check_in_id : null,
      next_id: idx >= 0 && idx < queue.length - 1 ? queue[idx + 1].check_in_id : null,
    }
  },

  saveReviewDraft(id: string, patch: { draft?: string; private_notes?: string; targets?: Targets }) {
    const r = byCiId(id)
    if (!r) throw new Error('Check-in not found')
    const st = reviewFor(r)
    Object.assign(st, patch, patch.draft !== undefined ? { draft_saved_at: new Date().toISOString() } : {})
    return { draft_saved_at: st.draft_saved_at }
  },

  sendReview(id: string, body: { message: string; mark_reviewed: boolean; targets: Targets | null }) {
    const r = byCiId(id)
    if (!r) throw new Error('Check-in not found')
    const before = reviewQueue()
    const idx = before.findIndex((q) => q.check_in_id === id)
    const st = reviewFor(r)
    if (body.targets) st.targets = body.targets
    st.draft = ''
    if (body.mark_reviewed) {
      r.reviewed = true
      r.last_check_in = `${r.submitted_label} · reviewed`
    }
    const after = reviewQueue()
    const next = after[Math.min(Math.max(idx, 0), after.length - 1)]
    return { next_id: next && next.check_in_id !== id ? next.check_in_id : null }
  },

  applySuggestion(id: string) {
    const r = byCiId(id)
    if (!r) throw new Error('Check-in not found')
    reviewFor(r).suggestion_applied = true
    return { ok: true }
  },

  logDaily(date: string, patch: DailyPatch) {
    if (date === TODAY) {
      if (patch.steps !== undefined) habitsToday.steps_today = patch.steps
      if (patch.water_ml !== undefined) habitsToday.water_ml_today = patch.water_ml
      if (patch.sleep_hours !== undefined) habitsToday.sleep_last_night = patch.sleep_hours
      if (patch.weight_kg !== undefined) habitsToday.weight_today = patch.weight_kg
    }
    return { ok: true }
  },

  clientDetail(clientId: string): ClientDetail {
    const r = roster.find((x) => x.client.id === clientId) ?? roster[0]
    return {
      client: r.client, email: `${r.client.first_name.toLowerCase()}@example.com`, setup_done: true, goal: r.goal,
      start_date: addDays(WEEK_START, -(r.week - 1) * 7), week: r.week, date_of_birth: '1996-03-14', phone: r.client.id === aisha.id ? (profileEdits.phone ?? '+1 555 0100') : '+1 555 0123', height_cm: 165,
      start_weight_kg: r.weight_trend[0] ?? null, goal_weight_kg: r.client.id === aisha.id ? 68 : null,
      ...answersOf(r.client.id), diet: 'none', foods_to_avoid: null, meals_per_day: 4,
      targets: targetsOn(clientId, TODAY)?.targets ?? null, targets_from: targetsOn(clientId, TODAY)?.effective_from ?? null,
      check_in_day: checkInDay[clientId] ?? 0,
      program: (() => {
        const p = currentProgram(clientId) ?? upcomingProgram(clientId)
        if (!p) return null
        const status = statusOf(p)
        return { id: p.id, name: p.name, status, week: status === 'active' ? programWeekOf(p.start_date!, TODAY) : null, weeks: p.weeks, start_date: p.start_date }
      })(),
      draft_program_id: [...programs.values()].find((p) => p.client_id === clientId && !p.assigned && !p.is_template)?.id ?? null,
    }
  },

  setTargets(clientId: string, t: Targets, from: string = TODAY) {
    const list = (targetVersions[clientId] ??= []).filter((v) => v.effective_from !== from)
    targetVersions[clientId] = [...list, { effective_from: from, targets: { ...t } }]
    return { ok: true }
  },

  // ----- profile pictures (in memory: the picked image's blob: URL) -----
  avatars(): Record<string, string> {
    return { ...demoAvatars }
  },
  setAvatar(localUrl: string) {
    const me = getCurrentUser()
    if (!me) throw new ApiError(401, 'Log in first.')
    // The demo client is shown as Aisha everywhere, so her id carries the photo too.
    for (const id of new Set([me.id, isCoach() ? coach.id : aisha.id])) demoAvatars[id] = localUrl
    return { ok: true }
  },
  removeAvatar() {
    const me = getCurrentUser()
    for (const id of [me?.id, isCoach() ? coach.id : aisha.id]) if (id) delete demoAvatars[id]
    return { ok: true }
  },

  // ----- the coach's own exercises (kept in memory, added to the library) -----
  saveExercise(d: ExerciseDraft): { id: string } {
    if (!isCoach()) throw new ApiError(403, 'Only coaches can add exercises.')
    const name = d.name.trim()
    const clash = exerciseLibrary.find((e) => e.name.toLowerCase() === name.toLowerCase() && e.id !== d.id)
    if (clash) throw new ApiError(409, clash.custom ? 'You already have an exercise with this name.' : 'The library already has this one. Pick it from the list instead.')
    const e: LibraryExercise = {
      id: d.id ?? `ex-custom-${crypto.randomUUID().slice(0, 8)}`, name, level: d.level, equipment: d.equipment.trim(),
      cue: d.cue.trim() || null, primary: [...d.primary], secondary: [...d.secondary], custom: true,
    }
    const i = exerciseLibrary.findIndex((x) => x.id === e.id)
    if (i >= 0) {
      if (!exerciseLibrary[i].custom) throw new ApiError(404, "That exercise doesn't exist (or isn't yours).")
      exerciseLibrary[i] = e
    } else exerciseLibrary.push(e)
    exerciseLibrary.sort((a, b) => a.name.localeCompare(b.name))
    exerciseById.set(e.id, e)
    return { id: e.id }
  },

  deleteExercise(id: string) {
    const e = exerciseById.get(id)
    if (!e?.custom) throw new ApiError(404, "That exercise doesn't exist (or isn't yours).")
    const used = [...programs.values()].some((p) => p.workouts.some((w) => w.exercises.some((x) => x.exercise_id === id)))
      || [...sessions.values()].some((s) => s.sets.some((x) => x.exercise_id === id))
    if (used) throw new ApiError(409, "It's in a program or a logged workout, so it can't be deleted. Rename it instead.")
    exerciseLibrary.splice(exerciseLibrary.indexOf(e), 1)
    exerciseById.delete(id)
    return { ok: true }
  },

  progressDetail(period: Period): ProgressDetail {
    return progressFrom(aishaProgressRaw(), period)
  },

  clientProgress(clientId: string, period: Period): ProgressDetail {
    const r = roster.find((x) => x.client.id === clientId)
    if (!r) throw new ApiError(404, "That client isn't one of yours.")
    return progressFrom(rosterProgressRaw(r), period)
  },

  // ----- coach pages -----
  coachClients(): CoachClientRow[] {
    return roster.map((r): CoachClientRow => {
      const prog = currentProgram(r.client.id)
      return {
        client: r.client, goal: r.goal, status: clientStatus[r.client.id] ?? 'active', setup_done: true, week: r.week,
        program: prog ? { id: prog.id, name: prog.name } : null,
        has_targets: !!targetsOn(r.client.id, TODAY),
        last_check_in: r.checked_in ? { id: ciId(r), week_start: WEEK_START, status: r.reviewed ? 'reviewed' : 'submitted' } : null,
        last_activity: addDays(TODAY, -(roster.indexOf(r) % 4)),
        signals: (() => {
          const raw = rosterProgressRaw(r)
          const { forecast, plateau } = weightSignals(raw.days.map((d) => ({ date: d.date, kg: d.weight_kg })), TODAY, raw.start_date, raw.goal_weight_kg)
          return { forecast, plateau }
        })(),
      }
    })
  },

  clientHistory(clientId: string): ClientHistory {
    const r = roster.find((x) => x.client.id === clientId) ?? roster[0]
    const w = r.client.id === aisha.id ? aishaWeights : r.weight_trend
    return {
      weights: w.map((kg, i) => ({ label: `W${r.week - w.length + i + 1}`, kg })),
      check_ins: Array.from({ length: Math.min(r.week - 1, 6) }, (_, i) => {
        const ws = addDays(WEEK_START, -7 * i)
        const current = i === 0
        return {
          id: current ? ciId(r) : `${ciId(r)}-${i}`, week_start: ws,
          status: current ? (r.reviewed ? 'reviewed' : r.checked_in ? 'submitted' : 'due') : 'reviewed',
          submitted_at: current && !r.checked_in ? null : `${addDays(ws, 6)}T18:30:00`,
          reviewed_at: current && !r.reviewed ? null : `${addDays(ws, 7)}T09:00:00`,
        }
      }),
      notes: coachNotes[clientId] ?? '',
      last_activity: addDays(TODAY, -(roster.indexOf(r) % 4)),
    }
  },

  setClientStatus(clientId: string, status: ClientStatus) {
    clientStatus[clientId] = status
    return { ok: true }
  },

  setCheckInDay(clientId: string, day: number) {
    checkInDay[clientId] = day
    return { ok: true }
  },

  setCoachNotes(clientId: string, notes: string) {
    coachNotes[clientId] = notes.trim()
    return { ok: true }
  },

  nutritionRows(): NutritionRow[] {
    return roster.map((r) => {
      const cur = targetsOn(r.client.id, TODAY)
      const next = (targetVersions[r.client.id] ?? []).filter((v) => v.effective_from > TODAY).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
      return { client: r.client, goal: r.goal, status: clientStatus[r.client.id] ?? 'active', current: cur ? structuredClone(cur) : null, next: next ? structuredClone(next) : null }
    })
  },

  targetHistory(clientId: string): TargetVersion[] {
    return structuredClone(targetVersions[clientId] ?? []).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  },

  coachSettings(): CoachSettings {
    return { ...coachSettings }
  },

  saveCoachSettings(x: { full_name: string; default_check_in_day: number }) {
    Object.assign(coachSettings, { full_name: x.full_name.trim(), default_check_in_day: x.default_check_in_day })
    return { ok: true }
  },

  rotateInviteCode() {
    coachSettings.invite_code = `SIMRAN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    return { invite_code: coachSettings.invite_code }
  },

  coachQuestions(): CoachQuestion[] {
    return structuredClone(questions)
  },

  saveQuestions(qs: CoachQuestion[]) {
    const kept = qs.map((q) => ({ ...q, id: q.id ?? crypto.randomUUID(), prompt: q.prompt.trim() }))
    // Answered questions that were removed are turned off instead.
    const answered = questions.filter((q) => !qs.some((x) => x.id === q.id) && q.answers > 0).map((q) => ({ ...q, is_active: false }))
    questions = [...kept, ...answered]
    return { ok: true }
  },

  // ----- client profile -----
  myProfile(): MyProfile {
    const p = demoProfile()
    return { ...p, full_name: signedIn()?.full_name ?? p.full_name, units: getCurrentUser()?.units ?? 'imperial' }
  },

  saveMyProfile(x: ProfilePatch) {
    Object.assign(profileEdits, x)
    return { ok: true }
  },

  // ----- messages -----
  messageThread(clientId: string | null): MessageThread {
    const t = demoThreadOf(clientId)
    const client = clientId ? everyone().find((p) => p.id === clientId) ?? aisha : signedIn() ?? aisha
    return {
      client,
      other: clientId ? client : coach,
      messages: messages.filter((m) => m.client_id === t.client).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => demoChat(m, t.me)),
      can_send: true,
    }
  },

  sendMessage(clientId: string | null, body: string): ChatMessage {
    const text = body.trim()
    if (!text) throw new ApiError(422, 'Write a message first.')
    if (text.length > 2000) throw new ApiError(422, 'Messages can be up to 2,000 characters.')
    const t = demoThreadOf(clientId)
    const m: DemoMessage = { id: crypto.randomUUID(), client_id: t.client, sender_id: t.me, body: text, created_at: new Date().toISOString(), check_in_id: null, read_at: null }
    messages.push(m)
    return demoChat(m, t.me)
  },

  markThreadRead(clientId: string | null) {
    const t = demoThreadOf(clientId)
    const now = new Date().toISOString()
    for (const m of messages) if (m.client_id === t.client && m.sender_id !== t.me && !m.read_at) m.read_at = now
    return { ok: true }
  },

  unreadMessages(): number {
    return isCoach()
      ? messages.filter((m) => m.sender_id === m.client_id && !m.read_at).length
      : messages.filter((m) => m.client_id === aisha.id && m.sender_id !== aisha.id && !m.read_at).length
  },

  conversations(): Conversation[] {
    return roster
      .map((r): Conversation => {
        const thread = messages.filter((m) => m.client_id === r.client.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
        const last = thread.at(-1)
        return {
          client: r.client,
          last: last ? { body: last.body, created_at: last.created_at, from_me: last.sender_id === coach.id, feedback: !!last.check_in_id } : null,
          unread: thread.filter((m) => m.sender_id === r.client.id && !m.read_at).length,
        }
      })
      .sort((a, b) => (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? '') || a.client.full_name.localeCompare(b.client.full_name))
  },

  checkinSummary(id: string): CheckinSummary {
    const prev = id === PREV_CHECK_IN.id
    return {
      id,
      week_start: prev ? PREV_CHECK_IN.week_start : checkin.week_start,
      status: prev ? 'reviewed' : checkin.status,
      submitted_at: prev ? '2026-09-27T17:45:00' : `${TODAY}T18:40:00`,
      avg_weight_kg: prev ? 72.2 : checkin.weight_kg,
      waist_cm: prev ? 79 : checkin.waist_cm,
      hips_cm: prev ? 98 : checkin.hips_cm,
      energy: prev ? 4 : checkin.energy,
      sleep: prev ? 4 : checkin.sleep,
      stress: prev ? 2 : checkin.stress,
      hunger: prev ? 3 : checkin.hunger,
      wins: prev ? 'Hit protein every day and all four sessions.' : checkin.wins,
      struggles: prev ? 'Weekend snacking.' : checkin.struggles,
      question: prev ? null : checkin.question,
      feedback: messages.filter((m) => m.check_in_id === id).map((m) => demoChat(m, aisha.id)),
    }
  },

  // ----- programs -----
  programClients(): ProgramClientRow[] {
    return roster.map((r): ProgramClientRow => {
      const a = answersOf(r.client.id)
      const cur = currentProgram(r.client.id)
      const next = upcomingProgram(r.client.id)
      const draft = [...programs.values()].find((p) => p.client_id === r.client.id && !p.assigned)
      return {
        client: r.client, setup_done: true, goal: r.goal, experience: a.experience, training_days: a.training_days,
        train_location: a.train_location, injuries: a.injuries,
        current: cur ? { id: cur.id, name: cur.name, week: programWeekOf(cur.start_date!, TODAY), weeks: cur.weeks, start_date: cur.start_date! } : null,
        upcoming: next ? { id: next.id, name: next.name, start_date: next.start_date! } : null,
        draft: draft ? { id: draft.id, name: draft.name } : null,
      }
    }).sort((a, b) => a.client.full_name.localeCompare(b.client.full_name))
  },

  programTemplates(): ProgramTemplateRow[] {
    return [...programs.values()].filter((p) => p.is_template).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
      id: p.id, name: p.name, goal: p.goal, level: p.level, days_per_week: p.days_per_week, weeks: p.weeks, workouts: p.workouts.length,
    }))
  },

  program(id: string): Program {
    return toProgram(demoProgram(id))
  },

  saveProgram(p: Program) {
    const id = p.id ?? `prog-${crypto.randomUUID().slice(0, 8)}`
    const before = p.id ? demoProgram(p.id) : null
    const loggedSlots = new Set([...sessions.values()].flatMap((x) => x.sets.map((l) => `${l.template_exercise_id}|${l.exercise_id}`)))
    const workouts = p.workouts.map((w) => ({
      ...w,
      exercises: w.exercises.map((x) => {
        // Sets logged against a slot's old exercise keep that slot; the plan gets a new one (as in save_program).
        const old = before?.workouts.flatMap((bw) => bw.exercises).find((bx) => bx.id === x.id)
        return old && old.exercise_id !== x.exercise_id && loggedSlots.has(`${old.id}|${old.exercise_id}`) ? { ...x, id: null } : x
      }),
    }))
    for (const w of before?.workouts ?? []) {
      if (!workouts.some((x) => x.id === w.id) && [...sessions.values()].some((x) => x.template_id === w.id)) retiredWorkouts.set(w.id!, w.name)
    }
    programs.set(id, {
      id, client_id: p.client_id, is_template: p.client_id == null, assigned: before?.assigned ?? false, name: p.name.trim(), weeks: p.weeks,
      goal: p.goal, level: p.level, days_per_week: p.workouts.filter((w) => w.day_of_week != null).length || null,
      start_date: before?.start_date ?? null, draft_start: before?.assigned ? null : p.draft_start,
      workouts: withIds(id, workouts),
    })
    return { id }
  },

  assignProgram(id: string, start: string) {
    const p = demoProgram(id)
    if (p.is_template) throw new ApiError(409, 'Templates are copied to a client first.')
    if (start < TODAY) throw new ApiError(409, 'Pick a start date from today on.')
    const monday = addDays(start, -((new Date(`${start}T00:00:00`).getDay() + 6) % 7))
    for (const q of programs.values()) {
      if (q.id === p.id || q.client_id !== p.client_id || !q.start_date) continue
      const qMonday = addDays(q.start_date, -((new Date(`${q.start_date}T00:00:00`).getDay() + 6) % 7))
      if (qMonday >= monday) q.start_date = null // replaced before it began
      else if (addDays(qMonday, q.weeks * 7) > monday) q.weeks = Math.round((new Date(`${monday}T00:00:00`).getTime() - new Date(`${qMonday}T00:00:00`).getTime()) / (7 * 86_400_000))
    }
    Object.assign(p, { assigned: true, start_date: start, draft_start: null })
    return { ok: true }
  },

  copyProgram(id: string, clientId: string | null) {
    const src = demoProgram(id)
    const nid = `${clientId ? 'prog' : 'tpl'}-${crypto.randomUUID().slice(0, 8)}`
    programs.set(nid, {
      ...structuredClone(src), id: nid, client_id: clientId, is_template: clientId == null, assigned: false, start_date: null, draft_start: null,
      workouts: withIds(nid, src.workouts.map((w) => ({ ...w, id: null, exercises: w.exercises.map((x) => ({ ...x, id: null })) }))),
    })
    return { id: nid }
  },

  deleteProgram(id: string) {
    const p = demoProgram(id)
    if (p.assigned && !p.is_template) throw new ApiError(409, 'Only drafts and templates can be deleted. An assigned program keeps its history.')
    programs.delete(id)
    return { ok: true }
  },

  /** Only Aisha (the demo client) has a workout log. */
  clientWorkouts(clientId: string): WorkoutSummary[] {
    if (clientId !== aisha.id) return []
    return [...sessions.values()].sort((a, b) => b.performed_on.localeCompare(a.performed_on) || (b.started_at ?? '').localeCompare(a.started_at ?? '')).map(sessionSummary)
  },
}
