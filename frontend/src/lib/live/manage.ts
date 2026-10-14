// Live data for the coach's Clients, Nutrition plans and Settings pages. Every
// query runs as the coach; RLS limits rows to their own clients, and the
// client_profiles guard (0017) lets a coach change only status, check-in day
// and private notes.

import type { ClientStatus } from '@/types/db'
import type {
  ClientHistory, CoachClientRow, CoachQuestion, CoachSettings, NutritionRow, TargetVersion, WeekPoint,
} from '../api'
import { ApiError } from '../backend'
import { addDays, today } from '../dates'
import { avg, db, localDate, must, myId, person, programWeek, round1, targetsFromRow, weekMonday } from './shared'

const TARGET_COLS = 'client_id, calories, protein_g, carbs_g, fat_g, water_ml, steps, sleep_hours, effective_from'

/** Newest date per client from rows of {client_id, date}. */
function latestBy<T extends { client_id: string }>(rows: T[], date: (r: T) => string): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    const d = date(r)
    if (!out.has(r.client_id) || d > out.get(r.client_id)!) out.set(r.client_id, d)
  }
  return out
}

async function lastActivity(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const [meals, logs, sessions] = await Promise.all([
    db().from('meal_logs').select('client_id, eaten_at').in('client_id', ids).order('eaten_at', { ascending: false }).limit(500),
    db().from('daily_logs').select('client_id, log_date').in('client_id', ids).order('log_date', { ascending: false }).limit(500),
    db().from('workout_sessions').select('client_id, performed_on').in('client_id', ids).order('performed_on', { ascending: false }).limit(500),
  ])
  const all = [
    ...(must(meals) as any[]).map((r) => ({ client_id: r.client_id, d: localDate(r.eaten_at) })),
    ...(must(logs) as any[]).map((r) => ({ client_id: r.client_id, d: r.log_date })),
    ...(must(sessions) as any[]).map((r) => ({ client_id: r.client_id, d: r.performed_on })),
  ]
  return latestBy(all, (r) => r.d)
}

async function clients(): Promise<CoachClientRow[]> {
  const uid = await myId()
  const profs = must(await db().from('client_profiles')
    .select('user_id, status, goal, start_date, setup_completed_at').eq('coach_id', uid)) as any[]
  const ids = profs.map((p) => p.user_id)
  if (!ids.length) return []
  const t = today()
  const [users, programs, targets, checkIns, activity] = await Promise.all([
    db().from('users').select('id, full_name').in('id', ids),
    db().from('programs').select('id, client_id, name, start_date').in('client_id', ids).lte('start_date', t).order('start_date', { ascending: false }),
    db().from('nutrition_targets').select('client_id').in('client_id', ids).lte('effective_from', t),
    db().from('check_ins').select('id, client_id, week_start, status').in('client_id', ids).order('week_start', { ascending: false }).limit(1000),
    lastActivity(ids),
  ])
  const names = new Map((must(users) as any[]).map((u) => [u.id, u.full_name]))
  const progs = must(programs) as any[]
  const withTargets = new Set((must(targets) as any[]).map((r) => r.client_id))
  const cis = must(checkIns) as any[]
  return profs.map((p): CoachClientRow => {
    const prog = progs.find((x) => x.client_id === p.user_id)
    const ci = cis.find((x) => x.client_id === p.user_id)
    return {
      client: person(p.user_id, names.get(p.user_id)),
      goal: p.goal,
      status: p.status,
      setup_done: !!p.setup_completed_at,
      week: programWeek(p.start_date, t),
      program: prog ? { id: prog.id, name: prog.name } : null,
      has_targets: withTargets.has(p.user_id),
      last_check_in: ci ? { id: ci.id, week_start: ci.week_start, status: ci.status } : null,
      last_activity: activity.get(p.user_id) ?? null,
    }
  })
}

async function history(clientId: string): Promise<ClientHistory> {
  const [prof, logs, checkIns, notes, activity] = await Promise.all([
    db().from('client_profiles').select('start_date').eq('user_id', clientId).maybeSingle(),
    db().from('daily_logs').select('log_date, weight_kg').eq('client_id', clientId).not('weight_kg', 'is', null).order('log_date'),
    db().from('check_ins').select('id, week_start, status, submitted_at, reviewed_at').eq('client_id', clientId).order('week_start', { ascending: false }),
    db().rpc('get_coach_notes', { client: clientId }),
    lastActivity([clientId]),
  ])
  const p: any = must(prof)
  if (!p) throw new ApiError(404, "That client isn't one of yours.")
  const weights = (must(logs) as any[]).map((l) => ({ date: l.log_date as string, kg: Number(l.weight_kg) }))
  const weeks = Math.min(26, programWeek(p.start_date, today()))
  const first = programWeek(p.start_date, today()) - weeks + 1
  const points: WeekPoint[] = Array.from({ length: weeks }, (_, i) => {
    const w = first + i
    const mon = weekMonday(p.start_date, w)
    const a = avg(weights.filter((x) => x.date >= mon && x.date <= addDays(mon, 6)).map((x) => x.kg))
    return { label: `W${w}`, kg: a == null ? null : round1(a) }
  })
  return {
    weights: points,
    check_ins: must(checkIns) as ClientHistory['check_ins'],
    notes: (must(notes) as string | null) ?? '',
    last_activity: activity.get(clientId) ?? null,
  }
}

async function updateProfile(clientId: string, patch: Record<string, unknown>) {
  const rows = must(await db().from('client_profiles').update(patch).eq('user_id', clientId).select('user_id')) as any[]
  if (!rows.length) throw new ApiError(404, "That client isn't one of yours.")
  return { ok: true }
}

const setStatus = (clientId: string, status: ClientStatus) => updateProfile(clientId, { status })
const setCheckInDay = (clientId: string, day: number) => updateProfile(clientId, { check_in_day: day })

async function setNotes(clientId: string, notes: string) {
  must(await db().rpc('set_coach_notes', { client: clientId, notes: notes.trim() || null }))
  return { ok: true }
}

const toVersion = (r: any): TargetVersion => ({ effective_from: r.effective_from, targets: targetsFromRow(r) })

async function nutrition(): Promise<NutritionRow[]> {
  const uid = await myId()
  const profs = must(await db().from('client_profiles').select('user_id, status, goal').eq('coach_id', uid)) as any[]
  const ids = profs.map((p) => p.user_id)
  if (!ids.length) return []
  const [users, targets] = await Promise.all([
    db().from('users').select('id, full_name').in('id', ids),
    db().from('nutrition_targets').select(TARGET_COLS).in('client_id', ids).order('effective_from', { ascending: false }),
  ])
  const names = new Map((must(users) as any[]).map((u) => [u.id, u.full_name]))
  const rows = must(targets) as any[]
  const t = today()
  return profs.map((p): NutritionRow => {
    const mine = rows.filter((r) => r.client_id === p.user_id)
    const current = mine.find((r) => r.effective_from <= t)
    const next = [...mine].reverse().find((r) => r.effective_from > t)
    return {
      client: person(p.user_id, names.get(p.user_id)), goal: p.goal, status: p.status,
      current: current ? toVersion(current) : null, next: next ? toVersion(next) : null,
    }
  })
}

async function targetHistory(clientId: string): Promise<TargetVersion[]> {
  const rows = must(await db().from('nutrition_targets').select(TARGET_COLS).eq('client_id', clientId).order('effective_from', { ascending: false }))
  return (rows as any[]).map(toVersion)
}

async function settings(): Promise<CoachSettings> {
  const uid = await myId()
  const u: any = must(await db().from('users').select('full_name, invite_code, default_check_in_day').eq('id', uid).single())
  return { full_name: u.full_name ?? '', invite_code: u.invite_code, default_check_in_day: u.default_check_in_day ?? 0 }
}

async function saveSettings(s: { full_name: string; default_check_in_day: number }) {
  const uid = await myId()
  must(await db().from('users').update({ full_name: s.full_name.trim(), default_check_in_day: s.default_check_in_day }).eq('id', uid))
  return { ok: true }
}

async function questions(): Promise<CoachQuestion[]> {
  const uid = await myId()
  const rows = must(await db().from('checkin_questions')
    .select('id, prompt, answer_type, position, is_active, checkin_answers(count)')
    .eq('coach_id', uid).order('position')) as any[]
  return rows.map((r) => ({ id: r.id, prompt: r.prompt, answer_type: r.answer_type, is_active: r.is_active, answers: r.checkin_answers?.[0]?.count ?? 0 }))
}

async function saveQuestions(qs: CoachQuestion[]) {
  const uid = await myId()
  const before = must(await db().from('checkin_questions').select('id').eq('coach_id', uid)) as { id: string }[]
  for (const [i, q] of qs.entries()) {
    const row = { prompt: q.prompt.trim(), answer_type: q.answer_type, is_active: q.is_active, position: i }
    if (q.id) must(await db().from('checkin_questions').update(row).eq('id', q.id))
    else must(await db().from('checkin_questions').insert({ ...row, coach_id: uid }))
  }
  // Removed ones: deleted, unless clients have answered them (RLS, 0017); those are turned off instead.
  for (const { id } of before.filter((b) => !qs.some((q) => q.id === b.id))) {
    const gone = must(await db().from('checkin_questions').delete().eq('id', id).select('id')) as any[]
    if (!gone.length) must(await db().from('checkin_questions').update({ is_active: false }).eq('id', id))
  }
  return { ok: true }
}

export const liveManage = {
  clients, history, setStatus, setCheckInDay, setNotes, nutrition, targetHistory, settings, saveSettings, questions, saveQuestions,
}
