// Personal records, live: worked out in the browser from the client's logged
// sets (lib/records.ts) and saved to personal_records (0025) when a workout
// finishes, so a badge stays put if an old set is edited later. Reads are in
// shared.ts (recordsOf). Every query runs as the signed-in client (RLS).

import type { Bests } from '../api'
import { bestsFrom, findRecords, type ExerciseInfo, type PersonalRecord, type RecordSession } from '../records'
import { BODYWEIGHT } from '../workouts'
import { db, must, myId } from './shared'

const PAGE = 1000

/** Every row of a query, a page at a time (the API returns at most 1000 rows per request). */
async function allRows(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: any }>, maxPages = 20): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < maxPages; i++) {
    const rows = must(await page(i * PAGE, (i + 1) * PAGE - 1)) as any[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * The client's finished workouts (not skipped), oldest first, with their working
 * sets of these exercises (null: every exercise), and those exercises' names.
 */
async function history(uid: string, exerciseIds: string[] | null): Promise<{ sessions: RecordSession[]; info: ExerciseInfo }> {
  const [heads, sets] = await Promise.all([
    allRows((a, b) => db().from('workout_sessions').select('id, performed_on, started_at')
      .eq('client_id', uid).not('finished_at', 'is', null).neq('status', 'skipped').order('id').range(a, b)),
    exerciseIds && !exerciseIds.length ? Promise.resolve([]) : allRows((a, b) => {
      let q = db().from('set_logs')
        .select('session_id, exercise_id, set_number, reps, weight_kg, rpe, duration_s, distance_m, exercises(name, equipment, kind), workout_sessions!inner(client_id)')
        .eq('workout_sessions.client_id', uid).eq('is_warmup', false).eq('set_kind', 'normal')
      if (exerciseIds) q = q.in('exercise_id', exerciseIds)
      return q.order('id').range(a, b)
    }),
  ])
  const info: ExerciseInfo = new Map()
  const bySession = new Map<string, RecordSession>(heads.map((h) => [h.id, { id: h.id, date: h.performed_on, started_at: h.started_at, sets: [] }]))
  for (const r of sets) {
    info.set(r.exercise_id, { name: r.exercises?.name ?? 'Exercise', bodyweight: BODYWEIGHT.has(r.exercises?.equipment ?? ''), cardio: r.exercises?.kind === 'cardio' })
    bySession.get(r.session_id)?.sets.push({
      exercise_id: r.exercise_id, set_number: r.set_number, reps: r.reps,
      weight_kg: r.weight_kg == null ? null : Number(r.weight_kg), rpe: r.rpe == null ? null : Number(r.rpe),
      duration_s: r.duration_s ?? null, distance_m: r.distance_m == null ? null : Number(r.distance_m),
    })
  }
  return { sessions: [...bySession.values()], info }
}

/** Weigh-ins (and the start weight, on the start date) for the bodyweight milestones. */
async function weighIns(uid: string): Promise<{ date: string; kg: number }[]> {
  const [days, prof] = await Promise.all([
    allRows((a, b) => db().from('daily_logs').select('log_date, weight_kg').eq('client_id', uid).not('weight_kg', 'is', null).order('log_date').range(a, b)),
    db().from('client_profiles').select('start_date, start_weight_kg').eq('user_id', uid).maybeSingle(),
  ])
  const p: any = must(prof)
  const out = days.map((d) => ({ date: d.log_date as string, kg: Number(d.weight_kg) }))
  return p?.start_weight_kg != null ? [{ date: p.start_date, kg: Number(p.start_weight_kg) }, ...out] : out
}

/** Each exercise's bests from the client's other finished workouts (the logger's badges). */
export async function recordBests(sessionId: string, exerciseIds: string[]): Promise<Record<string, Bests>> {
  if (!exerciseIds.length) return {}
  const { sessions, info } = await history(await myId(), exerciseIds)
  return bestsFrom(sessions.filter((s) => s.id !== sessionId), info)
}

const toRow = (r: PersonalRecord) => ({
  session_id: r.session_id, exercise_id: r.exercise_id, kind: r.kind, milestone: r.milestone, value: r.value, previous: r.previous,
  set_number: r.set_number, weight_kg: r.weight_kg, reps: r.reps, rpe: r.rpe, duration_s: r.duration_s ?? null, distance_m: r.distance_m ?? null,
})

/**
 * Saves the records a finished workout set. The first time (no records saved
 * yet) it fills in the records of every earlier workout too; after that each
 * workout adds only its own, so editing old sets never changes saved ones.
 */
export async function saveRecords(sessionId: string): Promise<void> {
  const uid = await myId()
  const first = !(must(await db().from('personal_records').select('id').eq('client_id', uid).limit(1)) as unknown[]).length
  const ids = first ? null : [...new Set((must(await db().from('set_logs').select('exercise_id').eq('session_id', sessionId)) as any[]).map((r) => r.exercise_id as string))]
  const [{ sessions, info }, weights] = await Promise.all([history(uid, ids), weighIns(uid)])
  const recs = findRecords(sessions, info, weights).filter((r) => first || r.session_id === sessionId)
  for (let i = 0; i < recs.length; i += 500) must(await db().rpc('save_personal_records', { recs: recs.slice(i, i + 500).map(toRow) }))
}
