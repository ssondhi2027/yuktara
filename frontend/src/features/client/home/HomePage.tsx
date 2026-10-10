import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, ClipboardCheck, Droplet, Footprints, MessageSquare, Moon, Plus, Scale, Send, Sparkles, X } from 'lucide-react'
import { api, type ClientHome } from '@/lib/api'
import { useLayout } from '@/app/hooks'
import { greeting, longDay, monthDay, shortDay, weekday, parseDate, weekRange } from '@/lib/dates'
import { delta, hoursMinutes, int, litres } from '@/lib/units'
import { DayRing } from '@/components/charts/DayRing'
import { LineChart } from '@/components/charts/LineChart'
import { MacroBar } from '@/components/ui/MacroBar'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ProfileMenu } from '@/components/layout/ProfileMenu'
import { useUnreadMessages } from '@/features/messages/useUnreadMessages'
import { HabitSheet } from './HabitSheet'
import './home.css'

export function ClientHomePage() {
  const { data, error, isPending } = useQuery({ queryKey: ['client-home'], queryFn: api.clientHome })
  const layout = useLayout()
  const [habitsOpen, setHabitsOpen] = useState(false)
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />

  const phone = layout === 'phone'
  const desktop = layout === 'desktop'
  const h = data
  const logHabits = () => setHabitsOpen(true)
  const weekLabel = `Week ${h.program.week}${h.program.weeks ? ` of ${h.program.weeks}` : ''}`

  return (
    <div className="page home">
      <header className="page-head">
        <div>
          <div className="page-date">
            {desktop ? longDay(h.today) : shortDay(h.today)} · {weekLabel}
            {h.program.start_date === h.today && ' · Day 1'}
          </div>
          <h1>{greeting()}, {h.me.first_name}</h1>
        </div>
        {phone ? (
          <div className="row">
            <MessagesButton />
            <ProfileMenu />
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn btn-outline" onClick={logHabits}>Log today</button>
            <Link to="/food" className="btn btn-outline">Log a meal</Link>
            {h.workout && <Link to="/train" className="btn btn-primary">Start workout</Link>}
          </div>
        )}
      </header>

      <Welcome h={h} />
      {phone && <WeekHero h={h} />}
      <CheckinBanner h={h} wide={!phone} />
      {!phone && <WeekStrip h={h} desktop={desktop} />}

      <div className="home-grid">
        <WorkoutCard h={h} compact={phone} desktop={desktop} />
        <FoodCard h={h} compact={phone} desktop={desktop} />
        {!phone && <WeightCard h={h} desktop={desktop} onLog={logHabits} />}
        {!phone && <CoachNoteCard h={h} desktop={desktop} />}
        {desktop && <HabitsCard h={h} onLog={logHabits} />}
        {desktop && <BestsCard h={h} />}
      </div>

      {phone && <HabitTiles h={h} onLog={logHabits} />}
      {phone && <CoachNoteCard h={h} desktop={false} />}

      {habitsOpen && <HabitSheet date={h.today} habits={h.habits} onClose={() => setHabitsOpen(false)} />}
    </div>
  )
}

/** First days only: what happens next, instead of empty numbers. */
function Welcome({ h }: { h: ClientHome }) {
  const waitingOnCoach = !h.food.targets || !h.program.has_program
  if (h.program.week > 1 || !waitingOnCoach) return null
  return (
    <section className="card welcome">
      <span className="welcome-icon"><Sparkles size={20} /></span>
      <div className="grow">
        <b>{h.program.start_date === h.today ? 'Welcome to Yuktara. Today is day 1.' : 'Your first week is under way.'}</b>
        <p className="small muted">
          {h.coach
            ? `${h.coach.first_name} is setting up your plan and targets. Until then, log your meals, steps, water, sleep and morning weight.`
            : "You're not linked to a coach yet. Ask your coach for their invite code. Meanwhile, log your meals and habits."}
          {h.check_in.next_date && ` Your first check-in opens ${weekday(h.check_in.next_date)}, ${monthDay(h.check_in.next_date)}.`}
        </p>
      </div>
    </section>
  )
}

function WeekHero({ h }: { h: ClientHome }) {
  const t = h.food.targets
  return (
    <section className="card dark week-hero" aria-label="This week">
      <DayRing days={h.days} size={168} />
      <div className="grow">
        <div className="eyebrow" style={{ color: 'inherit', opacity: 0.8 }}>This week</div>
        <dl className="hero-stats">
          <dt>Workouts</dt><dd>{h.week.workouts_planned ? `${h.week.workouts_done} of ${h.week.workouts_planned}` : h.week.workouts_done || '—'}</dd>
          <dt>Meals on plan</dt><dd>{h.week.meals_on_plan} of {h.week.meals_planned}</dd>
          <dt>Avg protein</dt><dd>{h.week.avg_protein_g ?? '—'}{t ? `/${t.protein_g}` : ''} g</dd>
        </dl>
      </div>
    </section>
  )
}

function CheckinBanner({ h, wide }: { h: ClientHome; wide: boolean }) {
  const c = h.check_in
  if (c.status === 'none') {
    if (!c.next_date || h.program.week === 1) return null // the welcome card already says when
    return (
      <section className="banner soft">
        <span className="banner-icon"><ClipboardCheck size={20} /></span>
        <div className="grow">
          <b>Next check-in {weekday(c.next_date)}, {monthDay(c.next_date)}</b>
          <div className="small">Keep logging: your training and food numbers fill it in.</div>
        </div>
      </section>
    )
  }
  if (c.status !== 'due') {
    return (
      <section className="banner done">
        <span className="banner-icon"><Check size={20} /></span>
        <div className="grow">
          <b>Check-in sent</b>
          <div className="small">{h.coach ? `${h.coach.first_name} usually replies within a day.` : 'Your coach will reply here.'}</div>
        </div>
      </section>
    )
  }
  return (
    <section className="banner">
      <span className="banner-icon"><ClipboardCheck size={20} /></span>
      <div className="grow">
        <b className="banner-title">{wide ? 'Weekly check-in is open' : 'Check-in is open'}</b>
        <div className="banner-sub">
          {wide ? `Training and food numbers are already filled in. About ${c.minutes} minutes.` : `About ${c.minutes} minutes`}
        </div>
      </div>
      <Link to="/check-in" className="btn btn-primary btn-lg banner-btn" style={{ background: '#123A2B', color: '#fff' }}>
        {wide ? 'Start check-in' : 'Start'}
      </Link>
    </section>
  )
}

function WeekStrip({ h, desktop }: { h: ClientHome; desktop: boolean }) {
  const monday = h.days[0].date
  const logged = h.days.filter((d) => d.logged).length
  return (
    <section className="card">
      <div className="card-head">
        <h2>This week</h2>
        <span className="muted small">
          {weekRange(monday)} · {logged} of 7 days logged
          {desktop && h.week.workouts_planned > 0 && ` · ${h.week.workouts_done} of ${h.week.workouts_planned} workouts`}
          {desktop && ` · ${h.week.meals_on_plan} of ${h.week.meals_planned} meals on plan`}
        </span>
      </div>
      <ol className="week-strip">
        {h.days.map((d) => {
          const beforeStart = d.date < h.program.start_date
          return (
            <li key={d.date} className={[d.is_today && 'today', beforeStart && 'before-start'].filter(Boolean).join(' ') || undefined}>
              <div className="small day-name">{d.is_today ? 'Today' : `${weekday(d.date)}${desktop ? ` ${parseDate(d.date).getDate()}` : ''}`}</div>
              {!desktop && <div className="num day-num">{parseDate(d.date).getDate()}</div>}
              {beforeStart ? (
                <div className="small faint">Before day 1</div>
              ) : (
                <>
                  {(d.workout || h.program.has_program) && (
                    <div className={`day-workout ${d.workout?.status ?? 'rest'}`}>
                      {d.workout?.status === 'done' && <Check size={14} />}
                      {d.workout?.status === 'skipped' && <X size={14} />}
                      <span>
                        {d.workout ? d.workout.name : 'Rest day'}
                        {d.workout?.status === 'skipped' && (desktop ? ' skipped' : '')}
                      </span>
                    </div>
                  )}
                  {d.workout?.status === 'skipped' && !desktop && <div className="day-workout skipped"><span>Skipped</span></div>}
                  <div className="small">{d.meals_on_plan}/{d.meals_planned} meals{desktop ? ' on plan' : ''}</div>
                  <div className="small faint">
                    {d.steps == null ? '— steps' : `${desktop ? int(d.steps) : `${(d.steps / 1000).toFixed(1)}k`} steps`}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function WorkoutCard({ h, compact, desktop }: { h: ClientHome; compact: boolean; desktop: boolean }) {
  const w = h.workout
  if (!w) {
    return (
      <section className="card">
        <div className="muted small">Today's workout</div>
        {h.program.has_program ? (
          <>
            <h3 style={{ marginTop: 6 }}>Rest day</h3>
            <p className="muted small" style={{ marginTop: 6 }}>Walk, stretch, and hit your step target.</p>
          </>
        ) : (
          <>
            <h3 style={{ marginTop: 6 }}>{h.program.next ? 'Plan starts soon' : 'No plan yet'}</h3>
            <p className="muted small" style={{ marginTop: 6 }}>
              {h.program.next
                ? `${h.program.next.name} starts ${weekday(h.program.next.start_date)}, ${monthDay(h.program.next.start_date)}.`
                : h.coach ? `${h.coach.first_name} is setting up your training plan.` : 'Your coach will set up your training plan.'}
            </p>
          </>
        )}
      </section>
    )
  }
  const minutes = w.duration_min ? ` · ${w.duration_min} min` : ''
  if (compact) {
    return (
      <section className="card workout-mini">
        <div className="muted small">Today's workout</div>
        <h3 className="workout-name">{w.name}</h3>
        <div className="muted small">{w.exercises.length} exercises{minutes}</div>
        <ul className="mini-list">
          {w.exercises.slice(0, 2).map((e) => (
            <li key={e.name}>{e.name} <span className="muted">{e.sets} × {e.reps}</span></li>
          ))}
          {w.exercises.length > 2 && <li className="muted">+ {w.exercises.length - 2} more</li>}
        </ul>
        <Link to="/train" className="btn btn-primary btn-lg btn-block">Start workout</Link>
      </section>
    )
  }
  return (
    <section className="card">
      <div className="card-head">
        <h3>{desktop ? `Today: ${w.name}` : w.name}</h3>
        {w.duration_min && <span className="muted small">{w.duration_min} min</span>}
      </div>
      <ul className="list-rows exercise-rows">
        {w.exercises.map((e) => (
          <li key={e.name} className="between">
            <span>{e.name}</span>
            <span className="muted small">
              {e.sets} × {e.reps}{e.weight_kg ? ` · ${e.weight_kg} kg` : ''}{e.note ? ` ${e.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/train" className="btn btn-primary btn-block btn-square" style={{ marginTop: 14 }}>Start workout</Link>
    </section>
  )
}

function FoodCard({ h, compact, desktop }: { h: ClientHome; compact: boolean; desktop: boolean }) {
  const f = h.food
  const t = f.targets
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => f.meals.reduce((a, m) => a + m[k], 0)
  const onPlan = f.meals.filter((m) => m.on_plan === 'yes').length
  const missing = f.planned.find((p) => !f.meals.some((m) => m.meal_type === p))
  const waiting = !t && <p className="small muted waiting-note">Waiting for {h.coach ? h.coach.first_name : 'your coach'} to set your calorie and macro targets.</p>

  if (compact) {
    return (
      <section className="card">
        <div className="muted small">Food today</div>
        <div className="kcal"><b className="num">{int(sum('calories'))}</b> <span className="muted">{t ? `/ ${int(t.calories)} ` : ''}kcal</span></div>
        {t ? (
          <div className="stack" style={{ gap: 8 }}>
            <MacroBar label="Protein" value={sum('protein_g')} target={t.protein_g} color="var(--macro-p)" />
            <MacroBar label="Carbs" value={sum('carbs_g')} target={t.carbs_g} color="var(--macro-c)" />
            <MacroBar label="Fat" value={sum('fat_g')} target={t.fat_g} color="var(--macro-f)" />
          </div>
        ) : waiting}
        <Link to="/food" className="btn btn-outline btn-lg btn-block" style={{ marginTop: 14 }}>Log a meal</Link>
      </section>
    )
  }
  return (
    <section className="card">
      <div className="card-head">
        <h3>Food today</h3>
        {f.meals.length > 0 && <span className="small good" style={{ fontWeight: 600 }}>{onPlan} of {f.meals.length} on plan</span>}
      </div>
      <div className="kcal"><b className="num">{int(sum('calories'))}</b> <span className="muted">{t ? `of ${int(t.calories)} ` : ''}kcal</span></div>
      {t ? (
        <div className="grid grid-3" style={{ gap: 12 }}>
          <MacroBar layout="stacked" label="Protein" value={sum('protein_g')} target={t.protein_g} color="var(--macro-p)" />
          <MacroBar layout="stacked" label="Carbs" value={sum('carbs_g')} target={t.carbs_g} color="var(--macro-c)" />
          <MacroBar layout="stacked" label="Fat" value={sum('fat_g')} target={t.fat_g} color="var(--macro-f)" />
        </div>
      ) : waiting}
      {f.meals.length === 0 ? (
        <p className="small muted" style={{ marginTop: 12 }}>No meals logged today.</p>
      ) : (
        <ul className="list-rows" style={{ marginTop: 12 }}>
          {f.meals.map((m) => (
            <li key={m.id} className="between">
              <span className="truncate">{desktop ? `${cap(m.meal_type)} · ${m.title}` : m.title}</span>
              <span className="muted">{m.calories}</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/food" className="btn btn-ghost btn-block btn-square" style={{ marginTop: 10 }}>
        {desktop ? <Plus size={18} /> : <Camera size={18} />}
        {missing ? (desktop ? `Add ${missing}` : `Snap ${missing}`) : 'Log a meal'}
      </Link>
    </section>
  )
}

function WeightCard({ h, desktop, onLog }: { h: ClientHome; desktop: boolean; onLog: () => void }) {
  const w = h.weight
  const hasPoints = w.points.some((p) => p.kg != null)
  return (
    <section className="card">
      <div className="card-head">
        <h3>Weight</h3>
        {w.change != null && (
          <span className="small good" style={{ fontWeight: 600 }}>{delta(w.change)} since {monthDay(w.start_date)}</span>
        )}
      </div>
      {!hasPoints ? (
        <div className="empty-block">
          <p className="small muted">No weigh-ins yet. Weigh yourself in the morning, before breakfast, and log it here.</p>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onLog}><Scale size={16} /> Log weight</button>
        </div>
      ) : (
        <>
          {desktop && (
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 8 }}>
              {w.current != null && <b className="num" style={{ fontSize: 30 }}>{w.current} kg</b>}
              {w.goal != null && <span className="small good" style={{ fontWeight: 600 }}>Goal {w.goal} kg</span>}
            </div>
          )}
          <LineChart
            points={w.points}
            goal={desktop || w.goal == null ? undefined : w.goal}
            area={desktop}
            height={desktop ? 150 : 170}
            goalLabel={desktop || w.goal == null ? undefined : `Goal ${w.goal} kg`}
            valueLabel={desktop || w.current == null ? undefined : `${w.current} kg`}
          />
          {desktop && <p className="xs muted" style={{ marginTop: 10 }}>Weekly averages of your morning weigh-ins.</p>}
        </>
      )}
    </section>
  )
}

function CoachNoteCard({ h, desktop }: { h: ClientHome; desktop: boolean }) {
  const n = h.coach_note
  if (!n) {
    return (
      <section className="card dark coach-note">
        {h.coach ? (
          <>
            <div className="row">
              <span className="avatar gold">{h.coach.initials}</span>
              <b>{h.coach.first_name}, your coach</b>
            </div>
            <p className="small muted">Feedback on your check-ins will show up here.</p>
            <Link to="/messages" className="btn btn-outline btn-square" style={{ alignSelf: 'flex-start' }}>Message {h.coach.first_name}</Link>
          </>
        ) : (
          <>
            <b>No coach linked yet</b>
            <p className="small muted">Your coach links your account with their invite code.</p>
          </>
        )}
      </section>
    )
  }
  return (
    <section className="card dark coach-note">
      <div className="row">
        <span className="avatar gold">{n.coach.initials}</span>
        <div>
          <b>{n.coach.first_name}, your coach</b>
          <div className="small muted">{n.title} · {n.date}</div>
        </div>
      </div>
      <p className="coach-body">{n.body}</p>
      {desktop ? (
        <QuickReply coachName={n.coach.first_name} />
      ) : (
        <Link to="/messages" className="btn btn-outline btn-square" style={{ alignSelf: 'flex-start' }}>Reply</Link>
      )}
    </section>
  )
}

/** Phone header: Messages, with a dot while something is unread. */
function MessagesButton() {
  const unread = useUnreadMessages()
  return (
    <Link to="/messages" className="icon-btn" style={{ position: 'relative' }} aria-label={unread ? `Messages, ${unread} unread` : 'Messages'}>
      <MessageSquare size={20} />
      {unread > 0 && <span className="unread-dot" style={{ top: 6, right: 6 }} />}
    </Link>
  )
}

/** Desktop coach card: send a message without leaving Home. */
function QuickReply({ coachName }: { coachName: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(null, body),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['thread', 'me'] })
    },
  })
  return (
    <form className="reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text) }}>
      <label className="small muted" htmlFor="reply">Message {coachName}</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="reply" className="input dark-input" maxLength={2000} placeholder="Write a message" value={text}
          disabled={send.isPending} onChange={(e) => { setText(e.target.value); send.reset() }} />
        <button className="btn btn-gold btn-square" style={{ width: 44, padding: 0 }} aria-label="Send" disabled={send.isPending || !text.trim()}><Send size={18} /></button>
      </div>
      {send.isSuccess && <span className="xs muted">Sent. <Link to="/messages" style={{ color: 'inherit' }}>Open the conversation</Link></span>}
      {send.error && <span role="alert" className="xs" style={{ color: 'var(--gold)' }}>{send.error.message}</span>}
    </form>
  )
}

function HabitsCard({ h, onLog }: { h: ClientHome; onLog: () => void }) {
  const t = h.food.targets
  const x = h.habits
  const rows = [
    { label: 'Steps', value: x.steps_avg == null ? '—' : int(x.steps_avg), target: t?.steps ? int(t.steps) : null, pct: x.steps_avg != null && t?.steps ? x.steps_avg / t.steps : null },
    { label: 'Water', value: x.water_ml_avg == null ? '—' : litres(x.water_ml_avg), target: t?.water_ml ? litres(t.water_ml) : null, pct: x.water_ml_avg != null && t?.water_ml ? x.water_ml_avg / t.water_ml : null },
    { label: 'Sleep', value: x.sleep_avg == null ? '—' : hoursMinutes(x.sleep_avg, true), target: t?.sleep_h ? hoursMinutes(t.sleep_h, true) : null, pct: x.sleep_avg != null && t?.sleep_h ? x.sleep_avg / t.sleep_h : null },
  ]
  return (
    <section className="card">
      <div className="card-head">
        <h3>Habits, 7-day average</h3>
        <button type="button" className="link small" onClick={onLog}>Log today</button>
      </div>
      <div className="stack" style={{ gap: 14 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="between small"><span>{r.label}</span><span><b>{r.value}</b>{r.target && <span className="muted"> / {r.target}</span>}</span></div>
            <div className="bar" style={{ marginTop: 6 }}>
              {r.pct != null && <span style={{ width: `${Math.min(100, r.pct * 100)}%`, background: r.pct < 0.93 ? 'var(--orange)' : 'var(--green)' }} />}
            </div>
          </div>
        ))}
      </div>
      {x.note && <p className="small muted" style={{ marginTop: 14 }}>{x.note}</p>}
    </section>
  )
}

function BestsCard({ h }: { h: ClientHome }) {
  return (
    <section className="card">
      <h3 style={{ marginBottom: 6 }}>Personal bests</h3>
      {h.bests.length === 0 ? (
        <p className="small muted">Your best lifts show up here once you log workouts.</p>
      ) : (
        <>
          <ul className="list-rows">
            {h.bests.map((b) => (
              <li key={b.exercise} className="between small">
                <span>{b.exercise} · {b.reps} reps</span>
                <span><b>{b.kg} kg</b> <span className="good">{delta(b.change, '')}</span></span>
              </li>
            ))}
          </ul>
          <p className="xs muted" style={{ marginTop: 8 }}>Change since your first session.</p>
        </>
      )}
    </section>
  )
}

function HabitTiles({ h, onLog }: { h: ClientHome; onLog: () => void }) {
  const t = h.food.targets
  const x = h.habits
  const tiles = [
    { icon: <Footprints size={20} className="good" />, value: x.steps_today == null ? '—' : int(x.steps_today), sub: t?.steps ? `of ${int(t.steps)} steps` : 'steps today' },
    { icon: <Droplet size={20} className="good" />, value: x.water_ml_today == null ? '—' : litres(x.water_ml_today), sub: t?.water_ml ? `of ${litres(t.water_ml)} water` : 'water today' },
    { icon: <Moon size={20} className="good" />, value: x.sleep_last_night == null ? '—' : hoursMinutes(x.sleep_last_night), sub: 'sleep last night' },
    { icon: <Scale size={20} className="good" />, value: x.weight_today == null ? '—' : `${x.weight_today} kg`, sub: 'weight today' },
  ]
  return (
    <div className="habit-tiles four">
      {tiles.map((tile) => (
        <button key={tile.sub} type="button" className="card tile-card" onClick={onLog} aria-label={`Log ${tile.sub}`}>
          {tile.icon}<b className="num">{tile.value}</b><span className="small muted">{tile.sub}</span>
        </button>
      ))}
    </div>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
