-- Shared exercise library (created_by = null) with muscle roles.
-- Primary muscles drive the Train tab's body map: each working set counts once
-- for every primary muscle of its exercise.

with lib (name, level, equipment, cue, primary_m, secondary_m) as (
  values
    ('Barbell bench press', 'intermediate', 'barbell', 'Feet planted, bar to mid-chest, press back over the shoulders.', '{chest}', '{triceps,shoulders}'),
    ('Dumbbell bench press', 'beginner', 'dumbbells', 'Shoulder blades pinned, elbows about 45 degrees.', '{chest}', '{triceps,shoulders}'),
    ('Incline dumbbell press', 'beginner', 'dumbbells', 'Bench at 30 degrees, lower to the upper chest.', '{chest}', '{shoulders,triceps}'),
    ('Push-up', 'beginner', 'bodyweight', 'Body in one line, chest to the floor.', '{chest}', '{triceps,shoulders,abs}'),
    ('Cable fly', 'beginner', 'cable', 'Soft elbows, hug a big tree.', '{chest}', '{shoulders}'),
    ('Overhead press', 'intermediate', 'barbell', 'Squeeze glutes, press up and slightly back.', '{shoulders}', '{triceps,traps}'),
    ('Seated dumbbell shoulder press', 'beginner', 'dumbbells', 'Back against the pad, press to just short of lockout.', '{shoulders}', '{triceps}'),
    ('Lateral raise', 'beginner', 'dumbbells', 'Lead with the elbows, stop at shoulder height.', '{shoulders}', '{traps}'),
    ('Rear delt fly', 'beginner', 'dumbbells', 'Hinge forward, sweep the arms wide, no swinging.', '{shoulders}', '{upper_back}'),
    ('Face pull', 'beginner', 'cable', 'Pull to the eyes, thumbs back.', '{shoulders,upper_back}', '{traps}'),
    ('Dumbbell curl', 'beginner', 'dumbbells', 'Elbows pinned to the sides.', '{biceps}', '{forearms}'),
    ('Barbell curl', 'beginner', 'barbell', 'No hip swing, full range.', '{biceps}', '{forearms}'),
    ('Hammer curl', 'beginner', 'dumbbells', 'Thumbs up the whole way.', '{biceps,forearms}', '{}'),
    ('Incline dumbbell curl', 'intermediate', 'dumbbells', 'Let the arms hang behind the body.', '{biceps}', '{}'),
    ('Rope pushdown', 'beginner', 'cable', 'Elbows still, spread the rope at the bottom.', '{triceps}', '{}'),
    ('Overhead triceps extension', 'beginner', 'cable', 'Elbows point forward, reach long.', '{triceps}', '{}'),
    ('Close-grip bench press', 'intermediate', 'barbell', 'Hands shoulder-width, elbows tucked.', '{triceps,chest}', '{shoulders}'),
    ('Dips', 'intermediate', 'bodyweight', 'Slight lean, shoulders down.', '{triceps,chest}', '{shoulders}'),
    ('Farmer''s carry', 'beginner', 'dumbbells', 'Tall posture, short quick steps.', '{forearms,traps}', '{obliques,abs}'),
    ('Wrist curl', 'beginner', 'dumbbells', 'Forearms on the bench, curl just the wrists.', '{forearms}', '{}'),
    ('Reverse curl', 'beginner', 'barbell', 'Overhand grip, wrists straight.', '{forearms}', '{biceps}'),
    ('Dead hang', 'beginner', 'pull-up bar', 'Shoulders active, breathe.', '{forearms}', '{lats}'),
    ('Plank', 'beginner', 'bodyweight', 'Ribs down, squeeze glutes, breathe.', '{abs}', '{obliques}'),
    ('Hanging knee raise', 'intermediate', 'pull-up bar', 'Curl the pelvis up, no swinging.', '{abs}', '{obliques}'),
    ('Cable crunch', 'beginner', 'cable', 'Round the spine, hips stay still.', '{abs}', '{}'),
    ('Dead bug', 'beginner', 'bodyweight', 'Low back stays on the floor.', '{abs}', '{obliques}'),
    ('Ab wheel rollout', 'advanced', 'ab wheel', 'Hips and ribs move together.', '{abs}', '{lats,obliques}'),
    ('Side plank', 'beginner', 'bodyweight', 'Hips high, straight line head to heel.', '{obliques}', '{abs}'),
    ('Pallof press', 'beginner', 'cable', 'Resist the twist, press straight out.', '{obliques}', '{abs}'),
    ('Cable woodchop', 'beginner', 'cable', 'Rotate through the hips and trunk.', '{obliques}', '{abs,shoulders}'),
    ('Suitcase carry', 'beginner', 'dumbbells', 'Weight in one hand, stay level.', '{obliques,forearms}', '{traps}'),
    ('Dumbbell shrug', 'beginner', 'dumbbells', 'Straight up to the ears, pause.', '{traps}', '{forearms}'),
    ('Seated cable row', 'beginner', 'cable', 'Chest tall, pull to the belly button.', '{upper_back,lats}', '{biceps}'),
    ('Chest-supported dumbbell row', 'beginner', 'dumbbells', 'Chest on the pad, drive the elbows back.', '{upper_back,lats}', '{biceps,shoulders}'),
    ('Bent-over barbell row', 'intermediate', 'barbell', 'Flat back, bar to the lower ribs.', '{upper_back,lats}', '{lower_back,biceps}'),
    ('Lat pulldown', 'beginner', 'cable', 'Pull elbows down to the ribs.', '{lats,upper_back}', '{biceps}'),
    ('Pull-up', 'intermediate', 'pull-up bar', 'Full hang to chin over the bar.', '{lats,upper_back}', '{biceps,forearms}'),
    ('Single-arm dumbbell row', 'beginner', 'dumbbells', 'Pull the elbow to the hip.', '{lats,upper_back}', '{biceps}'),
    ('Straight-arm pulldown', 'beginner', 'cable', 'Arms long, sweep the bar to the thighs.', '{lats}', '{triceps}'),
    ('Back extension', 'beginner', 'bench', 'Hinge at the hips, stop in line with the legs.', '{lower_back}', '{glutes,hamstrings}'),
    ('Bird dog', 'beginner', 'bodyweight', 'Reach long, keep the hips square.', '{lower_back}', '{glutes,abs}'),
    ('Deadlift', 'intermediate', 'barbell', 'Bar over mid-foot, push the floor away.', '{glutes,hamstrings,lower_back}', '{quads,traps,forearms}'),
    ('Good morning', 'intermediate', 'barbell', 'Soft knees, hips back, flat back.', '{hamstrings,lower_back}', '{glutes}'),
    ('Hip thrust', 'beginner', 'barbell', 'Chin tucked, ribs down, pause at the top.', '{glutes}', '{hamstrings}'),
    ('Glute bridge', 'beginner', 'bodyweight', 'Drive through the heels, squeeze at the top.', '{glutes}', '{hamstrings}'),
    ('Cable kickback', 'beginner', 'cable', 'Small lean, kick back without arching.', '{glutes}', '{}'),
    ('Back squat', 'intermediate', 'barbell', 'Brace, sit between the hips, drive the floor away.', '{quads,glutes}', '{adductors,lower_back}'),
    ('Goblet squat', 'beginner', 'dumbbells', 'Elbows inside the knees, chest up.', '{quads,glutes}', '{abs,adductors}'),
    ('Leg press', 'beginner', 'machine', 'Lower until the hips start to tuck.', '{quads}', '{glutes,adductors}'),
    ('Walking lunge', 'beginner', 'dumbbells', 'Long stride, back knee kisses the floor.', '{quads,glutes}', '{adductors}'),
    ('Bulgarian split squat', 'intermediate', 'dumbbells', 'Front foot far enough that the heel stays down.', '{quads,glutes}', '{adductors}'),
    ('Leg extension', 'beginner', 'machine', 'Pause at the top, lower slowly.', '{quads}', '{}'),
    ('Romanian deadlift', 'intermediate', 'barbell', 'Soft knees, push the hips back, bar close to the legs.', '{hamstrings,glutes}', '{lower_back,forearms}'),
    ('Lying leg curl', 'beginner', 'machine', 'Hips pressed down, slow lowering.', '{hamstrings}', '{calves}'),
    ('Nordic curl', 'advanced', 'bodyweight', 'Fall as slowly as you can.', '{hamstrings}', '{}'),
    ('Copenhagen plank', 'intermediate', 'bench', 'Top leg on the bench, hips lifted.', '{adductors}', '{obliques}'),
    ('Adductor machine', 'beginner', 'machine', 'Slow squeeze, controlled return.', '{adductors}', '{}'),
    ('Sumo squat', 'beginner', 'dumbbells', 'Wide stance, toes out, knees track the toes.', '{adductors,quads,glutes}', '{}'),
    ('Standing calf raise', 'beginner', 'machine', 'Full stretch at the bottom, pause at the top.', '{calves}', '{}'),
    ('Seated calf raise', 'beginner', 'machine', 'Pause in the stretch.', '{calves}', '{}'),
    ('Jump rope', 'beginner', 'jump rope', 'Light, quick bounces on the balls of the feet.', '{calves}', '{quads}')
),
ins as (
  insert into public.exercises (name, level, equipment, cue)
  select name, level::public.exercise_level, equipment, cue from lib
  on conflict do nothing
  returning id, name
)
insert into public.exercise_muscles (exercise_id, muscle, role)
select ins.id, m::public.muscle_group, 'primary'::public.muscle_role from ins join lib using (name), unnest(lib.primary_m::text[]) m
union all
select ins.id, m::public.muscle_group, 'secondary'::public.muscle_role from ins join lib using (name), unnest(lib.secondary_m::text[]) m;

-- Muscle-page notes.
update public.exercise_muscles em
set note_kind = 'research',
    note = 'About 10–20 hard sets a week suits most lifters for growth.',
    source_url = 'https://pubmed.ncbi.nlm.nih.gov/27433992/'
from public.exercises e
where e.id = em.exercise_id and e.name = 'Hip thrust' and em.muscle = 'glutes';

update public.exercise_muscles em
set note_kind = 'coach_tip',
    note = 'Keep RDLs light while the lower back settles. Paused back extensions are a good swap.'
from public.exercises e
where e.id = em.exercise_id and e.name = 'Back extension' and em.muscle = 'lower_back';
