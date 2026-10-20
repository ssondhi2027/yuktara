// Guest mode's data layer: the client app's API on the guest's own data
// (lib/guestStore.ts), never Supabase or the backend. What needs a coach or a
// server (messages, check-ins, coach targets and meal plans, programs) isn't
// here: lib/api.ts refuses those for guests and the screens show "Create an
// account to work with a coach" instead. Uses the same pure helpers as the live
// and demo data, so the numbers are worked out the same way.

import type { BodyModel, MuscleGroup, OnPlan } from '@/types/db'
import { MUSCLE_GROUPS } from '@/types/db'
import type {
  ClientHome, ClientProgress, DailyPatch, DaySummary, FoodDay, GuestApi, LastTime, LibraryExercise, Meal, MuscleDetail, MyProfile,
  ProfilePatch, SetWrite, TrainWeek, WeekPoint, WorkoutLog, WorkoutSummary,
} from './api'
import { ApiError } from './backend'
import { addDays, today, weekStart } from './dates'
import { demo } from './demo'
import { SHARED_FOODS } from './foodList'
import { GUEST_ID, guestStore, type GuestMeal, type GuestSession } from './guestStore'
import { compressImage } from './image'
import { mealsFor, type Food } from './meals'
import { progressFrom, type Period, type ProgressRaw } from './progress'
import { avg, person, programWeek, round1, weekMonday } from './live/shared'
import { inSetOrder, minutesSince, OWN_WORKOUT, summarize, type SummarySet } from './workouts'

const S = () => guestStore.state
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`)

// ---------- Photos: Blobs on the device, shown through object URLs ----------
const photoUrls = new Map<string, string>()
function photoUrl(id: string | null): string | null {
  if (!id) return null
  const blob = S().photos[id]
  if (!blob) return null
  if (!photoUrls.has(id)) photoUrls.set(id, URL.createObjectURL(blob))
  return photoUrls.get(id)!
}
/** Keeps a picked photo (a blob: URL) on the device, shrunk like uploads are. Returns its key. */
async function keepPhoto(localUrl: string): Promise<string> {
  const blob = await (await fetch(localUrl)).blob()
  let stored: Blob = blob
  try {
    stored = await compressImage(new File([blob], 'photo', { type: blob.type || 'image/jpeg' }))
  } catch {
    /* keep the original if it can't be shrunk here */
  }
  const id = uid()
  guestStore.update((s) => { s.photos[id] = stored })
  return id
}
/** Forget object URLs (signing out). */
export function releaseGuestPhotos() {
  for (const u of photoUrls.values()) URL.revokeObjectURL(u)
  photoUrls.clear()
}

// ---------- Helpers ----------
const library = (): LibraryExercise[] => demo.exerciseLibrary() // the standard exercise list, as in demo mode
const byId = () => new Map(library().map((e) => [e.id, e]))
const me = () => person(GUEST_ID, S().profile.full_name)
const dayLog = (d: string) => S().days[d]
const mealsOn = (d: string) => S().meals.filter((m) => m.date === d).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
const toMeal = (m: GuestMeal): Meal => ({
  id: m.id, meal_type: m.meal_type, eaten_at: m.eaten_at, title: m.title, calories: m.calories, protein_g: m.protein_g,
  carbs_g: m.carbs_g, fat_g: m.fat_g, on_plan: m.on_plan, photo_url: photoUrl(m.photo), items: m.items,
})
const session = (id: string) => {
  const s = S().sessions.find((x) => x.id === id)
  if (!s) throw new ApiError(404, "That workout doesn't exist.")
  return s
}
const openSession = () => S().sessions.find((s) => !s.finished_at) ?? null
const finished = () => S().sessions.filter((s) => s.finished_at).sort((a, b) => b.performed_on.localeCompare(a.performed_on) || (b.started_at ?? '').localeCompare(a.started_at ?? ''))
const isHard = (x: SetWrite) => !x.is_warmup && x.drop_of == null
const avgOf = (xs: (number | null)[]) => avg(xs.filter((x): x is number => x != null))

function summaryOf(s: GuestSession): WorkoutSummary {
  const lib = byId()
  const sets: SummarySet[] = s.sets.filter((x) => !x.is_warmup).map((x) => ({
    ...x, name: lib.get(x.exercise_id)?.name ?? 'Exercise', primary: lib.get(x.exercise_id)?.primary ?? [],
  }))
  return summarize({ id: s.id, name: OWN_WORKOUT, performed_on: s.performed_on, finished: !!s.finished_at, duration_min: s.duration_min, notes: s.notes || null, effort: s.effort }, sets)
}

/** Hard sets per muscle (primary muscles) in the week starting `ws`: a set and its drops once, warm-ups never. */
function weekSets(ws: string): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>
  const lib = byId()
  for (const s of S().sessions) {
    if (s.performed_on < ws || s.performed_on > addDays(ws, 6)) continue
    for (const x of s.sets) if (isHard(x)) for (const m of lib.get(x.exercise_id)?.primary ?? []) out[m] += 1
  }
  return out
}

function weightPoints(start: string, upTo: number, maxPoints = 12): WeekPoint[] {
  const first = Math.max(1, upTo - maxPoints + 1)
  return Array.from({ length: upTo - first + 1 }, (_, i) => {
    const w = first + i
    const mon = weekMonday(start, w)
    const kgs = Object.entries(S().days).filter(([d, l]) => l.weight_kg != null && d >= mon && d <= addDays(mon, 6)).map(([, l]) => l.weight_kg!)
    const a = avg(kgs)
    return { label: `W${w}`, kg: a == null ? null : round1(a) }
  })
}

function bests(): ClientHome['bests'] {
  const lib = byId()
  const by: Record<string, { name: string; first: { date: string; kg: number }; best: { kg: number; reps: number } }> = {}
  for (const s of S().sessions) {
    for (const x of s.sets) {
      if (!isHard(x) || x.weight_kg == null) continue
      const e = (by[x.exercise_id] ??= { name: lib.get(x.exercise_id)?.name ?? 'Exercise', first: { date: s.performed_on, kg: x.weight_kg }, best: { kg: x.weight_kg, reps: x.reps ?? 0 } })
      if (s.performed_on < e.first.date) e.first = { date: s.performed_on, kg: x.weight_kg }
      if (x.weight_kg > e.best.kg) e.best = { kg: x.weight_kg, reps: x.reps ?? 0 }
    }
  }
  return Object.values(by).map((e) => ({ exercise: e.name, reps: e.best.reps, kg: e.best.kg, change: round1(e.best.kg - e.first.kg) }))
    .sort((a, b) => b.change - a.change || b.kg - a.kg).slice(0, 3)
}

const weightNow = () => {
  const w = Object.entries(S().days).filter(([, l]) => l.weight_kg != null).sort(([a], [b]) => a.localeCompare(b))
  return { current: w.length ? w[w.length - 1][1].weight_kg! : null, first: w.length ? w[0][1].weight_kg! : null }
}

// ---------- The API ----------

export const guestApi: GuestApi = {
  // ----- Home -----
  clientHome(): ClientHome {
    const t = today()
    const ws = weekStart(t)
    const p = S().profile
    const planned = mealsFor(p.meals_per_day)
    const week = programWeek(p.start_date, t)
    const days: DaySummary[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(ws, i)
      const ms = mealsOn(date)
      const l = dayLog(date)
      const done = S().sessions.find((s) => s.performed_on === date && s.finished_at)
      const open = S().sessions.find((s) => s.performed_on === date && !s.finished_at)
      return {
        date, is_today: date === t,
        logged: ms.length > 0 || !!done || !!open || !!(l && (l.steps ?? l.water_ml ?? l.sleep_hours ?? l.weight_kg ?? l.day_rating) != null),
        workout: done ? { name: OWN_WORKOUT, status: 'done' } : open ? { name: OWN_WORKOUT, status: 'partial' } : null,
        meals_on_plan: ms.filter((m) => m.on_plan === 'yes').length,
        meals_planned: Math.max(planned.length, ms.length),
        steps: l?.steps ?? null,
      }
    })
    const weekMeals = S().meals.filter((m) => m.date >= ws && m.date <= addDays(ws, 6))
    const proteinByDay = Object.values(weekMeals.reduce<Record<string, number>>((a, m) => ({ ...a, [m.date]: (a[m.date] ?? 0) + m.protein_g }), {}))
    const recent = Object.entries(S().days).filter(([d]) => d > addDays(t, -7) && d <= t).map(([, l]) => l)
    const todayLog = dayLog(t)
    const { current } = weightNow()
    const start = p.start_weight_kg ?? weightNow().first
    return {
      today: t,
      me: { ...me(), body_model: p.body_model },
      coach: null,
      program: { week, weeks: null, start_date: p.start_date, has_program: false, next: null },
      days,
      week: {
        workouts_done: S().sessions.filter((s) => s.finished_at && s.performed_on >= ws && s.performed_on <= addDays(ws, 6)).length,
        workouts_planned: 0,
        meals_on_plan: weekMeals.filter((m) => m.on_plan === 'yes').length,
        meals_planned: planned.length * 7,
        avg_protein_g: proteinByDay.length ? Math.round(avg(proteinByDay)!) : null,
      },
      check_in: { status: 'none', minutes: 0, next_date: null },
      workout: null,
      food: guestApi.foodDay!(t) as FoodDay,
      habits: {
        steps_today: todayLog?.steps ?? null, water_ml_today: todayLog?.water_ml ?? null, sleep_last_night: todayLog?.sleep_hours ?? null,
        weight_today: todayLog?.weight_kg ?? null,
        steps_avg: avgOf(recent.map((l) => l.steps)), water_ml_avg: avgOf(recent.map((l) => l.water_ml)), sleep_avg: avgOf(recent.map((l) => l.sleep_hours)),
        note: null,
      },
      weight: { points: weightPoints(p.start_date, week), current, change: current != null && start != null ? round1(current - start) : null, goal: p.goal_weight_kg, start_date: p.start_date },
      coach_note: null,
      bests: bests(),
    }
  },

  // ----- Train -----
  trainWeek(): TrainWeek {
    const t = today()
    const open = openSession()
    const p = S().profile
    return {
      today: t, week: programWeek(p.start_date, t), weeks: null, body_model: p.body_model, sets: weekSets(weekStart(t)),
      has_program: false, next_program: null, units: p.units, plan: [],
      open_workout: open ? { id: open.id, name: OWN_WORKOUT, performed_on: open.performed_on, started_at: open.started_at, sets_done: open.sets.filter(isHard).length } : null,
      recent: finished().slice(0, 5).map(summaryOf),
    }
  },

  muscle(m: MuscleGroup): MuscleDetail {
    const ws = weekStart(today())
    const perExercise: Record<string, number> = {}
    for (const s of S().sessions) {
      if (s.performed_on < ws || s.performed_on > addDays(ws, 6)) continue
      for (const x of s.sets) if (isHard(x)) perExercise[x.exercise_id] = (perExercise[x.exercise_id] ?? 0) + 1
    }
    const exercises = library().filter((e) => e.primary.includes(m) || e.secondary.includes(m)).map((e) => ({
      name: e.name, role: e.primary.includes(m) ? 'primary' as const : 'secondary' as const, sets_this_week: perExercise[e.id] ?? 0,
      cue: e.cue ?? undefined, level: e.level, equipment: e.equipment,
    })).sort((a, b) => b.sets_this_week - a.sets_this_week || Number(a.role === 'secondary') - Number(b.role === 'secondary'))
    return { muscle: m, hard_sets: weekSets(ws)[m], exercises }
  },

  exerciseLibrary: () => library(),

  startWorkout(templateId: string | null) {
    if (templateId) throw new ApiError(403, 'Programs come from a coach. Create an account to work with one.')
    const open = openSession()
    if (open) return { id: open.id }
    const id = uid()
    guestStore.update((s) => { s.sessions.push({ id, performed_on: today(), started_at: new Date().toISOString(), finished_at: null, duration_min: null, notes: '', effort: null, sets: [] }) })
    return { id }
  },

  workoutLog(id: string): WorkoutLog {
    const s = session(id)
    return {
      id: s.id, name: OWN_WORKOUT, template_id: null, performed_on: s.performed_on, started_at: s.started_at, finished_at: s.finished_at,
      duration_min: s.duration_min, notes: s.notes, effort: s.effort, units: S().profile.units, coach_notes: null, plan: [], sets: s.sets.map((x) => ({ ...x })),
    }
  },

  lastTime(sessionId: string, exerciseIds: string[]): Record<string, LastTime> {
    const out: Record<string, LastTime> = {}
    const before = S().sessions.filter((s) => s.id !== sessionId)
      .sort((a, b) => b.performed_on.localeCompare(a.performed_on) || (b.started_at ?? '').localeCompare(a.started_at ?? ''))
    for (const id of exerciseIds) {
      const s = before.find((x) => x.sets.some((l) => l.exercise_id === id && !l.is_warmup))
      if (s) out[id] = { date: s.performed_on, sets: inSetOrder(s.sets.filter((l) => l.exercise_id === id && !l.is_warmup).map(({ set_number, weight_kg, reps, rpe, drop_of }) => ({ set_number, weight_kg, reps, rpe, drop_of: drop_of ?? null }))) }
    }
    return out
  },

  saveSet(sessionId: string, set: SetWrite) {
    const s = session(sessionId)
    if (set.set_number < 1 || set.set_number > 50) throw new ApiError(422, 'Too many sets for one exercise.')
    if (set.drop_of != null) {
      const head = s.sets.find((x) => x.exercise_id === set.exercise_id && x.set_number === set.drop_of)
      if (!head || head.is_warmup || head.drop_of != null) throw new ApiError(422, 'A drop follows a working set of the same exercise. Tick that set first.')
    }
    if (set.is_warmup && s.sets.some((x) => x.exercise_id === set.exercise_id && x.drop_of === set.set_number)) throw new ApiError(422, 'This set has drops. Remove them first.')
    guestStore.update(() => {
      const i = s.sets.findIndex((x) => x.exercise_id === set.exercise_id && x.set_number === set.set_number)
      if (i >= 0) s.sets[i] = { ...set }
      else s.sets.push({ ...set })
    })
    return { ok: true }
  },

  deleteSet(sessionId: string, exerciseId: string, setNumber: number) {
    const s = session(sessionId)
    guestStore.update(() => {
      const gone = s.sets.find((x) => x.exercise_id === exerciseId && x.set_number === setNumber)
      // A working set's drops go with it.
      s.sets = s.sets.filter((x) => x !== gone && !(gone && gone.drop_of == null && x.exercise_id === exerciseId && x.drop_of === setNumber))
    })
    return { ok: true }
  },

  saveWorkoutNote(id: string, notes: string) {
    const s = session(id)
    guestStore.update(() => { s.notes = notes.trim().slice(0, 2000) })
    return { ok: true }
  },

  finishWorkout(id: string, effort: number | null): WorkoutSummary {
    const s = session(id)
    if (!s.finished_at) {
      if (!s.sets.length) throw new ApiError(409, 'Tick at least one set first, or discard the workout.')
      guestStore.update(() => {
        s.finished_at = new Date().toISOString()
        s.duration_min = minutesSince(s.started_at)
        s.effort = effort != null && Number.isInteger(effort) && effort >= 1 && effort <= 10 ? effort : null
      })
    }
    return summaryOf(s)
  },

  discardWorkout(id: string) {
    guestStore.update((st) => { st.sessions = st.sessions.filter((x) => !(x.id === id && !x.finished_at)) })
    return { ok: true }
  },

  // ----- Food -----
  foods: (): Food[] => SHARED_FOODS.map((f) => ({
    id: `food-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`, name: f.name, basis: f.basis, kcal: f.kcal,
    protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, servings: f.servings.map(([name, amount]) => ({ name, amount })),
  })),

  foodDay(date: string): FoodDay {
    return {
      date, targets: null, targets_from: null, next_targets: null, plan: null,
      meals: mealsOn(date).map(toMeal), planned: mealsFor(S().profile.meals_per_day), day_rating: dayLog(date)?.day_rating ?? null,
    }
  },

  rateDay(date: string, rating: OnPlan) {
    guestStore.update((s) => { s.days[date] = { ...(s.days[date] ?? { steps: null, water_ml: null, sleep_hours: null, weight_kg: null }), day_rating: rating } })
    return { ok: true }
  },

  async logMeal(date: string, m: Omit<Meal, 'id'>): Promise<Meal> {
    const photo = m.photo_url?.startsWith('blob:') ? await keepPhoto(m.photo_url) : null
    const saved: GuestMeal = {
      id: uid(), date, meal_type: m.meal_type, eaten_at: m.eaten_at, title: m.title.trim() || 'Meal', calories: Math.round(m.calories),
      protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, on_plan: m.on_plan, photo, items: m.items?.map((x) => ({ ...x })),
    }
    guestStore.update((s) => { s.meals.push(saved) })
    return toMeal(saved)
  },

  logDaily(date: string, patch: DailyPatch) {
    guestStore.update((s) => {
      const cur = s.days[date] ?? { steps: null, water_ml: null, sleep_hours: null, weight_kg: null, day_rating: null }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cur as unknown as Record<string, unknown>)[k] = v
      s.days[date] = cur
    })
    return { ok: true }
  },

  // ----- Progress -----
  progress(): ClientProgress {
    const t = today()
    const p = S().profile
    const week = programWeek(p.start_date, t)
    // No coach plan: each week's share of meals rated "on plan".
    const plan = Array.from({ length: Math.min(week, 6) }, (_, i) => {
      const w = week - Math.min(week, 6) + 1 + i
      const mon = weekMonday(p.start_date, w)
      const ms = S().meals.filter((m) => m.date >= mon && m.date <= addDays(mon, 6))
      const pct = ms.length ? Math.round((ms.filter((m) => m.on_plan === 'yes').length / ms.length) * 100) : null
      return { label: w === week ? 'So far' : `W${w}`, pct, partial: w === week }
    })
    const { current, first } = weightNow()
    const start = p.start_weight_kg ?? first
    const best = bests()[0]
    return {
      start_date: p.start_date, week, weeks: null,
      weight: { points: weightPoints(p.start_date, week), current, change: current != null && start != null ? round1(current - start) : null, goal: p.goal_weight_kg },
      plan, plan_target: 80, waist: null,
      lift: best ? { exercise: best.exercise, reps: best.reps, kg: best.kg, change: best.change } : null,
      coach_note: null,
    }
  },

  progressDetail(period: Period) {
    const lib = byId()
    const p = S().profile
    const raw: ProgressRaw = {
      today: today(), start_date: p.start_date, goal_weight_kg: p.goal_weight_kg,
      days: Object.entries(S().days).map(([date, l]) => ({ date, weight_kg: l.weight_kg, steps: l.steps, water_ml: l.water_ml, sleep_h: l.sleep_hours })),
      meals: S().meals.map((m) => ({ date: m.date, calories: m.calories, protein_g: m.protein_g, on_plan: m.on_plan })),
      targets: [], programs: [], check_ins: [],
      sessions: finished().map((s) => ({
        date: s.performed_on, template_id: null,
        sets: s.sets.filter((x) => !x.is_warmup).map((x) => ({
          exercise_id: x.exercise_id, name: lib.get(x.exercise_id)?.name ?? 'Exercise', kg: x.weight_kg, reps: x.reps, rpe: x.rpe,
          drop: x.drop_of != null, primary: lib.get(x.exercise_id)?.primary ?? [],
        })),
      })),
    }
    return progressFrom(raw, period)
  },

  setBodyModel(m: BodyModel) {
    guestStore.update((s) => { s.profile.body_model = m })
    return { body_model: m }
  },

  // ----- Profile -----
  myProfile(): MyProfile {
    const p = S().profile
    return {
      full_name: p.full_name, email: '', units: p.units, height_cm: p.height_cm, goal_weight_kg: p.goal_weight_kg, start_weight_kg: p.start_weight_kg,
      goal: p.goal, experience: p.experience, diet: p.diet, foods_to_avoid: p.foods_to_avoid, meals_per_day: p.meals_per_day,
      training_days: p.training_days, train_location: p.train_location, injuries: p.injuries, phone: p.phone,
      coach: null, check_in_day: 0, start_date: p.start_date, targets: null, program: null,
    }
  },

  saveMyProfile(x: ProfilePatch) {
    guestStore.update((s) => {
      Object.assign(s.profile, {
        full_name: x.full_name.trim() || 'Guest', height_cm: x.height_cm, goal_weight_kg: x.goal_weight_kg, diet: x.diet,
        foods_to_avoid: x.foods_to_avoid?.trim() || null, meals_per_day: x.meals_per_day, training_days: x.training_days,
        train_location: x.train_location, injuries: x.injuries?.trim() || null, phone: x.phone?.trim() || null,
      })
    })
    return { ok: true }
  },

  avatars: (): Record<string, string> => {
    const u = photoUrl(S().avatar)
    return u ? { [GUEST_ID]: u } : {}
  },

  async setAvatar(localUrl: string) {
    const id = await keepPhoto(localUrl)
    guestStore.update((s) => {
      if (s.avatar) delete s.photos[s.avatar]
      s.avatar = id
    })
    return { ok: true }
  },

  removeAvatar() {
    guestStore.update((s) => {
      if (s.avatar) delete s.photos[s.avatar]
      s.avatar = null
    })
    return { ok: true }
  },

  // ----- Coach-only parts: neutral values where the shell asks -----
  unreadMessages: () => 0,
  checkinDraft: () => null,
}

