// Live data for the coach's Programs page. Reads run as the coach (RLS: their
// own templates and their own clients' programs). Saving, assigning and copying
// are database functions (0015) run as the coach, so each is one transaction.

import type { PostgrestError } from '@supabase/supabase-js'
import type { Program, ProgramClientRow, ProgramTemplateRow, ProgramWorkout } from '../api'
import { ApiError } from '../backend'
import { today } from '../dates'
import { programStatus, programWeekOf } from '../programs'
import { db, must, myId, person } from './shared'

/** Turns a database function's error into a readable ApiError. */
function check<T>(res: { data: T | null; error: PostgrestError | null }): T {
  const e = res.error
  if (e?.code === 'PT404') throw new ApiError(404, "That program doesn't exist (or isn't yours).", e.code)
  if (e?.code === 'P0001') throw new ApiError(409, e.message, e.code)
  if (e?.code === '23514') throw new ApiError(422, 'A value is out of range. Check sets (1–10), RPE (1–10) and reps.', e.code)
  return must(res)
}

interface ProgramRow { id: string; client_id: string | null; is_template: boolean; name: string; weeks: number; start_date: string | null; assigned_at: string | null }

async function clients(): Promise<ProgramClientRow[]> {
  const uid = await myId()
  const profs = must(await db().from('client_profiles')
    .select('user_id, goal, experience, training_days, train_location, injuries, setup_completed_at')
    .eq('coach_id', uid)) as any[]
  const ids = profs.map((p) => p.user_id)
  if (!ids.length) return []
  const [users, programs] = await Promise.all([
    db().from('users').select('id, full_name').in('id', ids),
    db().from('programs').select('id, client_id, is_template, name, weeks, start_date, assigned_at').in('client_id', ids),
  ])
  const names = new Map((must(users) as any[]).map((u) => [u.id, u.full_name]))
  const rows = must(programs) as ProgramRow[]
  const t = today()
  return profs.map((p): ProgramClientRow => {
    const mine = rows.filter((r) => r.client_id === p.user_id)
    const started = mine.filter((r) => r.assigned_at && r.start_date && r.start_date <= t).sort((a, b) => b.start_date!.localeCompare(a.start_date!))[0]
    const next = mine.filter((r) => r.assigned_at && r.start_date && r.start_date > t).sort((a, b) => a.start_date!.localeCompare(b.start_date!))[0]
    const draft = mine.find((r) => !r.assigned_at)
    return {
      client: person(p.user_id, names.get(p.user_id)),
      setup_done: !!p.setup_completed_at,
      goal: p.goal, experience: p.experience, training_days: p.training_days, train_location: p.train_location, injuries: p.injuries,
      current: started ? { id: started.id, name: started.name, week: programWeekOf(started.start_date!, t), weeks: started.weeks, start_date: started.start_date! } : null,
      upcoming: next ? { id: next.id, name: next.name, start_date: next.start_date! } : null,
      draft: draft ? { id: draft.id, name: draft.name } : null,
    }
  }).sort((a, b) => a.client.full_name.localeCompare(b.client.full_name))
}

async function templates(): Promise<ProgramTemplateRow[]> {
  const uid = await myId()
  const rows = must(await db().from('programs')
    .select('id, name, goal, level, days_per_week, weeks, workout_templates(count)')
    .eq('coach_id', uid).eq('is_template', true).order('name')) as any[]
  return rows.map((r) => ({
    id: r.id, name: r.name, goal: r.goal, level: r.level, days_per_week: r.days_per_week, weeks: r.weeks,
    workouts: r.workout_templates?.[0]?.count ?? 0,
  }))
}

async function get(id: string): Promise<Program> {
  const r: any = must(await db().from('programs')
    .select('id, client_id, is_template, name, weeks, goal, level, days_per_week, start_date, assigned_at, draft_start,'
      + ' workout_templates(id, name, day_of_week, position, notes, removed_at,'
      + ' template_exercises(id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, notes, removed_at, exercises(name)))')
    .eq('id', id).maybeSingle())
  if (!r) throw new ApiError(404, "That program doesn't exist (or isn't yours).")
  const t = today()
  const status = programStatus({ is_template: r.is_template, assigned: !!r.assigned_at, start_date: r.start_date, weeks: r.weeks }, t)
  const workouts: ProgramWorkout[] = (r.workout_templates ?? [])
    .filter((w: any) => !w.removed_at)
    .sort((a: any, b: any) => a.position - b.position)
    .map((w: any): ProgramWorkout => ({
      id: w.id, name: w.name, day_of_week: w.day_of_week, notes: w.notes ?? '',
      exercises: (w.template_exercises ?? [])
        .filter((x: any) => !x.removed_at)
        .sort((a: any, b: any) => a.position - b.position)
        .map((x: any) => ({
          id: x.id, exercise_id: x.exercise_id, name: x.exercises?.name ?? 'Exercise', sets: x.target_sets, reps: x.target_reps,
          rpe: x.target_rpe == null ? null : Number(x.target_rpe), rest_seconds: x.rest_seconds, notes: x.notes ?? '',
        })),
    }))
  return {
    id: r.id, client_id: r.client_id, name: r.name, weeks: r.weeks, goal: r.goal, level: r.level, days_per_week: r.days_per_week,
    status, start_date: r.start_date, draft_start: r.draft_start,
    week: status === 'active' ? programWeekOf(r.start_date, t) : null,
    workouts,
  }
}

async function save(p: Program): Promise<{ id: string }> {
  const body = {
    id: p.id, client_id: p.client_id, name: p.name, weeks: p.weeks, goal: p.goal, level: p.level,
    days_per_week: p.workouts.filter((w) => w.day_of_week != null).length || null,
    draft_start: p.draft_start,
    workouts: p.workouts.map((w) => ({
      id: w.id, name: w.name, day_of_week: w.day_of_week, notes: w.notes,
      exercises: w.exercises.map((x) => ({
        id: x.id, exercise_id: x.exercise_id, target_sets: x.sets, target_reps: x.reps, target_rpe: x.rpe,
        rest_seconds: x.rest_seconds, notes: x.notes,
      })),
    })),
  }
  return { id: check(await db().rpc('save_program', { p: body })) as string }
}

async function assign(id: string, start: string) {
  check(await db().rpc('assign_program', { program: id, start }))
  return { ok: true }
}

async function copy(id: string, clientId: string | null): Promise<{ id: string }> {
  return { id: check(await db().rpc('copy_program', { source: id, client: clientId })) as string }
}

async function remove(id: string) {
  const rows = must(await db().from('programs').delete().eq('id', id).select('id')) as any[]
  if (!rows.length) throw new ApiError(409, 'Only drafts and templates can be deleted. An assigned program keeps its history.')
  return { ok: true }
}

export const livePrograms = { clients, templates, get, save, assign, copy, remove }
