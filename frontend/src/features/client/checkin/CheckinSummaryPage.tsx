import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { clockTime, localDay, monthDay } from '@/lib/dates'
import { bodyWeight, inches } from '@/lib/units'
import { useUnits } from '@/app/auth'
import { PageError, PageLoading } from '@/components/ui/Loading'

const STATUS = { due: 'Open', submitted: 'Sent, waiting for feedback', reviewed: 'Reviewed', missed: 'Missed' } as const

/** /check-in/:id: a past check-in as the client sent it, with the coach's feedback. Read-only. */
export function CheckinSummaryPage() {
  const { id = '' } = useParams()
  const { data: c, error, isPending } = useQuery({ queryKey: ['checkin-summary', id], queryFn: () => api.checkinSummary(id) })
  const units = useUnits()
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />

  const rows: [string, string | null][] = [
    ['Average weight', c.avg_weight_kg != null ? bodyWeight(c.avg_weight_kg, units) : null],
    ['Waist', c.waist_cm != null ? inches(c.waist_cm) : null],
    ['Hips', c.hips_cm != null ? inches(c.hips_cm) : null],
    ['Energy', c.energy != null ? `${c.energy} of 5` : null],
    ['Sleep', c.sleep != null ? `${c.sleep} of 5` : null],
    ['Stress', c.stress != null ? `${c.stress} of 5` : null],
    ['Hunger', c.hunger != null ? `${c.hunger} of 5` : null],
    ['Wins', c.wins],
    ['Struggles', c.struggles],
    ['Your question', c.question],
  ]

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <Link to="/messages" className="back-link"><ChevronLeft size={18} /> Messages</Link>
      <header className="page-head" style={{ marginTop: 8 }}>
        <div>
          <div className="page-date">{STATUS[c.status]}{c.submitted_at && ` · sent ${monthDay(localDay(c.submitted_at))}`}</div>
          <h1>Check-in · week of {monthDay(c.week_start)}</h1>
        </div>
      </header>
      <div className="stack" style={{ gap: 16 }}>
        <section className="card">
          <div className="card-head"><h2>Coach feedback</h2></div>
          {c.feedback.length === 0
            ? <p className="small muted">No feedback yet. It shows up here and in Messages.</p>
            : c.feedback.map((m) => (
              <div key={m.id} className="stack" style={{ gap: 4 }}>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                <span className="xs muted">{m.sender.first_name} · {monthDay(localDay(m.created_at))}, {clockTime(m.created_at)}</span>
              </div>
            ))}
        </section>
        <section className="card">
          <div className="card-head"><h2>What you sent</h2></div>
          <ul className="list-rows">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <li key={k} className="between" style={{ alignItems: 'flex-start', gap: 16 }}>
                <span className="small muted">{k}</span>
                <span className="small" style={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}>{v}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
