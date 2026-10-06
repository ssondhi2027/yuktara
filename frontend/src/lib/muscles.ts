import type { MuscleGroup } from '@/types/db'

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Chest',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  traps: 'Traps',
  upper_back: 'Upper back',
  lats: 'Lats',
  lower_back: 'Lower back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  adductors: 'Inner thighs',
  calves: 'Calves',
}

/** Body-map legend: 10 or more, 1 to 9, none yet. */
export type SetBand = 'high' | 'some' | 'none'
export const setBand = (sets: number): SetBand => (sets >= 10 ? 'high' : sets > 0 ? 'some' : 'none')

export const BAND_COLOR: Record<SetBand, string> = {
  high: 'var(--band-high)',
  some: 'var(--band-some)',
  none: 'var(--band-none)',
}

/** Raw hex values for the WebGL body map (CSS variables don't reach three.js). */
export const BAND_HEX = {
  light: { high: '#3f7a50', some: '#9bc185', none: '#e9e3d6' },
  dark: { high: '#8cc27a', some: '#4f7a45', none: '#2a4537' },
} as const
