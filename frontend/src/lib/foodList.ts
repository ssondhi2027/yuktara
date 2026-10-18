// The shared food list: nutrition per 100 g (or per 100 ml for drinks) and
// common servings. Approximate values from standard food composition tables;
// labels vary by brand and recipe. The same list is seeded into the database by
// supabase/migrations/0022_foods.sql (tests/meals.test.ts keeps them in step) and
// used as-is in demo mode.

export interface SeedFood {
  name: string
  basis: 'g' | 'ml'
  /** per 100 g or 100 ml */
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  /** [name, amount in g or ml] */
  servings: [string, number][]
}

const f = (name: string, kcal: number, protein_g: number, carbs_g: number, fat_g: number, servings: [string, number][] = [], basis: 'g' | 'ml' = 'g'): SeedFood =>
  ({ name, basis, kcal, protein_g, carbs_g, fat_g, servings })

export const SHARED_FOODS: SeedFood[] = [
  // Protein
  f('Chicken breast, grilled', 165, 31, 0, 3.6, [['1 breast', 170]]),
  f('Chicken curry', 150, 14, 4, 9, [['1 bowl', 200]]),
  f('Turkey breast, roasted', 135, 30, 0, 1, [['1 slice', 28]]),
  f('Lean beef mince, cooked', 217, 26, 0, 12),
  f('Salmon fillet, cooked', 208, 20, 0, 13, [['1 fillet', 150]]),
  f('Tuna, canned in water', 116, 26, 0, 1, [['1 can, drained', 120]]),
  f('Egg', 143, 12.6, 0.7, 9.5, [['1 large egg', 50]]),
  f('Egg white', 52, 11, 0.7, 0.2, [['1 egg white', 33]]),
  f('Tofu, firm', 144, 17, 3, 8.7),
  f('Paneer', 296, 18, 3.6, 23, [['1 slice', 30]]),
  f('Paneer tikka', 260, 18, 6, 18, [['1 portion', 150]]),
  f('Whey protein', 400, 80, 10, 3.3, [['1 scoop', 30]]),
  f('Protein bar', 350, 30, 40, 9, [['1 bar', 60]]),
  // Dairy
  f('Greek yogurt 2%', 73, 10, 4, 2, [['1 pot', 170]]),
  f('Plain yogurt (curd)', 61, 3.5, 4.7, 3.3, [['1 bowl', 150]]),
  f('Cottage cheese, low fat', 82, 11, 3.4, 2.3, [['1/2 cup', 113]]),
  f('Cheddar cheese', 403, 25, 1.3, 33, [['1 slice', 20]]),
  f('Milk, semi-skimmed', 47, 3.4, 4.8, 1.7, [['1 glass', 250]], 'ml'),
  // Grains and starches
  f('Rice, white, cooked', 130, 2.7, 28, 0.3, [['1 cup', 158]]),
  f('Rice, brown, cooked', 123, 2.7, 26, 1, [['1 cup', 195]]),
  f('Quinoa, cooked', 120, 4.4, 21, 1.9, [['1 cup', 185]]),
  f('Oats', 380, 13, 67, 7, [['1/2 cup', 40]]),
  f('Granola', 471, 10, 64, 20, [['1/2 cup', 60]]),
  f('Bread, wholemeal', 247, 13, 41, 3.4, [['1 slice', 36]]),
  f('Pasta, cooked', 158, 5.8, 31, 0.9, [['1 cup', 140]]),
  f('Potato, boiled', 87, 1.9, 20, 0.1, [['1 medium', 170]]),
  f('Sweet potato, baked', 90, 2, 21, 0.2, [['1 medium', 150]]),
  f('Roti (chapati)', 300, 8, 46, 9, [['1 roti', 40]]),
  f('Idli', 146, 4.5, 30, 0.6, [['1 idli', 40]]),
  f('Dosa, plain', 168, 3.9, 29, 3.7, [['1 dosa', 80]]),
  f('Poha', 158, 3, 27, 4, [['1 plate', 150]]),
  // Legumes
  f('Dal (cooked lentils)', 116, 7, 17, 2, [['1 bowl', 200]]),
  f('Chickpeas, cooked', 164, 8.9, 27, 2.6, [['1 cup', 164]]),
  f('Rajma (kidney beans), cooked', 127, 8.7, 23, 0.5, [['1 bowl', 200]]),
  f('Hummus', 166, 8, 14, 9.6, [['2 tbsp', 30]]),
  // Fruit and vegetables
  f('Banana', 89, 1.1, 23, 0.3, [['1 medium', 118]]),
  f('Apple', 52, 0.3, 14, 0.2, [['1 medium', 182]]),
  f('Orange', 47, 0.9, 12, 0.1, [['1 medium', 130]]),
  f('Berries, mixed', 57, 0.7, 14, 0.3, [['1 cup', 145]]),
  f('Avocado', 160, 2, 9, 15, [['1/2 avocado', 70]]),
  f('Broccoli, cooked', 35, 2.4, 7, 0.4, [['1 cup', 156]]),
  f('Spinach, cooked', 23, 3, 3.8, 0.3, [['1 cup', 180]]),
  f('Mixed salad', 17, 1.2, 3.3, 0.2, [['1 bowl', 85]]),
  f('Orange juice', 45, 0.7, 10.4, 0.2, [['1 glass', 250]], 'ml'),
  // Fats, nuts and extras
  f('Almonds', 579, 21, 22, 50, [['1 handful', 28]]),
  f('Peanut butter', 588, 25, 20, 50, [['1 tbsp', 16]]),
  f('Olive oil', 884, 0, 0, 100, [['1 tbsp', 14]]),
  f('Butter', 717, 0.9, 0.1, 81, [['1 tsp', 5]]),
  f('Dark chocolate 70%', 598, 7.8, 46, 43, [['2 squares', 20]]),
]
