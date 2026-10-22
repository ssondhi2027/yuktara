// Personal record badges and lists (lib/records.ts): the logger, the workout
// summary, Home, Progress and the coach's views. Weights in the viewer's unit;
// load milestones in the viewer's unit only.

import type { PersonalRecord } from '@/lib/api'
import { monthDay } from '@/lib/dates'
import { bySet, RECORD_LABEL, recordChange, recordSet, recordTitle, visibleRecords, type RecordKind } from '@/lib/records'
import type { UnitSystem } from '@/types/db'
import './records.css'

/** The badges on a ticked set in the logger ("Weight PR", "Rep PR", "1RM PR"). */
export function RecordBadges({ kinds }: { kinds: RecordKind[] }) {
  const labels = [...new Set(kinds.filter((k): k is Exclude<RecordKind, 'milestone'> => k !== 'milestone').map((k) => RECORD_LABEL[k]))]
  if (!labels.length) return null
  return (
    <div className="set-records">
      <span className="sr-only">New record: </span>
      {labels.map((l) => <span key={l} className="pr-chip">{l}</span>)}
    </div>
  )
}

/**
 * Records grouped by the set that made them, newest first: the badges, the
 * exercise and set, and what it beat. `dates` adds the day; `exercise` false
 * leaves the name out (a list under one lift).
 */
export function RecordList({ records, units, dates = false, exercise = true, limit }: {
  records: PersonalRecord[]; units: UnitSystem; dates?: boolean; exercise?: boolean; limit?: number
}) {
  const groups = bySet(visibleRecords(records, units)).slice(0, limit)
  if (!groups.length) return null
  return (
    <ul className="record-list">
      {groups.map((g) => {
        const set = recordSet(g.first, units)
        const change = g.records.map((r) => recordChange(r, units)).filter(Boolean).join(' · ')
        return (
          <li key={g.key}>
            <div className="record-chips">
              {g.records.map((r) => <span key={r.kind + (r.milestone ?? '')} className={`pr-chip${r.kind === 'milestone' ? ' milestone' : ''}`}>{recordTitle(r)}</span>)}
              {dates && <span className="xs muted record-date">{monthDay(g.first.date)}</span>}
            </div>
            {(exercise && g.first.exercise) || set ? (
              <div className="small">
                {exercise && g.first.exercise && <b>{g.first.exercise}</b>}
                {exercise && g.first.exercise && set && ' · '}
                {set && <span className="num">{set}</span>}
              </div>
            ) : null}
            {change && <div className="xs muted">{change}</div>}
          </li>
        )
      })}
    </ul>
  )
}
