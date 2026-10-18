import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, type CoachQuestion } from '@/lib/api'
import { setUnits } from '@/lib/auth'
import { WEEKDAY_LABEL } from '@/lib/labels'
import { nameProblem } from '@/lib/profile'
import type { AnswerType, UnitSystem } from '@/types/db'
import { useAuth } from '@/app/auth'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { InviteCode } from '@/features/coach/dashboard/DashboardPage'
import '@/features/coach/dashboard/dashboard.css'
import './settings.css'
import { AvatarUpload } from '@/components/ui/AvatarUpload'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const ANSWER_LABEL: Record<AnswerType, string> = { scale: 'Scale 1–5', number: 'Number', text: 'Text', yes_no: 'Yes / no' }

/** /coach/settings: profile, invite code, check-in questions, defaults. */
export function SettingsPage() {
  const { data, error, isPending } = useQuery({ queryKey: ['coach-settings'], queryFn: api.coachSettings })
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />
  return (
    <div className="page settings-page">
      <header className="page-head"><div><h1>Settings</h1><div className="sub">Your profile, invite code, weekly check-in questions and defaults.</div></div></header>
      <div className="stack" style={{ gap: 16 }}>
        <ProfileCard name={data.full_name} defaultDay={data.default_check_in_day} />
        <InviteCard code={data.invite_code} />
        <QuestionsCard />
      </div>
    </div>
  )
}

function ProfileCard({ name, defaultDay }: { name: string; defaultDay: number }) {
  const qc = useQueryClient()
  const { user, refresh } = useAuth()
  const [fullName, setFullName] = useState(name)
  const [day, setDay] = useState(defaultDay)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: () => api.saveCoachSettings({ full_name: fullName, default_check_in_day: day }),
    onSuccess: async () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['coach-settings'] })
      await refresh() // the name in the sidebar and menus
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })
  const units = useMutation({ mutationFn: (u: UnitSystem) => setUnits(u) })

  return (
    <form className="card stack" style={{ gap: 14 }} noValidate onSubmit={(e) => {
      e.preventDefault()
      const p = nameProblem(fullName)
      setProblem(p)
      setSaved(false)
      if (!p) save.mutate()
    }}>
      <h2>Profile and defaults</h2>
      {user && <AvatarUpload person={user} />}
      <div className="settings-grid">
        <div className="field">
          <label htmlFor="coach-name">Your name</label>
          <input id="coach-name" className="input" value={fullName} maxLength={80} onChange={(e) => { setFullName(e.target.value); setSaved(false) }} />
          <span className="xs muted">Clients see this on their Home and in Messages.</span>
        </div>
        <div className="field">
          <label htmlFor="coach-day">Check-in day for new clients</label>
          <select id="coach-day" className="input" value={day} onChange={(e) => { setDay(Number(e.target.value)); setSaved(false) }}>
            {DAY_ORDER.map((d) => <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>)}
          </select>
          <span className="xs muted">New sign-ups with your code start on this day. Change a client's day on their Clients page.</span>
        </div>
        <div className="field">
          <span className="label-like">Weights</span>
          <div className="seg" role="group" aria-label="Weight units">
            {(['imperial', 'metric'] as UnitSystem[]).map((u) => (
              <button key={u} type="button" aria-pressed={user?.units === u} disabled={units.isPending} onClick={() => user?.units !== u && units.mutate(u)}>
                {u === 'imperial' ? 'lb' : 'kg'}
              </button>
            ))}
          </div>
          <span className="xs muted">How you see your clients' weights. Same as the avatar menu.</span>
        </div>
      </div>
      {problem && <div role="alert" className="auth-note err">{problem}</div>}
      {saved && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>Saved.</div>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
    </form>
  )
}

function InviteCard({ code }: { code: string | null }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const rotate = useMutation({
    mutationFn: api.rotateInviteCode,
    onSuccess: () => {
      setConfirming(false)
      qc.invalidateQueries({ queryKey: ['coach-settings'] })
      qc.invalidateQueries({ queryKey: ['coach-dashboard'] })
    },
  })
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <h2>Invite code</h2>
      <p className="small muted">New clients enter it when they sign up, which links them to you.</p>
      <InviteCode code={code} />
      {!confirming ? (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirming(true)}>
          <RefreshCw size={16} /> Make a new code
        </button>
      ) : (
        <div className="auth-note err" role="alert">
          <p style={{ margin: '0 0 8px' }}>The current code stops working straight away. Anyone you've already sent it to needs the new one. Existing clients aren't affected.</p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={rotate.isPending} onClick={() => rotate.mutate()}>{rotate.isPending ? 'Making…' : 'Yes, make a new code'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Keep the current one</button>
          </div>
        </div>
      )}
      {rotate.isSuccess && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>New code ready. The old one no longer works.</div>}
      {rotate.error && <div role="alert" className="auth-note err">{rotate.error.message}</div>}
    </section>
  )
}

function QuestionsCard() {
  const qc = useQueryClient()
  const { data, error, isPending } = useQuery({ queryKey: ['coach-questions'], queryFn: api.coachQuestions })
  const [list, setList] = useState<CoachQuestion[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (data && !list) setList(data) }, [data, list])

  const save = useMutation({
    mutationFn: (qs: CoachQuestion[]) => api.saveQuestions(qs),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['coach-questions'] })
      setList(null) // reload with ids and answer counts
      setSaved(true)
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : 'Could not save. Try again.'),
  })

  if (isPending || !list) return <section className="card"><div className="skeleton" style={{ height: 160 }} /></section>
  if (error) return <PageError error={error} />
  const change = (i: number, patch: Partial<CoachQuestion>) => { setList(list.map((q, k) => (k === i ? { ...q, ...patch } : q))); setSaved(false) }
  const move = (i: number, d: -1 | 1) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x); setList(next); setSaved(false) }

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="between"><h2>Weekly check-in questions</h2><span className="xs muted">{list.filter((q) => q.is_active).length} on</span></div>
      <p className="small muted">Your own questions, asked in every client's weekly check-in after the standard ones, in this order.</p>
      <ol className="question-list">
        {list.map((q, i) => (
          <li key={q.id ?? `new-${i}`} className={`question-row${q.is_active ? '' : ' off'}`}>
            <div className="question-fields">
              <label className="sr-only" htmlFor={`q-${i}`}>Question {i + 1}</label>
              <input id={`q-${i}`} className="input" maxLength={200} placeholder="e.g. How was your energy this week?" value={q.prompt} onChange={(e) => change(i, { prompt: e.target.value })} />
              <select className="input" aria-label={`Answer type for question ${i + 1}`} value={q.answer_type} disabled={q.answers > 0}
                title={q.answers > 0 ? 'Clients have answered this one, so its type stays' : undefined}
                onChange={(e) => change(i, { answer_type: e.target.value as AnswerType })}>
                {(Object.keys(ANSWER_LABEL) as AnswerType[]).map((t) => <option key={t} value={t}>{ANSWER_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="question-actions">
              <label className="checkbox small"><input type="checkbox" checked={q.is_active} onChange={(e) => change(i, { is_active: e.target.checked })} /> On</label>
              <button type="button" className="icon-btn sm" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon-btn sm" aria-label={`Move question ${i + 1} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
              {q.answers > 0
                ? <span className="xs muted" title="Old answers stay readable; turn it off instead">{q.answers} answers</span>
                : <button type="button" className="icon-btn sm" aria-label={`Delete question ${i + 1}`} onClick={() => { setList(list.filter((_, k) => k !== i)); setSaved(false) }}><Trash2 size={15} /></button>}
            </div>
          </li>
        ))}
      </ol>
      {list.length === 0 && <p className="small muted">No questions yet. Check-ins still ask about weight, measurements, energy, sleep, stress, hunger, wins and struggles.</p>}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => { setList([...list, { id: null, prompt: '', answer_type: 'scale', is_active: true, answers: 0 }]); setSaved(false) }}>
        <Plus size={16} /> Add a question
      </button>
      {problem && <div role="alert" className="auth-note err">{problem}</div>}
      {saved && <div role="status" className="auth-note ok" style={{ marginTop: 0 }}>Saved. Clients see these in their next check-in.</div>}
      <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={save.isPending} onClick={() => {
        const empty = list.findIndex((q) => !q.prompt.trim())
        if (empty >= 0) return setProblem(`Question ${empty + 1} needs some text.`)
        setProblem(null)
        save.mutate(list)
      }}>
        {save.isPending ? 'Saving…' : 'Save questions'}
      </button>
    </section>
  )
}
