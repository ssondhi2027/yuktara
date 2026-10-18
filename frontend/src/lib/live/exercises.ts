// Live data for a coach's own exercises (0018). The exercise and its muscles
// are saved together by save_exercise(), run as the coach under RLS; the library
// itself is read by liveClient.exerciseLibrary (shared + the coach's own).

import { ApiError } from '../backend'
import type { ExerciseDraft } from '../exercises'
import { db } from './shared'

function check<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  const e = res.error
  if (!e) return res.data as T
  if (e.code === 'PT404') throw new ApiError(404, "That exercise doesn't exist (or isn't yours).", e.code)
  if (e.code === 'P0001') throw new ApiError(409, e.message, e.code)
  if (e.code === '23505') throw new ApiError(409, 'You already have an exercise with this name.', e.code)
  if (e.code === '23514') throw new ApiError(422, 'A value is too long or too short. Check the name (2–80 characters) and cue (up to 300).', e.code)
  if (e.code === '23503') throw new ApiError(409, "It's in a program or a logged workout, so it can't be deleted. Rename it instead.", e.code)
  if (e.code === '42501') throw new ApiError(403, 'Only coaches can add exercises.', e.code)
  throw new ApiError(500, 'Something went wrong saving the exercise.', e.code)
}

async function save(d: ExerciseDraft): Promise<{ id: string }> {
  const body = { id: d.id, name: d.name.trim(), level: d.level, equipment: d.equipment.trim(), cue: d.cue.trim(), primary: d.primary, secondary: d.secondary }
  return { id: check(await db().rpc('save_exercise', { e: body })) as string }
}

async function remove(id: string) {
  // RLS: only the coach's own; foreign keys refuse it while a program or a logged set uses it.
  const rows = check(await db().from('exercises').delete().eq('id', id).not('created_by', 'is', null).select('id')) as { id: string }[]
  if (!rows.length) throw new ApiError(404, "That exercise doesn't exist (or isn't yours).")
  return { ok: true }
}

export const liveExercises = { save, remove }
