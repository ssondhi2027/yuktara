// A coach's own exercises: the form's draft and its checks (the database
// enforces the same limits, 0018). Pure functions with type-only imports;
// unit-tested in tests/exercises.test.ts.

import type { ExerciseLevel, MuscleGroup } from '../types/db'

export interface ExerciseDraft {
  /** null = a new exercise */
  id: string | null
  name: string
  level: ExerciseLevel
  equipment: string
  cue: string
  primary: MuscleGroup[]
  secondary: MuscleGroup[]
}

/** Equipment in the shared library, offered as choices (free text is allowed too). */
export const EQUIPMENT = ['barbell', 'dumbbells', 'cable', 'machine', 'bodyweight', 'bench', 'pull-up bar', 'kettlebell', 'band', 'jump rope', 'ab wheel'] as const

export const emptyExercise = (): ExerciseDraft => ({ id: null, name: '', level: 'beginner', equipment: '', cue: '', primary: [], secondary: [] })

/**
 * Field problems, or an empty object. `libraryNames` are the shared library's
 * names (lower case) and `ownNames` the coach's other exercises: a duplicate
 * name would be confusing in the picker.
 */
export function exerciseProblems(d: ExerciseDraft, libraryNames: Set<string>, ownNames: Set<string>): Partial<Record<'name' | 'equipment' | 'cue' | 'primary' | 'secondary', string>> {
  const out: Partial<Record<'name' | 'equipment' | 'cue' | 'primary' | 'secondary', string>> = {}
  const name = d.name.trim()
  const key = name.toLowerCase()
  if (name.length < 2) out.name = 'Give it a name (2 characters or more).'
  else if (name.length > 80) out.name = 'Use up to 80 characters.'
  else if (libraryNames.has(key)) out.name = 'The library already has this one. Pick it from the list instead.'
  else if (ownNames.has(key)) out.name = 'You already have an exercise with this name.'
  if (d.equipment.trim().length > 40) out.equipment = 'Use up to 40 characters.'
  if (d.cue.trim().length > 300) out.cue = 'Use up to 300 characters.'
  if (!d.primary.length) out.primary = 'Choose at least one main muscle.'
  if (d.secondary.some((m) => d.primary.includes(m))) out.secondary = 'A muscle is either main or secondary, not both.'
  return out
}
