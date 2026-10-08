import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Search } from 'lucide-react'
import { api, UNREAD_REFRESH, type Conversation } from '@/lib/api'
import { clockTime, localDay, monthDay, today, weekday, addDays } from '@/lib/dates'
import { useLayout } from '@/app/hooks'
import { Avatar } from '@/components/ui/Avatar'
import { PageError, PageLoading } from '@/components/ui/Loading'
import { ThreadView } from '@/features/messages/ThreadView'
import '@/features/coach/review/review.css'
import '@/features/messages/messages.css'

/**
 * /coach/messages and /coach/messages/:clientId
 *  tablet and desktop — conversation list on the left, the open conversation on the right
 *  phone  — list, then the conversation as its own screen with a back link
 */
export function CoachMessagesPage() {
  const { clientId } = useParams()
  const layout = useLayout()
  const thread = (back?: React.ReactNode) => (
    <ThreadView key={clientId} clientId={clientId!} checkinHref={(id) => `/coach/check-ins/${id}`} back={back} />
  )

  if (layout === 'phone') {
    if (clientId) {
      return (
        <div className="page chat-page">
          {thread(<Link to="/coach/messages" className="back-link" aria-label="All conversations"><ChevronLeft size={20} /></Link>)}
        </div>
      )
    }
    return <div className="page"><ConversationList /></div>
  }

  return (
    <div className="split">
      <aside className="split-list"><ConversationList selected={clientId} /></aside>
      <div className="split-detail chat-detail">
        {clientId ? thread() : (
          <div className="chat-pick">
            <b>Pick a conversation</b>
            <p className="small muted">Messages from your clients show up on the left, newest first.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** "6:40 PM" today, "Sat" this week, else "Sep 28". */
function when(ts: string) {
  const d = localDay(ts)
  if (d === today()) return clockTime(ts)
  return d > addDays(today(), -7) ? weekday(d) : monthDay(d)
}

function ConversationList({ selected }: { selected?: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ['conversations'], queryFn: api.conversations, ...UNREAD_REFRESH })
  const [q, setQ] = useState('')
  if (isPending) return <PageLoading />
  if (error) return <PageError error={error} />

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = data.filter((c) => words.every((w) => c.client.full_name.toLowerCase().includes(w)))
  const unread = data.reduce((n, c) => n + c.unread, 0)

  return (
    <div className="stack convo-list">
      <header>
        <h1>Messages</h1>
        <div className="muted small">{unread ? `${unread} unread` : 'All caught up'}</div>
      </header>
      <label className="search">
        <Search size={16} />
        <input className="input" type="search" placeholder="Search clients" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {data.length === 0 && <p className="small muted">No clients yet. Share your invite code from the dashboard; conversations show up here.</p>}
      {data.length > 0 && list.length === 0 && <p className="small muted">No clients match "{q}".</p>}
      <ul className="list-plain" style={{ gap: 2 }}>
        {list.map((c) => <Row key={c.client.id} c={c} selected={c.client.id === selected} />)}
      </ul>
    </div>
  )
}

function Row({ c, selected }: { c: Conversation; selected: boolean }) {
  const preview = c.last
    ? `${c.last.from_me ? 'You: ' : ''}${c.last.feedback ? 'Check-in feedback: ' : ''}${c.last.body}`
    : 'No messages yet'
  return (
    <li>
      <Link to={`/coach/messages/${c.client.id}`} className={`convo${selected ? ' selected' : ''}${c.unread ? ' unread' : ''}`}
        aria-current={selected ? 'page' : undefined}>
        <Avatar person={c.client} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="convo-top">
            <b className="truncate">{c.client.full_name}</b>
            {c.last && <span className="xs muted">{when(c.last.created_at)}</span>}
          </div>
          <span className="convo-preview small muted truncate">{preview}</span>
        </div>
        {c.unread > 0 && <span className="badge" aria-label={`${c.unread} unread`}>{c.unread}</span>}
      </Link>
    </li>
  )
}
