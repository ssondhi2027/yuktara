import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  Activity, BarChart3, CalendarCheck, ChevronDown, ClipboardList, Dumbbell, HeartPulse, LineChart, Lock, MessageSquare, Smartphone, Trophy, Utensils,
} from 'lucide-react'
import { startGuest } from '@/lib/auth'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { FAQ, PUBLIC_PAGES, SITE_NAME, TAGLINE } from './site'
import './public.css'

// three.js and the models (~6 MB) load on their own, after the page is up.
const HeroBodyCanvas = lazy(() => import('./HeroBodyCanvas'))

const page = PUBLIC_PAGES.find((p) => p.path === '/')!

const COACH_FEATURES = [
  { icon: ClipboardList, title: 'A weekly check-in queue', text: "Each client's week in one review: weight trend, workouts done, meals on plan, sleep and energy scores, photos and their answers. Reply, adjust targets and move to the next." },
  { icon: Dumbbell, title: 'Programs in minutes', text: "Start from a draft built from the client's answers, then edit: sets, reps, RPE, rest, supersets, drop sets and cardio. Save any program as a template." },
  { icon: Utensils, title: 'Targets and meal plans', text: 'Calories, protein, water, steps and sleep targets with start dates, meal plans by meal, and a side-by-side view of what was planned and what was eaten.' },
  { icon: LineChart, title: 'Signals, not spreadsheets', text: 'Weight forecasts with a likely range, plateaus, strength trends and personal records, so you see who needs attention first.' },
]

const CLIENT_FEATURES = [
  { icon: Activity, title: 'Log as you train', text: 'Weight, reps and RPE set by set, with warm-ups, drop sets and supersets; cardio by time and distance; "last time" for every lift.' },
  { icon: Trophy, title: 'Records that count', text: 'Weight, rep, 1RM, distance and pace PRs show up the moment you tick the set, plus milestones like a bodyweight bench or a first 5 km.' },
  { icon: Utensils, title: 'Meals without the busywork', text: "Log the coach's planned meal in one tap, or foods by amount with calories and macros, or a quick add with a photo." },
  { icon: BarChart3, title: 'Progress you can read', text: 'Weight, strength, cardio, food and habits over 4 weeks, 12 weeks or since you started, with plain-language insights.' },
]

const STEPS = [
  { title: 'The coach shares an invite code', text: 'Coaches create their account and get a code to send to clients.' },
  { title: 'The client joins and sets up', text: 'A two-minute setup: goal, experience, training days, diet and anything to work around.' },
  { title: 'Every week: log, check in, adjust', text: 'Workouts, meals and habits through the week, a check-in at the end, feedback and new targets from the coach.' },
]

/**
 * The public landing page at / for anyone not signed in (signed-in users see
 * their app there). Saved as finished HTML at build time (scripts/prerender.mjs).
 */
export function LandingPage() {
  useEffect(() => { document.title = page.title }, [])
  return (
    <div className="public">
      <PublicHeader />
      <main>
        <section className="public-hero">
          <div className="public-wrap hero-grid">
            <div>
              <p className="eyebrow">Coaching app for training and nutrition</p>
              <h1>Online coaching that keeps every week on track</h1>
              <p className="lead">
                {SITE_NAME} brings coach and client together on one plan: workouts, meals, habits and a weekly check-in,
                with progress both of you can see.
              </p>
              <div className="hero-actions">
                <Link to="/login" state={{ tab: 'register' }} className="btn btn-primary btn-lg">Create an account</Link>
                <GuestButton />
              </div>
              <p className="xs muted">Guest mode keeps everything on your device. No email needed.</p>
            </div>
            <HeroBody />
          </div>
        </section>

        <section className="public-section" aria-labelledby="coaches">
          <div className="public-wrap">
            <p className="eyebrow">For coaches</p>
            <h2 id="coaches">Run your coaching from one place</h2>
            <p className="section-lead">Less chasing, more coaching: your clients' training, food and check-ins arrive organised, with the numbers worked out.</p>
            <FeatureGrid items={COACH_FEATURES} />
          </div>
        </section>

        <section className="public-section alt" aria-labelledby="clients">
          <div className="public-wrap">
            <div className="section-split">
              <div>
                <p className="eyebrow">For clients</p>
                <h2 id="clients">Know what to do today, and see it working</h2>
                <p className="section-lead">Today's workout and meals at a glance, logging that takes seconds, and a body map of the muscles you trained this week.</p>
              </div>
              <WeekSample />
            </div>
            <FeatureGrid items={CLIENT_FEATURES} />
          </div>
        </section>

        <section className="public-section" aria-labelledby="how">
          <div className="public-wrap">
            <p className="eyebrow">How it works</p>
            <h2 id="how">Three steps to a coached week</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="step-n" aria-hidden="true">{i + 1}</span>
                  <div><h3>{s.title}</h3><p>{s.text}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="public-section alt" aria-labelledby="trust">
          <div className="public-wrap trust">
            <div className="trust-item"><Lock size={22} aria-hidden="true" /><div><h3 id="trust">Private by default</h3><p>Only you and your coach see your data. <Link to="/privacy">How your data is handled</Link></p></div></div>
            <div className="trust-item"><Smartphone size={22} aria-hidden="true" /><div><h3>Made for phones</h3><p>Works in the browser on any phone, tablet or computer; add it to your home screen.</p></div></div>
            <div className="trust-item"><HeartPulse size={22} aria-hidden="true" /><div><h3>Kilograms or pounds</h3><p>Everyone picks their own units; coach and client can differ.</p></div></div>
          </div>
        </section>

        <section className="public-section" aria-labelledby="faq">
          <div className="public-wrap faq-wrap">
            <p className="eyebrow">FAQ</p>
            <h2 id="faq">Questions</h2>
            <div className="faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary><span>{f.q}</span><ChevronDown size={20} className="faq-chevron" aria-hidden="true" /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="public-cta">
          <div className="public-wrap narrow">
            <h2>Start your next week with {SITE_NAME}</h2>
            <p>{TAGLINE}</p>
            <div className="hero-actions center">
              <Link to="/login" state={{ tab: 'register' }} className="btn btn-gold btn-lg">Create an account</Link>
              <Link to="/login" className="btn btn-outline btn-lg on-dark">Log in</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}

/** What the browser can do: WebGL, and whether data saving, a slow connection, a touch screen or reduced motion apply. */
function deviceFor3d(): { ok: boolean; dark: boolean; still: boolean; touch: boolean } {
  const mq = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  let webgl = false
  try {
    const c = document.createElement('canvas')
    webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    webgl = false
  }
  const theme = document.documentElement.getAttribute('data-theme')
  return {
    ok: webgl && !conn?.saveData && !/(^|-)2g$/.test(conn?.effectiveType ?? ''),
    dark: theme ? theme === 'dark' : mq('(prefers-color-scheme: dark)'),
    still: mq('(prefers-reduced-motion: reduce)'),
    touch: mq('(pointer: coarse)'),
  }
}

/**
 * The 3D body map with an example week. The pre-rendered page and the first
 * paint show a light placeholder; the model loads in the browser once the page
 * is idle, unless the device can't show it or the visitor saves data.
 */
function HeroBody() {
  const [device, setDevice] = useState<ReturnType<typeof deviceFor3d> | null>(null)
  useEffect(() => {
    const d = deviceFor3d()
    if (!d.ok) return
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setDevice(d), { timeout: 2500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(() => setDevice(d), 600)
    return () => window.clearTimeout(t)
  }, [])
  const placeholder = (
    <div className="hero-placeholder" aria-hidden="true">
      <BrandLogo size={72} />
      {device && <span className="xs muted">Loading the 3D body…</span>}
    </div>
  )
  return (
    <figure className="card hero-body" aria-label="3D body map coloured by an example week of training">
      <div className="hero-canvas">
        {device ? <Suspense fallback={placeholder}><HeroBodyCanvas dark={device.dark} still={device.still} touch={device.touch} /></Suspense> : placeholder}
      </div>
      <figcaption>
        <div className="hero-legend" aria-label="Hard sets this week">
          <span><i className="band high" />10 or more</span>
          <span><i className="band some" />1 to 9</span>
          <span><i className="band none" />None</span>
        </div>
        <p className="xs muted">The body map from the Train tab, coloured by an example week of training. {device?.touch ? 'Tap a muscle.' : 'Drag to turn; point at a muscle.'}</p>
        <p className="xs muted hero-credit">
          3D anatomy adapted from <a href="https://www.z-anatomy.com" target="_blank" rel="noreferrer">Z-Anatomy</a> and
          {' '}<a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">BodyParts3D</a> (DBCLS),
          {' '}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
        </p>
      </figcaption>
    </figure>
  )
}

function GuestButton() {
  const [starting, setStarting] = useState(false)
  return (
    <button type="button" className="btn btn-ghost btn-lg" disabled={starting}
      onClick={async () => { setStarting(true); try { await startGuest() } finally { setStarting(false) } }}>
      {starting ? 'Starting…' : 'Try without an account'}
    </button>
  )
}

function FeatureGrid({ items }: { items: { icon: typeof Activity; title: string; text: string }[] }) {
  return (
    <ul className="feature-grid">
      {items.map(({ icon: Icon, title, text }) => (
        <li key={title} className="card feature">
          <span className="feature-icon" aria-hidden="true"><Icon size={20} /></span>
          <h3>{title}</h3>
          <p>{text}</p>
        </li>
      ))}
    </ul>
  )
}

/** An illustration of a client's week (sample numbers, labelled as such). */
function WeekSample() {
  const days = [['M', 1], ['T', 1], ['W', 0.6], ['T', 1], ['F', 0.8], ['S', 1], ['S', 0]] as const
  return (
    <figure className="card week-sample" aria-label="Example of a client's week in Yuktara">
      <div className="between">
        <b>This week</b>
        <span className="xs muted">Example</span>
      </div>
      <ul className="sample-days" aria-hidden="true">
        {days.map(([d, v], i) => <li key={i}><i style={{ height: `${Math.max(8, v * 100)}%` }} /><span>{d}</span></li>)}
      </ul>
      <dl className="sample-stats">
        <div><dt>Workouts</dt><dd className="num">3 of 4</dd></div>
        <div><dt>Meals on plan</dt><dd className="num">17 of 20</dd></div>
        <div><dt>Weight trend</dt><dd className="num">−0.4 kg</dd></div>
      </dl>
      <div className="sample-pr"><Trophy size={16} aria-hidden="true" /> New record: Back squat, 82.5 kg × 6</div>
      <div className="sample-checkin"><CalendarCheck size={16} aria-hidden="true" /> Check-in sent · <MessageSquare size={14} aria-hidden="true" /> coach replied</div>
    </figure>
  )
}

export function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-wrap between">
        <Link to="/" className="public-brand" aria-label={`${SITE_NAME} home`}><BrandLogo size={36} /><span>{SITE_NAME}</span></Link>
        <nav aria-label="Account">
          <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-wrap between">
        <span className="small">© {SITE_NAME} · {TAGLINE}</span>
        <nav aria-label="Footer" className="row" style={{ gap: 16 }}>
          <Link to="/privacy" className="small">Privacy</Link>
          <Link to="/login" className="small">Log in</Link>
        </nav>
      </div>
    </footer>
  )
}
