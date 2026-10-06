// Live data for the coach app: every query runs as the signed-in coach, so
// RLS limits it to their own clients (client_profiles.coach_id = me).
//
// Clients are listed straight from client_profiles, so a new sign-up shows up
// before any summary exists. This week's numbers are worked out from the raw
// logs (always current); weekly_summaries is used for past weeks only.

import type { CheckinStatus, GoalType, PhotoPose, WeekStatus } from '@/types/db'
import type {
  AttentionItem, CheckinLists, CheckinReview, ClientDetail, ClientRow, ClientWeekStatus, CoachDashboard, Person,
  QueueItem, SwapRequest, Targets, WeekPoint,
} from '../api'
import { ApiError, backend } from '../backend'
import { addDays, clockTime, monthDay, today, weekday, weekStart } from '../dates'
import {
  WEEKDAYS, avg, dayBounds, db, localDate, must, myId, nextCheckInDate, person, programWeek, round1, signedUrls,
  targetsOn, weekMonday,
} from './shared'

const PROFILE_COLS =
  'user_id, status, goal, start_date, start_weight_kg, goal_weight_kg, check_in_day, setup_completed_at,' +
  ' date_of_birth, height_cm, experience, training_days, train_location, injuries, diet, foods_to_avoid, meals_per_day'

interface Client {
  id: string
  person: Person
  email: string
  profile: any
  program: { weeks: number; start_date: string; planned: number } | null
}

interface CheckIn {
  id: string; client_id: string; week_start: string; status: CheckinStatus; submitted_at: string | null
  reviewed_at: string | null; sleep: number | null; question: string | null; avg_weight_kg: number | null
}

async function loadClients(): Promise<{ uid: string; coach: Person; invite_code: string | null; clients: Client[] }> {
  const uid = await myId()
  const [me, profiles] = await Promise.all([
    db().from('users').select('id, full_name, invite_code').eq('id', uid).single(),
    db().from('client_profiles').select(PROFILE_COLS).eq('coach_id', uid),
  ])
  const coachRow = must(me)
  const profs = must(profiles) as any[]
  const ids = profs.map((p) => p.user_id)
  const coach = person(coachRow.id, coachRow.full_name)
  if (!ids.length) return { uid, coach, invite_code: coachRow.invite_code, clients: [] }
  const [users, programs] = await Promise.all([
    db().from('users').select('id, full_name, email').in('id', ids),
    db().from('programs').select('client_id, weeks, start_date, workout_templates(id, day_of_week)')
      .in('client_id', ids).lte('start_date', today()).order('start_date', { ascending: false }),
  ])
  const userById = Object.fromEntries((must(users) as any[]).map((u) => [u.id, u]))
  const progs = must(programs) as any[]
  return {
    uid,
    coach,
    invite_code: coachRow.invite_code,
    clients: profs.map((p) => {
      const prog = progs.find((x) => x.client_id === p.user_id)
      return {
        id: p.user_id,
        person: person(p.user_id, userById[p.user_id]?.full_name),
        email: userById[p.user_id]?.email ?? '',
        profile: p,
        program: prog ? {
          weeks: prog.weeks, start_date: prog.start_date,
          planned: (prog.workout_templates ?? []).filter((t: any) => t.day_of_week != null).length,
        } : null,
      }
    }).sort((a, b) => a.person.full_name.localeCompare(b.person.full_name)),
  }
}

interface Activity {
  logs: { client_id: string; log_date: string; weight_kg: number | null; steps: number | null }[]
  meals: { client_id: string; eaten_at: string; on_plan: string | null }[]
  sessions: { client_id: string; performed_on: string; status: string }[]
  checkIns: CheckIn[]
  withTargets: Set<string>
  summaries: { client_id: string; week_start: string; training_pct: number | null; nutrition_pct: number | null; status: WeekStatus }[]
}

async function loadActivity(ids: string[]): Promise<Activity> {
  if (!ids.length) return { logs: [], meals: [], sessions: [], checkIns: [], withTargets: new Set(), summaries: [] }
  const t = today()
  const ws = weekStart(t)
  const [logs, meals, checkIns, targets, summaries] = await Promise.all([
    db().from('daily_logs').select('client_id, log_date, weight_kg, steps').in('client_id', ids).gte('log_date', addDays(ws, -42)),
    db().from('meal_logs').select('client_id, eaten_at, on_plan').in('client_id', ids).gte('eaten_at', dayBounds(ws)[0]),
    db().from('check_ins')
      .select('id, client_id, week_start, status, submitted_at, reviewed_at, sleep, question, avg_weight_kg')
      .in('client_id', ids).order('week_start', { ascending: false }).limit(500),
    db().from('nutrition_targets').select('client_id').in('client_id', ids),
    db().from('weekly_summaries').select('client_id, week_start, training_pct, nutrition_pct, status')
      .in('client_id', ids).gte('week_start', addDays(ws, -84)),
  ])
  const cis = (must(checkIns) as any[]).map((c) => ({ ...c, avg_weight_kg: c.avg_weight_kg == null ? null : Number(c.avg_weight_kg) }))
  const queueWeeks = cis.filter((c) => c.status === 'submitted').map((c) => c.week_start)
  const from = [ws, ...queueWeeks].sort()[0]
  const sessions = must(await db().from('workout_sessions').select('client_id, performed_on, status').in('client_id', ids).gte('performed_on', from))
  return {
    logs: (must(logs) as any[]).map((l) => ({ ...l, weight_kg: l.weight_kg == null ? null : Number(l.weight_kg) })),
    meals: must(meals),
    sessions,
    checkIns: cis,
    withTargets: new Set((must(targets) as any[]).map((r) => r.client_id)),
    summaries: (must(summaries) as any[]).map((s) => ({
      ...s, training_pct: s.training_pct == null ? null : Number(s.training_pct), nutrition_pct: s.nutrition_pct == null ? null : Number(s.nutrition_pct),
    })),
  }
}

const mean = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : (a + b) / 2)

/** "Today 6:40 PM", "Sat 9:15 PM" (this week) or "Sep 28". */
function whenLabel(ts: string): string {
  const d = localDate(ts)
  const t = today()
  if (d === t) return `Today ${clockTime(ts)}`
  if (d > addDays(t, -7)) return `${weekday(d)} ${clockTime(ts)}`
  return monthDay(d)
}

function weekStats(c: Client, a: Activity) {
  const t = today()
  const ws = weekStart(t)
  const meals = a.meals.filter((m) => m.client_id === c.id)
  const logs = a.logs.filter((l) => l.client_id === c.id)
  const sessions = a.sessions.filter((s) => s.client_id === c.id && s.performed_on >= ws)
  const days = new Set([
    ...meals.map((m) => localDate(m.eaten_at)),
    ...logs.filter((l) => l.log_date >= ws && (l.weight_kg != null || l.steps != null)).map((l) => l.log_date),
  ])
  const done = sessions.filter((s) => s.status === 'done').length
  const planned = c.program?.planned ?? 0
  const foodPct = meals.length ? Math.round((meals.filter((m) => m.on_plan === 'yes').length / meals.length) * 100) : null
  const trainingPct = planned ? Math.min(100, Math.round((done / planned) * 100)) : null
  // Six weekly-average weights
  const trend: number[] = []
  for (let i = 5; i >= 0; i--) {
    const mon = addDays(ws, -7 * i)
    const w = avg(logs.filter((l) => l.weight_kg != null && l.log_date >= mon && l.log_date <= addDays(mon, 6)).map((l) => l.weight_kg as number))
    if (w != null) trend.push(round1(w))
  }
  return { days: days.size, done, planned, foodPct, trainingPct, trend }
}

function rowFor(c: Client, a: Activity): ClientRow {
  const t = today()
  const p = c.profile
  const s = weekStats(c, a)
  const setupDone = !!p.setup_completed_at
  const latest = a.checkIns.find((x) => x.client_id === c.id)
  let status: ClientWeekStatus = 'on_track'
  if (!setupDone) status = 'awaiting'
  else if (latest?.status === 'missed') status = 'overdue'
  else if (latest?.status === 'due') status = 'awaiting'
  else if (s.foodPct != null && s.foodPct < 70) status = 'slipping'

  let last: string
  if (latest && (latest.status === 'submitted' || latest.status === 'reviewed') && latest.submitted_at) {
    last = whenLabel(latest.submitted_at) + (latest.status === 'reviewed' ? ' · reviewed' : '')
  } else if (latest?.status === 'missed') last = `Missed week of ${monthDay(latest.week_start)}`
  else if (latest?.status === 'due') last = 'Due now'
  else if (!setupDone) last = 'Setting up'
  else last = `First check-in ${monthDay(nextCheckInDate(p.start_date, p.check_in_day, t))}`

  const week = programWeek(p.start_date, t)
  return {
    client: c.person,
    goal: p.goal,
    week,
    weeks: c.program?.weeks ?? null,
    days_logged: s.days,
    workouts_done: s.done,
    workouts_planned: s.planned,
    food_pct: s.foodPct,
    weight_trend: s.trend,
    weight_change: s.trend.length >= 2 ? round1(s.trend[s.trend.length - 1] - s.trend[0]) : null,
    last_check_in: last,
    status,
    is_new: week === 1,
    setup_done: setupDone,
    has_targets: a.withTargets.has(c.id),
  }
}

function queueFor(clients: Client[], a: Activity): QueueItem[] {
  const byId = Object.fromEntries(clients.map((c) => [c.id, c]))
  const items = a.checkIns.filter((c) => c.status === 'submitted' && byId[c.client_id]).map((ci) => {
    const client = byId[ci.client_id]
    const prev = a.checkIns.find((x) => x.client_id === ci.client_id && x.week_start < ci.week_start && x.avg_weight_kg != null)
    const sum = a.summaries.find((x) => x.client_id === ci.client_id && x.week_start === ci.week_start)
    const weekSessions = a.sessions.filter((s) => s.client_id === ci.client_id && s.performed_on >= ci.week_start && s.performed_on <= addDays(ci.week_start, 6))
    const missed = (client.program?.planned ?? 0) - weekSessions.filter((s) => s.status === 'done').length
    const flags: string[] = []
    if (client.program && missed >= 2) flags.push(`${missed} sessions missed`)
    if (ci.sleep != null && ci.sleep <= 2) flags.push(`Sleep ${ci.sleep} of 5`)
    const plan = sum ? mean(sum.training_pct, sum.nutrition_pct) : null
    return {
      check_in_id: ci.id,
      client: client.person,
      submitted_at: ci.submitted_at ?? '',
      submitted_label: ci.submitted_at ? whenLabel(ci.submitted_at) : '',
      plan_pct: plan == null ? null : Math.round(plan),
      weight_change: ci.avg_weight_kg != null && prev?.avg_weight_kg != null ? round1(ci.avg_weight_kg - prev.avg_weight_kg) : null,
      flags,
      has_question: !!ci.question?.trim(),
      status: ci.status,
    }
  })
  const rank = (q: QueueItem) => (q.flags.length ? 0 : q.has_question ? 1 : 2)
  return items.sort((x, y) => rank(x) - rank(y) || x.submitted_at.localeCompare(y.submitted_at))
}

function attentionFor(rows: ClientRow[], a: Activity): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const r of rows) {
    const name = r.client.first_name
    if (!r.setup_done) out.push({ client: r.client, status: 'awaiting', text: "Signed up but hasn't finished profile setup yet.", action: 'Open' })
    else if (!r.has_targets) out.push({ client: r.client, status: 'awaiting', text: `No targets yet. Set calories and macros so ${name} can track against them.`, action: 'Set targets' })
    else if (r.status === 'overdue') out.push({ client: r.client, status: 'overdue', text: 'Missed their last check-in.', action: 'Open' })
    else if (r.status === 'slipping') out.push({ client: r.client, status: 'slipping', text: `Food on plan is ${r.food_pct}% this week.`, action: 'Open' })
    else if (r.status === 'awaiting' && a.checkIns.some((c) => c.client_id === r.client.id && c.status === 'due')) {
      out.push({ client: r.client, status: 'awaiting', text: "This week's check-in is open and not sent yet.", action: 'Open' })
    }
  }
  return out.slice(0, 8)
}

// ---------- Screens ----------

async function dashboard(): Promise<CoachDashboard> {
  const { coach, invite_code, clients } = await loadClients()
  const a = await loadActivity(clients.map((c) => c.id))
  const t = today()
  const rows = clients.map((c) => rowFor(c, a))
  const queue = queueFor(clients, a)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const recent = a.checkIns.filter((c) => c.submitted_at && c.submitted_at >= weekAgo)
  const plans = clients.map((c) => { const s = weekStats(c, a); return mean(s.trainingPct, s.foodPct) }).filter((x): x is number => x != null)
  const attention = attentionFor(rows, a)
  return {
    today: t,
    coach,
    invite_code,
    stats: {
      active: clients.filter((c) => c.profile.status === 'active' && c.profile.setup_completed_at).length,
      new_this_month: clients.filter((c) => c.profile.start_date?.slice(0, 7) === t.slice(0, 7)).length,
      checked_in: recent.filter((c) => c.status === 'submitted' || c.status === 'reviewed').length,
      reviewed: a.checkIns.filter((c) => c.reviewed_at && c.reviewed_at >= weekAgo).length,
      waiting: queue.length,
      plan_pct: plans.length ? Math.round(avg(plans) as number) : null,
      plan_change: null,
      attention: attention.map((x) => x.client),
    },
    queue,
    attention,
    clients: rows,
    total_clients: rows.length,
  }
}

async function checkinLists(): Promise<CheckinLists> {
  const { clients } = await loadClients()
  const a = await loadActivity(clients.map((c) => c.id))
  const t = today()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const queue = queueFor(clients, a)
  const done = queueFor(clients, { ...a, checkIns: a.checkIns.filter((c) => c.status === 'reviewed' && c.reviewed_at && c.reviewed_at >= weekAgo).map((c) => ({ ...c, status: 'submitted' as const })) })
    .map((q) => ({ ...q, status: 'reviewed' as const }))
  const notIn = clients.filter((c) => c.profile.setup_completed_at && c.profile.status === 'active').flatMap((c) => {
    const latest = a.checkIns.find((x) => x.client_id === c.id)
    const row = rowFor(c, a)
    if (latest?.status === 'due' || latest?.status === 'missed' || !latest) return [{ client: c.person, due_label: row.last_check_in, status: row.status }]
    return []
  })
  return {
    today: t,
    week_start: weekStart(addDays(t, -6)),
    checked_in: a.checkIns.filter((c) => c.submitted_at && c.submitted_at >= weekAgo).length,
    total: clients.length,
    to_review: queue,
    not_in: notIn,
    done,
  }
}

function linearAt(points: WeekPoint[], at: number): number | null {
  const xy = points.map((p, i) => [i + 1, p.kg] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (xy.length < 2) return null
  const n = xy.length
  const sx = xy.reduce((s, p) => s + p[0], 0)
  const sy = xy.reduce((s, p) => s + p[1], 0)
  const sxy = xy.reduce((s, p) => s + p[0] * p[1], 0)
  const sxx = xy.reduce((s, p) => s + p[0] * p[0], 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1)
  return round1(sy / n + slope * (at - sx / n))
}

async function checkinReview(id: string): Promise<CheckinReview> {
  const cRes: any = must(await db().from('check_ins')
    .select('id, client_id, week_start, status, submitted_at, avg_weight_kg, waist_cm, energy, sleep, stress, hunger, wins, struggles, question')
    .eq('id', id).maybeSingle())
  if (!cRes) throw new ApiError(404, 'Check-in not found')
  const ci = cRes
  const clientId: string = ci.client_id
  const ws: string = ci.week_start
  const t = today()
  const [user, profile, programs, logs, meals, sessions, history, summaries, photos, draft, notes, answers, targets, queue] = await Promise.all([
    db().from('users').select('id, full_name').eq('id', clientId).single(),
    db().from('client_profiles').select(PROFILE_COLS).eq('user_id', clientId).single(),
    db().from('programs').select('weeks, start_date, workout_templates(id, day_of_week)').eq('client_id', clientId).lte('start_date', ws).order('start_date', { ascending: false }).limit(1),
    db().from('daily_logs').select('log_date, weight_kg').eq('client_id', clientId).not('weight_kg', 'is', null),
    db().from('meal_logs').select('on_plan').eq('client_id', clientId).gte('eaten_at', dayBounds(ws)[0]).lt('eaten_at', dayBounds(addDays(ws, 7))[0]),
    db().from('workout_sessions').select('status').eq('client_id', clientId).gte('performed_on', ws).lte('performed_on', addDays(ws, 6)),
    db().from('check_ins').select('week_start, avg_weight_kg, waist_cm').eq('client_id', clientId).lt('week_start', ws).order('week_start', { ascending: false }),
    db().from('weekly_summaries').select('week_start, training_pct, nutrition_pct, status').eq('client_id', clientId).order('week_start'),
    db().from('progress_photos').select('pose, photo_url').eq('check_in_id', id),
    db().from('review_drafts').select('body, updated_at').eq('check_in_id', id).maybeSingle(),
    db().rpc('get_coach_notes', { client: clientId }),
    db().from('checkin_answers').select('value_number, value_text, checkin_questions(prompt, answer_type)').eq('check_in_id', id),
    targetsOn(clientId, t),
    db().from('check_ins').select('id, submitted_at, sleep, question').eq('status', 'submitted').order('submitted_at'),
  ])
  const p: any = must(profile)
  const prog = (must(programs) as any[])[0]
  const planned = prog ? (prog.workout_templates ?? []).filter((x: any) => x.day_of_week != null).length : 0
  const weights = (must(logs) as any[]).map((l) => ({ date: l.log_date as string, kg: Number(l.weight_kg) }))
  const weeks: number | null = prog?.weeks ?? null
  const ciWeek = programWeek(p.start_date, ws)
  const span = Math.max(weeks ?? 0, ciWeek)
  const points: WeekPoint[] = Array.from({ length: span }, (_, i) => {
    const mon = weekMonday(p.start_date, i + 1)
    const a = avg(weights.filter((w) => w.date >= mon && w.date <= addDays(mon, 6)).map((w) => w.kg))
    return { label: `W${i + 1}`, kg: i + 1 <= ciWeek && a != null ? round1(a) : null }
  })
  const prev = (must(history) as any[])
  const prevWeight = prev.find((x) => x.avg_weight_kg != null)
  const prevWaist = prev.find((x) => x.waist_cm != null)
  const n = (x: unknown) => (x == null ? null : Number(x))
  const sums = must(summaries) as any[]
  const thisSum = sums.find((s) => s.week_start === ws)
  const mealRows = must(meals) as any[]
  const onPlan = mealRows.filter((m) => m.on_plan === 'yes').length
  const done = (must(sessions) as any[]).filter((s) => s.status === 'done').length
  const photoRows = must(photos) as { pose: PhotoPose; photo_url: string }[]
  const urls = await signedUrls(photoRows.map((x) => x.photo_url))
  const d = must(draft)
  const order = (must(queue) as any[])
  const idx = order.findIndex((q) => q.id === id)

  return {
    check_in_id: id,
    client: person(clientId, must(user).full_name),
    goal: p.goal as GoalType | null,
    week: ciWeek,
    weeks,
    start_date: p.start_date,
    check_in_weekday: `${WEEKDAYS[p.check_in_day]}s`,
    status: thisSum?.status ?? null,
    week_start: ws,
    submitted_at: ci.submitted_at ?? '',
    avg_weight_kg: n(ci.avg_weight_kg),
    weight_change: ci.avg_weight_kg != null && prevWeight ? round1(Number(ci.avg_weight_kg) - Number(prevWeight.avg_weight_kg)) : null,
    waist_cm: n(ci.waist_cm),
    waist_change: ci.waist_cm != null && prevWaist ? round1(Number(ci.waist_cm) - Number(prevWaist.waist_cm)) : null,
    workouts_done: done,
    workouts_planned: planned,
    skipped_note: planned > done ? `${planned - done} missed` : null,
    meals_pct: mealRows.length ? Math.round((onPlan / mealRows.length) * 100) : null,
    meals_on_plan: onPlan,
    meals_planned: mealRows.length,
    energy: ci.energy,
    sleep: ci.sleep,
    stress: ci.stress,
    hunger: ci.hunger,
    wins: ci.wins ?? '',
    struggles: ci.struggles ?? '',
    question: ci.question?.trim() || null,
    answers: (must(answers) as any[]).map((a) => ({
      prompt: a.checkin_questions?.prompt ?? 'Question',
      value: a.value_text ?? (a.checkin_questions?.answer_type === 'yes_no' ? (Number(a.value_number) ? 'Yes' : 'No') : String(a.value_number ?? '')),
    })),
    weights: points,
    goal_kg: n(p.goal_weight_kg),
    projection_kg: weeks ? linearAt(points.slice(0, ciWeek), weeks) : null,
    plan_by_week: sums.filter((s) => s.week_start <= ws).slice(-6).map((s) => ({
      label: `W${programWeek(p.start_date, s.week_start)}`,
      training: Math.round(Number(s.training_pct ?? 0)),
      food: Math.round(Number(s.nutrition_pct ?? 0)),
    })),
    photos: (['front', 'side', 'back'] as PhotoPose[]).map((pose) => {
      const ph = photoRows.find((x) => x.pose === pose)
      return { pose, url: ph ? urls[ph.photo_url] ?? null : null }
    }),
    draft: d?.body ?? '',
    draft_saved_at: d?.updated_at ?? null,
    targets: targets?.targets ?? null,
    suggestion: null,
    private_notes: (must(notes) as string | null) ?? '',
    queue_position: idx >= 0 ? idx + 1 : 0,
    queue_total: order.length,
    prev_id: idx > 0 ? order[idx - 1].id : null,
    next_id: idx >= 0 && idx < order.length - 1 ? order[idx + 1].id : null,
  }
}

// ---------- Writes ----------

async function saveReviewDraft(id: string, patch: { draft?: string; private_notes?: string }) {
  const uid = await myId()
  let saved: string | null = null
  if (patch.draft !== undefined) {
    saved = new Date().toISOString()
    must(await db().from('review_drafts').upsert(
      { check_in_id: id, coach_id: uid, body: patch.draft, updated_at: saved },
      { onConflict: 'check_in_id' },
    ))
  }
  if (patch.private_notes !== undefined) {
    const ci: { client_id: string } = must(await db().from('check_ins').select('client_id').eq('id', id).single())
    must(await db().rpc('set_coach_notes', { client: ci.client_id, notes: patch.private_notes }))
  }
  return { draft_saved_at: saved }
}

async function applySuggestion(id: string, swap?: SwapRequest) {
  if (!swap) throw new ApiError(422, "This suggestion can't be applied in one click. Use Edit program.")
  return backend<{ ok: true; swap_id: string }>('/programs/swap', { ...swap, check_in_id: id })
}

async function clientDetail(clientId: string): Promise<ClientDetail> {
  const [u, p, targets] = await Promise.all([
    db().from('users').select('id, full_name, email').eq('id', clientId).single(),
    db().from('client_profiles').select(PROFILE_COLS).eq('user_id', clientId).single(),
    targetsOn(clientId, today()),
  ])
  const user: any = must(u)
  const prof: any = must(p)
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    client: person(user.id, user.full_name),
    email: user.email,
    setup_done: !!prof.setup_completed_at,
    goal: prof.goal,
    start_date: prof.start_date,
    week: programWeek(prof.start_date, today()),
    date_of_birth: prof.date_of_birth,
    height_cm: n(prof.height_cm),
    start_weight_kg: n(prof.start_weight_kg),
    goal_weight_kg: n(prof.goal_weight_kg),
    check_in_day: prof.check_in_day,
    experience: prof.experience,
    training_days: prof.training_days,
    train_location: prof.train_location,
    injuries: prof.injuries,
    diet: prof.diet,
    foods_to_avoid: prof.foods_to_avoid,
    meals_per_day: prof.meals_per_day,
    targets: targets?.targets ?? null,
    targets_from: targets?.from ?? null,
  }
}

/** Targets that apply from today (one table, so straight to Supabase; RLS checks it's the client's coach). */
async function setTargets(clientId: string, t: Targets) {
  const uid = await myId()
  must(await db().from('nutrition_targets').upsert({
    client_id: clientId,
    effective_from: today(),
    calories: t.calories,
    protein_g: t.protein_g,
    carbs_g: t.carbs_g,
    fat_g: t.fat_g,
    water_ml: t.water_ml || null,
    steps: t.steps || null,
    sleep_hours: t.sleep_h || null,
    set_by: uid,
  }, { onConflict: 'client_id,effective_from' }))
  return { ok: true }
}

export const liveCoach = { dashboard, checkinLists, checkinReview, saveReviewDraft, applySuggestion, clientDetail, setTargets }
