// Live data for the client's Profile & settings page. The client changes their
// own answers (RLS + the client_profiles guard, 0017); what the coach controls
// (check-in day, targets, program, status) is read-only here.

import type { MyProfile, ProfilePatch } from '../api'
import { today } from '../dates'
import { db, must, myId, person, programWeek, targetsOn } from './shared'

async function get(): Promise<MyProfile> {
  const uid = await myId()
  const [u, p, targets, programs] = await Promise.all([
    db().from('users').select('full_name, email, unit_system').eq('id', uid).single(),
    // Column list on purpose: coach_notes is hidden from clients.
    db().from('client_profiles')
      .select('coach_id, goal, start_date, height_cm, start_weight_kg, goal_weight_kg, check_in_day, experience, training_days,'
        + ' train_location, injuries, diet, foods_to_avoid, meals_per_day')
      .eq('user_id', uid).single(),
    targetsOn(uid, today()),
    db().from('programs').select('name, start_date, weeks').eq('client_id', uid).lte('start_date', today())
      .order('start_date', { ascending: false }).limit(1),
  ])
  const user: any = must(u)
  const prof: any = must(p)
  const coach: any = prof.coach_id ? must(await db().from('users').select('id, full_name').eq('id', prof.coach_id).maybeSingle()) : null
  const prog = (must(programs) as any[])[0]
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    full_name: user.full_name ?? '',
    email: user.email,
    units: user.unit_system ?? 'imperial',
    height_cm: n(prof.height_cm),
    goal_weight_kg: n(prof.goal_weight_kg),
    start_weight_kg: n(prof.start_weight_kg),
    goal: prof.goal,
    experience: prof.experience,
    diet: prof.diet,
    foods_to_avoid: prof.foods_to_avoid,
    meals_per_day: prof.meals_per_day,
    training_days: prof.training_days,
    train_location: prof.train_location,
    injuries: prof.injuries,
    coach: coach ? person(coach.id, coach.full_name) : null,
    check_in_day: prof.check_in_day,
    start_date: prof.start_date,
    targets: targets ? { effective_from: targets.from, targets: targets.targets } : null,
    program: prog ? { name: prog.name, week: programWeek(prog.start_date, today()), weeks: prog.weeks } : null,
  }
}

async function save(p: ProfilePatch) {
  const uid = await myId()
  must(await db().from('users').update({ full_name: p.full_name.trim() }).eq('id', uid))
  must(await db().from('client_profiles').update({
    height_cm: p.height_cm,
    goal_weight_kg: p.goal_weight_kg,
    diet: p.diet,
    foods_to_avoid: p.foods_to_avoid?.trim() || null,
    meals_per_day: p.meals_per_day,
    training_days: p.training_days,
    train_location: p.train_location,
    injuries: p.injuries?.trim() || null,
  }).eq('user_id', uid))
  return { ok: true }
}

export const liveProfile = { get, save }
