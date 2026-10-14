import type { ClientDetail } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { DIET_LABEL, EXPERIENCE_LABEL, GOAL_LABEL, LOCATION_LABEL, MEALS_LABEL, WEEKDAY_LABEL } from '@/lib/labels'
import { bodyWeight, length } from '@/lib/units'
import type { UnitSystem } from '@/types/db'

/** A client's setup answers as label/value rows, in the coach's units. Used by the dashboard sheet and the Clients page. */
export function setupRows(c: ClientDetail, units: UnitSystem, { withCheckInDay = true } = {}): [string, string][] {
  const rows: [string, string | null][] = [
    ['Email', c.email],
    ['Started', `${monthDay(c.start_date)} · week ${c.week}`],
    ['Goal', c.goal ? GOAL_LABEL[c.goal] : null],
    ['Weight', c.start_weight_kg != null ? `${bodyWeight(c.start_weight_kg, units)}${c.goal_weight_kg != null ? ` → goal ${bodyWeight(c.goal_weight_kg, units)}` : ''}` : null],
    ['Height', c.height_cm != null ? length(c.height_cm, units) : null],
    ['Born', c.date_of_birth ? monthDay(c.date_of_birth) + ', ' + c.date_of_birth.slice(0, 4) : null],
    ['Check-in day', withCheckInDay ? WEEKDAY_LABEL[c.check_in_day] : null],
    ['Experience', c.experience ? EXPERIENCE_LABEL[c.experience] : null],
    ['Trains', c.training_days ? `${c.training_days} days a week${c.train_location ? `, ${LOCATION_LABEL[c.train_location].toLowerCase()}` : ''}` : null],
    ['Injuries', c.injuries],
    ['Eats', c.diet ? `${DIET_LABEL[c.diet]}${c.meals_per_day ? `, ${MEALS_LABEL[c.meals_per_day] ?? `${c.meals_per_day} meals`}` : ''}` : null],
    ['Avoids', c.foods_to_avoid],
  ]
  return rows.filter((r): r is [string, string] => !!r[1])
}

export function SetupAnswersList({ c, units, withCheckInDay }: { c: ClientDetail; units: UnitSystem; withCheckInDay?: boolean }) {
  return (
    <dl className="answers-list">
      {setupRows(c, units, { withCheckInDay }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}
