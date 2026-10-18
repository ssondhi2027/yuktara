import { Lightbulb, TrendingUp, PauseCircle } from 'lucide-react'
import type { ProgressDetail } from '@/lib/api'
import { signalsFor, type Voice } from '@/lib/insights'
import type { UnitSystem } from '@/types/db'
import './signals.css'

/**
 * The Insights card: goal date and the next weeks (estimates), plateaus, and up
 * to three plain-language patterns. Same numbers for the client (Progress page)
 * and their coach (client view, check-in review), in the reader's unit.
 */
export function SignalsCard({ d, units, voice, className, title = 'Insights' }: { d: ProgressDetail; units: UnitSystem; voice: Voice; className?: string; title?: string }) {
  const s = signalsFor(d, units, voice)
  const anyData = d.weight.forecast.enough || d.strength.some((l) => l.forecast.enough)
  return (
    <section className={`card signals${className ? ` ${className}` : ''}`} aria-label={title}>
      <div className="card-head"><h3>{title}</h3><span className="pill awaiting xs">Estimates</span></div>

      {(s.goal || s.next) && (
        <div className="signal-row">
          <TrendingUp size={18} aria-hidden className="signal-icon" />
          <div>
            {s.goal && <p className="signal-main">{s.goal}</p>}
            {s.next && <p className="small muted">{s.next}</p>}
          </div>
        </div>
      )}

      {s.plateaus.length > 0 ? (
        <div className="signal-row">
          <PauseCircle size={18} aria-hidden className="signal-icon note" />
          <ul className="signal-list">{s.plateaus.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ) : anyData && <p className="small muted signal-quiet">No plateaus right now: weight and lifts are still moving.</p>}

      {s.insights.length > 0 ? (
        <div className="signal-row">
          <Lightbulb size={18} aria-hidden className="signal-icon" />
          <ul className="signal-list">{s.insights.map((i) => <li key={i.id} className={i.tone}>{i.text}</li>)}</ul>
        </div>
      ) : <p className="small muted signal-quiet">No clear patterns yet. They show up after a few more weeks of logs.</p>}

      <p className="xs muted signal-foot">
        Estimates from {voice === 'client' ? 'your' : 'the client’s'} own logs; ranges show where things will likely land. Patterns show what tends to go together, not what causes what.
      </p>
    </section>
  )
}
