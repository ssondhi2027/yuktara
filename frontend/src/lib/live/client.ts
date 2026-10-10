// Live data for the client app: every query runs as the signed-in client, so
// RLS limits it to their own rows (and their coach's public details).

import { MUSCLE_GROUPS, type BodyModel, type MealType, type MuscleGroup, type OnPlan, type PhotoPose, type UnitSystem } from '@/types/db'
import type {
  CheckinDraft, ClientHome, ClientProgress, DailyPatch, DaySummary, FoodDay, LastTime, LibraryExercise, Meal, MuscleDetail,
  MuscleExercise, NextProgram, OpenWorkout, Person, PlannedExercise, SetWrite, TodayWorkout, TrainWeek, WeekPoint, WorkoutLog, WorkoutSummary,
} from '../api'
import { ApiError, backend, uploadPhoto } from '../backend'
import { addDays, parseDate, today, weekStart } from '../dates'
import {
  avg, dayBounds, db, lastCoachMessage, localDate, must, myId, nextCheckInDate, person, plannedMeals,
  programWeek, round1, sessionSummaries, sessionSummary, SESSION_SUMMARY_COLS, signedUrls, targetsOn, weekMonday,
} from './shared'
import { minutesSince, OWN_WORKOUT, weekPlan, workoutsDone, type PlanTemplate } from '../workouts'

// ---------- Who am I ----------

interface TemplateExercise {
  id: string; position: number; target_sets: number; target_reps: string; target_rpe: number | null; rest_seconds: number | null
  exercise_id: string; name: string; cue: string | null; notes: string | null
}
interface Template { id: string; name: string; day_of_week: number | null; position: number; notes: string | null; exercises: TemplateExercise[] }
interface Program { id: string; name: string; start_date: string; weeks: number; templates: Template[] }

interface Me {
  id: string
  person: Person
  units: UnitSystem
  start_date: string
  start_weight_kg: number | null
  goal_weight_kg: number | null
  check_in_day: number
  body_model: BodyModel
  meals_per_day: number | null
  coach: Person | null
  program: Program | null
  /** an assigned program that starts later */
  next: NextProgram | null
}

async function loadMe(): Promise<Me> {
  const uid = await myId()
  const [u, p] = await Promise.all([
    db().from('users').select('id, full_name, unit_system').eq('id', uid).single(),
    // Column list on purpose: coach_notes is not readable by clients.
    db().from('client_profiles')
      .select('coach_id, start_date, start_weight_kg, goal_weight_kg, check_in_day, body_model, meals_per_day')
      .eq('user_id', uid).single(),
  ])
  const user = must(u)
  const prof = must(p)
  const [coachRes, programRes, nextRes] = await Promise.all([
    prof.coach_id ? db().from('users').select('id, full_name').eq('id', prof.coach_id).maybeSingle() : null,
    // The latest assigned program that has started (RLS hides drafts); removed workouts and exercises left out (0015).
    db().from('programs')
      .select('id, name, start_date, weeks, workout_templates(id, name, day_of_week, position, notes, template_exercises(id, position, target_sets, target_reps, target_rpe, rest_seconds, notes, exercise_id, exercises(name, cue)))')
      .eq('client_id', uid)
      .lte('start_date', today())
      .is('workout_templates.removed_at', null)
      .is('workout_templates.template_exercises.removed_at', null)
      .order('start_date', { ascending: false })
      .limit(1),
    db().from('programs').select('name, start_date').eq('client_id', uid).gt('start_date', today()).order('start_date').limit(1),
  ])
  const coachRow = coachRes ? must(coachRes) : null
  const prog = must(programRes)[0]
  const next = (must(nextRes) as NextProgram[])[0] ?? null
  return {
    next,
    id: uid,
    person: person(uid, user.full_name),
    units: user.unit_system ?? 'metric',
    start_date: prof.start_date,
    start_weight_kg: prof.start_weight_kg != null ? Number(prof.start_weight_kg) : null,
    goal_weight_kg: prof.goal_weight_kg != null ? Number(prof.goal_weight_kg) : null,
    check_in_day: prof.check_in_day,
    body_model: prof.body_model,
    meals_per_day: prof.meals_per_day,
    coach: coachRow ? person(coachRow.id, coachRow.full_name) : null,
    program: prog ? {
      id: prog.id, name: prog.name, start_date: prog.start_date, weeks: prog.weeks,
      templates: (prog.workout_templates ?? []).map((t: any) => ({
        id: t.id, name: t.name, day_of_week: t.day_of_week, position: t.position, notes: t.notes,
        exercises: (t.template_exercises ?? [])
          .sort((a: any, b: any) => a.position - b.position)
          .map((x: any) => ({
            id: x.id, position: x.position, target_sets: x.target_sets, target_reps: x.target_reps,
            target_rpe: x.target_rpe != null ? Number(x.target_rpe) : null, rest_seconds: x.rest_seconds,
            exercise_id: x.exercise_id, name: x.exercises?.name ?? 'Exercise', cue: x.exercises?.cue ?? null, notes: x.notes ?? null,
          })),
      })).sort((a: Template, b: Template) => a.position - b.position),
    } : null,
  }
}

const plannedTemplates = (p: Program | null) => (p ? p.templates.filter((t) => t.day_of_week != null) : [])

// ---------- Shared week data ----------

interface DailyRow { log_date: string; steps: number | null; water_ml: number | null; sleep_hours: number | null; weight_kg: number | null; day_rating: OnPlan | null }
interface MealRow { id: string; eaten_at: string; meal_type: MealType; title: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; on_plan: OnPlan | null; photo_url: string | null }
interface SessionRow { id: string; performed_on: string; status: 'done' | 'partial' | 'skipped'; workout_template_id: string | null; set_logs: { id: string; is_warmup: boolean }[] }

async function dailyLogs(uid: string, from: string): Promise<DailyRow[]> {
  return must(await db().from('daily_logs')
    .select('log_date, steps, water_ml, sleep_hours, weight_kg, day_rating')
    .eq('client_id', uid).gte('log_date', from).order('log_date'))
    .map((r: any) => ({ ...r, sleep_hours: r.sleep_hours != null ? Number(r.sleep_hours) : null, weight_kg: r.weight_kg != null ? Number(r.weight_kg) : null }))
}

async function mealsBetween(uid: string, from: string, toExclusive: string): Promise<MealRow[]> {
  return must(await db().from('meal_logs')
    .select('id, eaten_at, meal_type, title, calories, protein_g, carbs_g, fat_g, on_plan, photo_url')
    .eq('client_id', uid).gte('eaten_at', dayBounds(from)[0]).lt('eaten_at', dayBounds(toExclusive)[0])
    .order('eaten_at'))
}

async function sessionsBetween(uid: string, from: string, to: string): Promise<SessionRow[]> {
  return must(await db().from('workout_sessions')
    .select('id, performed_on, status, workout_template_id, set_logs(id, is_warmup)')
    .eq('client_id', uid).gte('performed_on', from).lte('performed_on', to))
}

const num = (x: unknown) => (x == null ? 0 : Number(x))

function toMeal(r: MealRow, urls: Record<string, string>): Meal {
  return {
    id: r.id, meal_type: r.meal_type, eaten_at: r.eaten_at, title: r.title,
    calories: num(r.calories), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
    on_plan: r.on_plan ?? 'yes', photo_url: r.photo_url ? urls[r.photo_url] ?? null : null,
  }
}

/** Weekly-average weights, one point per program week up to `upTo`. */
function weightPoints(start: string, logs: DailyRow[], upTo: number, maxPoints = 12): WeekPoint[] {
  const first = Math.max(1, upTo - maxPoints + 1)
  const points: WeekPoint[] = []
  for (let w = first; w <= upTo; w++) {
    const mon = weekMonday(start, w)
    const sun = addDays(mon, 6)
    const ws = logs.filter((l) => l.weight_kg != null && l.log_date >= mon && l.log_date <= sun).map((l) => l.weight_kg as number)
    const a = avg(ws)
    points.push({ label: `W${w}`, kg: a == null ? null : round1(a) })
  }
  return points
}

type Swaps = Record<string, { id: string; name: string; cue: string | null }>

/** The coach's program swaps (exercise_swaps) in force in program week `week`, by template exercise. */
async function exerciseSwaps(me: Me, week: number): Promise<Swaps> {
  const ids = me.program?.templates.flatMap((t) => t.exercises.map((x) => x.id)) ?? []
  if (!ids.length) return {}
  const rows = must(await db().from('exercise_swaps')
    .select('template_exercise_id, from_week, to_week, to_exercise_id, to_exercise:exercises!exercise_swaps_to_exercise_id_fkey(name, cue)')
    .in('template_exercise_id', ids).lte('from_week', week).gte('to_week', week))
  return Object.fromEntries(rows.map((r: any) => [r.template_exercise_id, { id: r.to_exercise_id, name: r.to_exercise?.name ?? 'Exercise', cue: r.to_exercise?.cue ?? null }]))
}

/** A template as the client does it: swaps applied, the coach's targets per exercise. */
function planned(t: Template, swaps: Swaps): PlanTemplate {
  return {
    id: t.id, name: t.name, day_of_week: t.day_of_week, notes: t.notes,
    exercises: t.exercises.map((x): PlannedExercise => {
      const sw = swaps[x.id]
      return {
        template_exercise_id: x.id, exercise_id: sw?.id ?? x.exercise_id, name: sw?.name ?? x.name, cue: sw ? sw.cue : x.cue,
        sets: x.target_sets, reps: x.target_reps, rpe: x.target_rpe, rest_seconds: x.rest_seconds, notes: x.notes,
      }
    }),
  }
}

async function todaysWorkout(me: Me, date: string, sessions: SessionRow[]): Promise<TodayWorkout | null> {
  const p = me.program
  if (!p) return null
  const dow = parseDate(date).getDay()
  const t = plannedTemplates(p).find((x) => x.day_of_week === dow)
  if (!t) return null
  const swaps = await exerciseSwaps(me, programWeek(p.start_date, date))
  const done = sessions.filter((s) => s.performed_on === date && s.workout_template_id === t.id)
    .reduce((n, s) => n + s.set_logs.filter((l) => !l.is_warmup).length, 0)
  return {
    name: t.name,
    duration_min: null,
    exercises: t.exercises.map((x) => ({ name: swaps[x.id]?.name ?? x.name, sets: x.target_sets, reps: x.target_reps })),
    sets_done: done,
    sets_total: t.exercises.reduce((n, x) => n + x.target_sets, 0),
  }
}

// ---------- Best lifts ----------

async function bests(uid: string): Promise<ClientHome['bests']> {
  const rows = must(await db().from('set_logs')
    .select('weight_kg, reps, exercise_id, exercises(name), workout_sessions!inner(performed_on, client_id)')
    .eq('workout_sessions.client_id', uid).eq('is_warmup', false).not('weight_kg', 'is', null)
    .limit(2000))
  const by: Record<string, { name: string; first: { date: string; kg: number }; best: { kg: number; reps: number } }> = {}
  for (const r of rows as any[]) {
    const kg = Number(r.weight_kg)
    const date = r.workout_sessions.performed_on
    const e = (by[r.exercise_id] ??= { name: r.exercises?.name ?? 'Exercise', first: { date, kg }, best: { kg, reps: r.reps ?? 0 } })
    if (date < e.first.date || (date === e.first.date && kg > e.first.kg)) e.first = { date, kg }
    if (kg > e.best.kg) e.best = { kg, reps: r.reps ?? 0 }
  }
  return Object.values(by)
    .map((e) => ({ exercise: e.name, reps: e.best.reps, kg: e.best.kg, change: round1(e.best.kg - e.first.kg) }))
    .sort((a, b) => b.change - a.change || b.kg - a.kg)
    .slice(0, 3)
}

// ---------- Screens ----------

async function foodDay(date: string, ctx?: Me): Promise<FoodDay> {
  const me = ctx ?? await loadMe()
  const [targets, meals, logs] = await Promise.all([
    targetsOn(me.id, date),
    mealsBetween(me.id, date, addDays(date, 1)),
    db().from('daily_logs').select('day_rating').eq('client_id', me.id).eq('log_date', date).maybeSingle(),
  ])
  const urls = await signedUrls(meals.map((m) => m.photo_url).filter((p): p is string => !!p))
  return {
    date,
    targets: targets?.targets ?? null,
    meals: meals.map((m) => toMeal(m, urls)),
    planned: plannedMeals(me.meals_per_day),
    day_rating: must(logs)?.day_rating ?? null,
  }
}

async function home(): Promise<ClientHome> {
  const me = await loadMe()
  const t = today()
  const ws = weekStart(t)
  const week = programWeek(me.start_date, t)
  const [logs, meals, sessions, latest, food, note, best] = await Promise.all([
    dailyLogs(me.id, addDays(me.start_date < ws ? me.start_date : ws, -7)),
    mealsBetween(me.id, ws, addDays(ws, 7)),
    sessionsBetween(me.id, ws, addDays(ws, 6)),
    db().from('check_ins').select('id, week_start, status').eq('client_id', me.id).order('week_start', { ascending: false }).limit(1),
    foodDay(t, me),
    lastCoachMessage(me.id, me.coach),
    bests(me.id),
  ])

  const planned = plannedMeals(me.meals_per_day)
  const templates = plannedTemplates(me.program)
  const days: DaySummary[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(ws, i)
    const dayMeals = meals.filter((m) => localDate(m.eaten_at) === date)
    const log = logs.find((l) => l.log_date === date)
    const session = sessions.find((s) => s.performed_on === date)
    const template = templates.find((x) => x.day_of_week === parseDate(date).getDay())
    const inProgram = me.program && date >= me.program.start_date && date >= me.start_date
    let workout: DaySummary['workout'] = null
    if (session) workout = { name: templates.find((x) => x.id === session.workout_template_id)?.name ?? 'Workout', status: session.status }
    else if (template && inProgram) workout = { name: template.name, status: date >= t ? 'planned' : 'skipped' }
    return {
      date,
      is_today: date === t,
      logged: dayMeals.length > 0 || !!session || !!(log && (log.steps ?? log.water_ml ?? log.sleep_hours ?? log.weight_kg ?? log.day_rating) != null),
      workout,
      meals_on_plan: dayMeals.filter((m) => m.on_plan === 'yes').length,
      meals_planned: Math.max(planned.length, dayMeals.length),
      steps: log?.steps ?? null,
    }
  })

  const proteinByDay = Object.values(meals.reduce<Record<string, number>>((acc, m) => {
    const d = localDate(m.eaten_at)
    acc[d] = (acc[d] ?? 0) + num(m.protein_g)
    return acc
  }, {}))
  const recent = logs.filter((l) => l.log_date > addDays(t, -7))
  const todayLog = logs.find((l) => l.log_date === t)
  const weights = logs.filter((l) => l.weight_kg != null)
  const current = weights.length ? (weights[weights.length - 1].weight_kg as number) : null

  const last = must(latest)[0]
  const open = last?.status === 'due'
  const recentDone = last && ['submitted', 'reviewed'].includes(last.status) && last.week_start >= addDays(weekStart(t), -7)

  return {
    today: t,
    me: { ...me.person, body_model: me.body_model },
    coach: me.coach,
    program: { week, weeks: me.program?.weeks ?? null, start_date: me.start_date, has_program: !!me.program, next: me.next },
    days,
    week: {
      workouts_done: workoutsDone(sessions, !!me.program),
      workouts_planned: templates.length,
      meals_on_plan: meals.filter((m) => m.on_plan === 'yes').length,
      meals_planned: planned.length * 7,
      avg_protein_g: proteinByDay.length ? Math.round(avg(proteinByDay) as number) : null,
    },
    check_in: open
      ? { status: 'due', minutes: 4, next_date: null }
      : recentDone
        ? { status: last.status, minutes: 4, next_date: null }
        : { status: 'none', minutes: 4, next_date: nextCheckInDate(me.start_date, me.check_in_day, t) },
    workout: await todaysWorkout(me, t, sessions),
    food,
    habits: {
      steps_today: todayLog?.steps ?? null,
      water_ml_today: todayLog?.water_ml ?? null,
      sleep_last_night: todayLog?.sleep_hours ?? null,
      weight_today: todayLog?.weight_kg ?? null,
      steps_avg: avgOf(recent.map((l) => l.steps)),
      water_ml_avg: avgOf(recent.map((l) => l.water_ml)),
      sleep_avg: avgOf(recent.map((l) => l.sleep_hours)),
      note: null,
    },
    weight: {
      points: weightPoints(me.start_date, logs, week),
      current,
      change: current != null && me.start_weight_kg != null ? round1(current - me.start_weight_kg) : null,
      goal: me.goal_weight_kg,
      start_date: me.start_date,
    },
    coach_note: note,
    bests: best,
  }
}

const avgOf = (xs: (number | null)[]) => {
  const a = avg(xs.filter((x): x is number => x != null))
  return a == null ? null : round1(a)
}

async function trainWeek(): Promise<TrainWeek> {
  const me = await loadMe()
  const t = today()
  const ws = weekStart(t)
  const [rows, sessions, open, recent, swaps] = await Promise.all([
    db().rpc('muscle_sets_for_week', { client: me.id, week_start: ws }),
    db().from('workout_sessions').select('id, workout_template_id, performed_on, finished_at')
      .eq('client_id', me.id).gte('performed_on', ws).lte('performed_on', addDays(ws, 6)),
    openWorkout(me.id),
    sessionSummaries(me.id, 5),
    me.program ? exerciseSwaps(me, programWeek(me.program.start_date, t)) : Promise.resolve({} as Swaps),
  ])
  const sets = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>
  for (const r of must(rows) as { muscle: MuscleGroup; hard_sets: number }[]) sets[r.muscle] = r.hard_sets
  const weekSessions = (must(sessions) as any[]).map((s) => ({ id: s.id, workout_template_id: s.workout_template_id, performed_on: s.performed_on, finished: s.finished_at != null }))
  if (open) weekSessions.push({ id: open.id, workout_template_id: open.template_id, performed_on: open.performed_on, finished: false })
  const startDate = me.program && me.program.start_date > me.start_date ? me.program.start_date : me.start_date
  return {
    today: t,
    week: programWeek(me.start_date, t),
    weeks: me.program?.weeks ?? null,
    body_model: me.body_model,
    sets,
    has_program: !!me.program,
    next_program: me.next,
    units: me.units,
    plan: weekPlan((me.program?.templates ?? []).map((x) => planned(x, swaps)), weekSessions, t, startDate),
    open_workout: open,
    recent,
  }
}

async function muscle(m: MuscleGroup): Promise<MuscleDetail> {
  const uid = await myId()
  const ws = weekStart(today())
  const [rows, logs, hard] = await Promise.all([
    db().from('exercise_muscles')
      .select('role, note_kind, note, source_url, exercises!inner(id, name, level, equipment, cue)')
      .eq('muscle', m),
    db().from('set_logs')
      .select('exercise_id, workout_sessions!inner(performed_on, client_id, status)')
      .eq('workout_sessions.client_id', uid).gte('workout_sessions.performed_on', ws)
      .lte('workout_sessions.performed_on', addDays(ws, 6)).eq('is_warmup', false),
    db().rpc('muscle_sets_for_week', { client: uid, week_start: ws }),
  ])
  const perExercise: Record<string, number> = {}
  for (const l of must(logs) as any[]) perExercise[l.exercise_id] = (perExercise[l.exercise_id] ?? 0) + 1
  const list = must(rows) as any[]
  const exercises: MuscleExercise[] = list.map((r) => ({
    name: r.exercises.name,
    role: r.role,
    sets_this_week: perExercise[r.exercises.id] ?? 0,
    cue: r.exercises.cue ?? undefined,
    level: r.exercises.level,
    equipment: r.exercises.equipment ?? '',
  })).sort((a, b) => (a.role === b.role ? b.sets_this_week - a.sets_this_week || a.name.localeCompare(b.name) : a.role === 'primary' ? -1 : 1))
  const noted = list.find((r) => r.note)
  return {
    muscle: m,
    hard_sets: (must(hard) as { muscle: MuscleGroup; hard_sets: number }[]).find((r) => r.muscle === m)?.hard_sets ?? 0,
    exercises,
    note: noted ? { kind: noted.note_kind, text: noted.note, source_url: noted.source_url ?? undefined } : undefined,
  }
}

// ---------- Writes ----------

async function rateDay(date: string, rating: OnPlan) {
  const uid = await myId()
  must(await db().from('daily_logs').upsert({ client_id: uid, log_date: date, day_rating: rating }, { onConflict: 'client_id,log_date' }))
  return { ok: true }
}

async function logDaily(date: string, patch: DailyPatch) {
  const uid = await myId()
  const row: Record<string, unknown> = { client_id: uid, log_date: date }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v
  must(await db().from('daily_logs').upsert(row, { onConflict: 'client_id,log_date' }))
  return { ok: true }
}

async function logMeal(_date: string, m: Omit<Meal, 'id'>): Promise<Meal> {
  const uid = await myId()
  const photo = m.photo_url?.startsWith('blob:') ? await uploadPhoto('meals', m.photo_url) : null
  const row: { id: string } = must(await db().from('meal_logs').insert({
    client_id: uid,
    eaten_at: new Date(m.eaten_at).toISOString(), // the form gives local time
    meal_type: m.meal_type,
    title: m.title,
    photo_url: photo,
    calories: m.calories,
    protein_g: m.protein_g,
    carbs_g: m.carbs_g,
    fat_g: m.fat_g,
    on_plan: m.on_plan,
  }).select('id').single())
  return { ...m, id: row.id }
}

async function setBodyModel(model: BodyModel) {
  const uid = await myId()
  must(await db().from('client_profiles').update({ body_model: model }).eq('user_id', uid))
  return { body_model: model }
}

// ---------- Workouts ----------
// Sessions and sets go straight to Supabase as the client; RLS (0013) lets a
// client write only their own, and their coach only read them. A session is
// open while finished_at is null; each set is saved when it's ticked.

function toLibrary(r: any): LibraryExercise {
  const muscles = (r.exercise_muscles ?? []) as { muscle: MuscleGroup; role: 'primary' | 'secondary' }[]
  return {
    id: r.id, name: r.name, level: r.level, equipment: r.equipment ?? '', cue: r.cue ?? null,
    primary: muscles.filter((m) => m.role === 'primary').map((m) => m.muscle),
    secondary: muscles.filter((m) => m.role === 'secondary').map((m) => m.muscle),
  }
}

async function exerciseLibrary(): Promise<LibraryExercise[]> {
  // RLS returns the shared library plus the coach's own exercises.
  const rows = must(await db().from('exercises').select('id, name, level, equipment, cue, exercise_muscles(muscle, role)').order('name'))
  return (rows as any[]).map(toLibrary)
}

async function openWorkout(uid: string): Promise<(OpenWorkout & { template_id: string | null }) | null> {
  const row: any = must(await db().from('workout_sessions')
    .select('id, workout_template_id, performed_on, started_at, workout_templates(name), set_logs(count)')
    .eq('client_id', uid).is('finished_at', null).maybeSingle())
  if (!row) return null
  return {
    id: row.id, template_id: row.workout_template_id, name: row.workout_templates?.name ?? OWN_WORKOUT,
    performed_on: row.performed_on, started_at: row.started_at, sets_done: row.set_logs?.[0]?.count ?? 0,
  }
}

async function startWorkout(templateId: string | null): Promise<{ id: string }> {
  const uid = await myId()
  const open = await openWorkout(uid)
  if (open) return { id: open.id }
  const res = await db().from('workout_sessions').insert({
    client_id: uid, workout_template_id: templateId, performed_on: today(),
    started_at: new Date().toISOString(), finished_at: null, status: 'partial',
  }).select('id').single()
  if (res.error?.code === '23505') {
    // Started on another device a moment ago: resume that one.
    const again = await openWorkout(uid)
    if (again) return { id: again.id }
  }
  return { id: must(res).id }
}

async function workoutLog(id: string): Promise<WorkoutLog> {
  const me = await loadMe()
  const s: any = must(await db().from('workout_sessions')
    .select('id, workout_template_id, performed_on, started_at, finished_at, duration_min, notes, workout_templates(name), set_logs(exercise_id, template_exercise_id, set_number, reps, weight_kg, rpe)')
    .eq('id', id).eq('client_id', me.id).maybeSingle())
  if (!s) throw new ApiError(404, "That workout doesn't exist.")
  const template = me.program?.templates.find((x) => x.id === s.workout_template_id)
  const swaps = template && me.program ? await exerciseSwaps(me, programWeek(me.program.start_date, s.performed_on)) : {}
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    id: s.id,
    name: s.workout_templates?.name ?? OWN_WORKOUT,
    template_id: s.workout_template_id,
    performed_on: s.performed_on,
    started_at: s.started_at,
    finished_at: s.finished_at,
    duration_min: s.duration_min,
    notes: s.notes ?? '',
    units: me.units,
    coach_notes: template?.notes ?? null,
    plan: template ? planned(template, swaps).exercises : [],
    sets: (s.set_logs ?? []).map((l: any): SetWrite => ({
      exercise_id: l.exercise_id, template_exercise_id: l.template_exercise_id, set_number: l.set_number,
      reps: l.reps, weight_kg: n(l.weight_kg), rpe: n(l.rpe),
    })),
  }
}

/** For each exercise, the sets from the most recent other session that had it. */
async function lastTime(sessionId: string, exerciseIds: string[]): Promise<Record<string, LastTime>> {
  if (!exerciseIds.length) return {}
  const uid = await myId()
  const rows = must(await db().from('set_logs')
    .select('exercise_id, set_number, reps, weight_kg, rpe, session_id, workout_sessions!inner(client_id, performed_on, started_at)')
    .eq('workout_sessions.client_id', uid).in('exercise_id', exerciseIds).neq('session_id', sessionId).eq('is_warmup', false)
    .limit(1000)) as any[]
  const latest: Record<string, { key: string; session: string; date: string; sets: LastTime['sets'] }> = {}
  for (const r of rows) {
    const key = `${r.workout_sessions.performed_on} ${r.workout_sessions.started_at ?? ''}`
    const cur = latest[r.exercise_id]
    if (!cur || key > cur.key) latest[r.exercise_id] = { key, session: r.session_id, date: r.workout_sessions.performed_on, sets: [] }
  }
  for (const r of rows) {
    const cur = latest[r.exercise_id]
    if (cur?.session === r.session_id) {
      cur.sets.push({ set_number: r.set_number, reps: r.reps, weight_kg: r.weight_kg == null ? null : Number(r.weight_kg), rpe: r.rpe == null ? null : Number(r.rpe) })
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, { date: v.date, sets: v.sets.sort((a, b) => a.set_number - b.set_number) }]))
}

async function saveSet(sessionId: string, set: SetWrite) {
  must(await db().from('set_logs').upsert({
    session_id: sessionId, exercise_id: set.exercise_id, template_exercise_id: set.template_exercise_id,
    set_number: set.set_number, reps: set.reps, weight_kg: set.weight_kg, rpe: set.rpe, is_warmup: false,
  }, { onConflict: 'session_id,exercise_id,set_number' }))
  return { ok: true }
}

async function deleteSet(sessionId: string, exerciseId: string, setNumber: number) {
  must(await db().from('set_logs').delete().eq('session_id', sessionId).eq('exercise_id', exerciseId).eq('set_number', setNumber))
  return { ok: true }
}

async function saveWorkoutNote(id: string, notes: string) {
  must(await db().from('workout_sessions').update({ notes: notes.trim() || null }).eq('id', id))
  return { ok: true }
}

async function finishWorkout(id: string): Promise<WorkoutSummary> {
  const s: any = must(await db().from('workout_sessions').select('started_at, finished_at, set_logs(count)').eq('id', id).maybeSingle())
  if (!s) throw new ApiError(404, "That workout doesn't exist.")
  if (!s.finished_at) {
    if (!(s.set_logs?.[0]?.count > 0)) throw new ApiError(409, 'Tick at least one set first, or discard the workout.')
    must(await db().from('workout_sessions')
      .update({ finished_at: new Date().toISOString(), duration_min: minutesSince(s.started_at), status: 'done' })
      .eq('id', id))
  }
  return sessionSummary(must(await db().from('workout_sessions').select(SESSION_SUMMARY_COLS).eq('id', id).single()))
}

async function discardWorkout(id: string) {
  must(await db().from('workout_sessions').delete().eq('id', id).is('finished_at', null))
  return { ok: true }
}

// ---------- Check-in ----------

async function checkinDraft(): Promise<CheckinDraft | null> {
  const me = await loadMe()
  const rows = must(await db().from('check_ins')
    .select('id, week_start, status, avg_weight_kg, waist_cm, hips_cm, energy, sleep, stress, hunger, wins, struggles, question')
    .eq('client_id', me.id).in('status', ['due', 'submitted'])
    .order('week_start', { ascending: false }).limit(1))
  const c = rows[0]
  if (!c) return null
  const ws: string = c.week_start
  const [logs, meals, sessions, photos, questions, answers] = await Promise.all([
    dailyLogs(me.id, ws),
    mealsBetween(me.id, ws, addDays(ws, 7)),
    sessionsBetween(me.id, ws, addDays(ws, 6)),
    db().from('progress_photos').select('pose, photo_url').eq('check_in_id', c.id),
    db().from('checkin_questions').select('id, prompt, answer_type').eq('is_active', true).order('position'),
    db().from('checkin_answers').select('question_id, value_number, value_text').eq('check_in_id', c.id),
  ])
  const weekLogs = logs.filter((l) => l.log_date <= addDays(ws, 6))
  const photoRows = must(photos) as { pose: PhotoPose; photo_url: string }[]
  const urls = await signedUrls(photoRows.map((p) => p.photo_url))
  const avgWeight = avgOf(weekLogs.map((l) => l.weight_kg))
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    id: c.id,
    week_start: ws,
    week: programWeek(me.start_date, ws),
    auto: {
      workouts_done: workoutsDone(sessions, !!me.program),
      workouts_planned: plannedTemplates(me.program).length,
      meals_on_plan: meals.filter((m) => m.on_plan === 'yes').length,
      meals_planned: meals.length,
      steps_avg: avgOf(weekLogs.map((l) => l.steps)) != null ? Math.round(avgOf(weekLogs.map((l) => l.steps)) as number) : null,
      avg_weight_kg: avgWeight,
    },
    weight_kg: n(c.avg_weight_kg) ?? avgWeight,
    waist_cm: n(c.waist_cm),
    hips_cm: n(c.hips_cm),
    energy: c.energy,
    sleep: c.sleep,
    stress: c.stress,
    hunger: c.hunger,
    photos: Object.fromEntries(photoRows.map((p) => [p.pose, p.photo_url])),
    photo_previews: Object.fromEntries(photoRows.map((p) => [p.pose, urls[p.photo_url]])),
    wins: c.wins ?? '',
    struggles: c.struggles ?? '',
    question: c.question ?? '',
    questions: must(questions),
    answers: Object.fromEntries((must(answers) as any[]).map((a) => [a.question_id, { value_number: n(a.value_number), value_text: a.value_text }])),
    status: c.status,
  }
}

/** Saves what's typed so far to the open check-in row (one table, so straight to Supabase). */
async function saveCheckin(patch: Partial<CheckinDraft>) {
  if (!patch.id || patch.status !== 'due') return patch
  const row: Record<string, unknown> = {}
  const map: [keyof CheckinDraft, string][] = [
    ['weight_kg', 'avg_weight_kg'], ['waist_cm', 'waist_cm'], ['hips_cm', 'hips_cm'], ['energy', 'energy'],
    ['sleep', 'sleep'], ['stress', 'stress'], ['hunger', 'hunger'], ['wins', 'wins'], ['struggles', 'struggles'],
    ['question', 'question'],
  ]
  for (const [from, to] of map) if (from in patch) row[to] = patch[from] === '' ? null : patch[from]
  must(await db().from('check_ins').update(row).eq('id', patch.id))
  return patch
}

async function submitCheckin(draft: CheckinDraft): Promise<CheckinDraft> {
  if (!draft.id) throw new ApiError(404, "There's no open check-in this week.")
  const photos: { pose: PhotoPose; path: string }[] = []
  for (const [pose, ref] of Object.entries(draft.photos) as [PhotoPose, string | undefined][]) {
    if (!ref) continue
    photos.push({ pose, path: ref.startsWith('blob:') ? await uploadPhoto('progress', ref) : ref })
  }
  const answers = Object.entries(draft.answers ?? {})
    .filter(([, a]) => a.value_number != null || (a.value_text ?? '').trim() !== '')
    .map(([question_id, a]) => ({ question_id, value_number: a.value_number ?? null, value_text: a.value_text?.trim() || null }))
  const res = await backend<{ id: string; status: 'submitted'; submitted_at: string | null }>(`/checkins/${draft.id}/submit`, {
    avg_weight_kg: draft.weight_kg, waist_cm: draft.waist_cm, hips_cm: draft.hips_cm,
    energy: draft.energy, sleep: draft.sleep, stress: draft.stress, hunger: draft.hunger,
    wins: draft.wins, struggles: draft.struggles, question: draft.question,
    answers, photos,
  })
  return { ...draft, status: res.status, photos: Object.fromEntries(photos.map((p) => [p.pose, p.path])) }
}

// ---------- Progress ----------

async function progress(): Promise<ClientProgress> {
  const me = await loadMe()
  const t = today()
  const week = programWeek(me.start_date, t)
  const ws = weekStart(t)
  const [logs, summaries, waists, meals, sessions, note, best] = await Promise.all([
    dailyLogs(me.id, me.start_date),
    db().from('weekly_summaries').select('week_start, training_pct, nutrition_pct').eq('client_id', me.id),
    db().from('check_ins').select('week_start, waist_cm').eq('client_id', me.id).not('waist_cm', 'is', null).order('week_start'),
    mealsBetween(me.id, ws, addDays(ws, 7)),
    sessionsBetween(me.id, ws, addDays(ws, 6)),
    lastCoachMessage(me.id, me.coach),
    bests(me.id),
  ])
  const mean = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : (a + b) / 2)
  const byWeek = Object.fromEntries((must(summaries) as any[]).map((s) => [s.week_start, mean(s.training_pct == null ? null : Number(s.training_pct), s.nutrition_pct == null ? null : Number(s.nutrition_pct))]))
  const planned = plannedTemplates(me.program).length
  const liveTraining = planned ? Math.min(100, (workoutsDone(sessions, true) / planned) * 100) : null
  const liveFood = meals.length ? (meals.filter((m) => m.on_plan === 'yes').length / meals.length) * 100 : null
  const plan = Array.from({ length: Math.min(week, 6) }, (_, i) => {
    const w = week - Math.min(week, 6) + 1 + i
    const current = w === week
    const pct = current ? mean(liveTraining, liveFood) : byWeek[weekMonday(me.start_date, w)] ?? null
    return { label: current ? 'So far' : `W${w}`, pct: pct == null ? null : Math.round(pct), partial: current }
  })
  const w = must(waists) as { waist_cm: number }[]
  const weights = logs.filter((l) => l.weight_kg != null)
  const current = weights.length ? (weights[weights.length - 1].weight_kg as number) : null
  return {
    start_date: me.start_date,
    week,
    weeks: me.program?.weeks ?? null,
    weight: {
      points: weightPoints(me.start_date, logs, week),
      current,
      change: current != null && me.start_weight_kg != null ? round1(current - me.start_weight_kg) : null,
      goal: me.goal_weight_kg,
    },
    plan,
    plan_target: 80,
    waist: w.length ? { cm: Number(w[w.length - 1].waist_cm), change: round1(Number(w[w.length - 1].waist_cm) - Number(w[0].waist_cm)) } : null,
    lift: best[0] ?? null,
    coach_note: note,
  }
}

export const liveClient = {
  home, trainWeek, muscle, foodDay: (date: string) => foodDay(date), rateDay, logMeal, logDaily,
  checkinDraft, saveCheckin, submitCheckin, progress, setBodyModel,
  exerciseLibrary, startWorkout, workoutLog, lastTime, saveSet, deleteSet, saveWorkoutNote, finishWorkout, discardWorkout,
}
