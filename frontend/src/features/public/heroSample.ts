// The landing page's example week: hard sets per muscle group, as the Train
// tab's body map colours them (10 or more, 1 to 9, none). Sample numbers, and
// the page says so.

import type { MuscleGroup } from '@/types/db'

export const SAMPLE_SETS: Record<MuscleGroup, number> = {
  chest: 12, shoulders: 10, biceps: 6, triceps: 8, forearms: 2,
  abs: 9, obliques: 4, traps: 5,
  upper_back: 12, lats: 11, lower_back: 4,
  glutes: 12, quads: 14, hamstrings: 9, adductors: 3, calves: 0,
}
