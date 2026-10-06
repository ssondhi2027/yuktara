import type { GoalType } from '@/types/db'

export const GOAL_LABEL: Record<GoalType, string> = {
  fat_loss: 'Fat loss',
  muscle_gain: 'Muscle gain',
  performance: 'Performance',
  health: 'General health',
}

export const EXPERIENCE_LABEL = { beginner: 'New', intermediate: '1–3 years', advanced: '3+ years' } as const
export const LOCATION_LABEL = { gym: 'Gym', home: 'Home', both: 'Gym and home' } as const
export const DIET_LABEL = {
  none: 'Anything', vegetarian: 'Vegetarian', eggetarian: 'Eggetarian', vegan: 'Vegan', halal: 'Halal', other: 'Other',
} as const
export const MEALS_LABEL: Record<number, string> = { 2: '2 meals', 3: '3 meals', 4: '3 meals and a snack', 5: '3 meals and 2 snacks' }
export const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
