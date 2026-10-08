import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { api, THREAD_REFRESH, type ChatMessage, type MessageThread } from '@/lib/api'
import { addDays, clockTime, localDay, monthDay, today } from '@/lib/dates'
import { Avatar } from '@/components/ui/Avatar'
import './messages.css'

const MAX = 2000

/**
 * One conversation (client ↔ coach), oldest first, scrolled to the newest.
 * clientId null = the signed-in client's own conversation. Polls every 5 s
 * while open and marks the other side's messages read.
 */
export function ThreadView({ clientId, checkinHref, back }: {
  clientId: string | null
  /** where a check-in feedback message links to */
  checkinHref: (checkInId: string) => string
  back?: React.ReactNode
}) {
  const qc = useQueryClient()
  const key = ['thread', clientId ?? 'me']
  const { data, error, isPending } = useQuery({ queryKey: key, queryFn: () => api.messageThread(clientId), ...THREAD_REFRESH })
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = data?.messages.at(-1)?.id
  const unread = !!data?.messages.some((m) => !m.from_me && !m.read_at)

  // Newest at the bottom: on open and whenever a message arrives.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId, isPending])

  // Opening the conversation (or a new message arriving in it) marks it read.
  useEffect(() => {
    if (!unread) return
    api.markThreadRead(clientId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['unread-messages'] })
        qc.invalidateQueries({ queryKey: ['conversations'] })
        qc.invalidateQueries({ queryKey: ['thread', clientId ?? 'me'] })
      })
      .catch(() => { /* tried again on the next poll */ })
  }, [unread, clientId, qc])

  if (isPending) return <div className="chat"><div className="skeleton" style={{ flex: 1 }} /></div>
  if (error) return <div className="chat"><p className="muted" role="alert">{error.message}</p></div>

  const other = data.other
  return (
    <div className="chat">
      <header className="chat-head">
        {back}
        {other && <Avatar person={other} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 className="chat-title truncate">{other ? other.full_name : 'Messages'}</h1>
          {other && <div className="xs muted">{clientId ? 'Your client' : 'Your coach'}</div>}
        </div>
      </header>

      {!other ? (
        <div className="chat-empty">
          <b>Messages open once you're linked to a coach</b>
          <p className="small muted">Your coach links your account with their invite code. Then you can chat here.</p>
        </div>
      ) : (
        <>
          <div className="chat-scroll" ref={scroller} aria-live="polite">
            {data.messages.length === 0 && <p className="chat-start small muted">No messages yet. Say hi to {other.first_name}.</p>}
            <Messages thread={data} checkinHref={checkinHref} />
          </div>
          {data.can_send && <Composer clientId={clientId} />}
        </>
      )}
    </div>
  )
}

function dayLabel(ts: string) {
  const d = localDay(ts)
  return d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : monthDay(d)
}

function Messages({ thread, checkinHref }: { thread: MessageThread; checkinHref: (id: string) => string }) {
  const lastMine = [...thread.messages].reverse().find((m) => m.from_me)
  return (
    <ol className="chat-list">
      {thread.messages.map((m, i) => {
        const prev = thread.messages[i - 1]
        const newDay = !prev || localDay(prev.created_at) !== localDay(m.created_at)
        return (
          <Fragment key={m.id}>
            {newDay && <li className="chat-day xs muted" aria-hidden>{dayLabel(m.created_at)}</li>}
            <Bubble m={m} checkinHref={checkinHref} seen={m === lastMine && !!m.read_at} />
          </Fragment>
        )
      })}
    </ol>
  )
}

function Bubble({ m, checkinHref, seen }: { m: ChatMessage; checkinHref: (id: string) => string; seen: boolean }) {
  return (
    <li className={`chat-msg ${m.from_me ? 'mine' : 'theirs'}${m.check_in ? ' is-feedback' : ''}`}>
      {m.check_in && (
        <div className="chat-feedback xs">
          Check-in feedback{m.check_in.week_start && ` · week of ${monthDay(m.check_in.week_start)}`} ·{' '}
          <Link to={checkinHref(m.check_in.id)}>View check-in</Link>
        </div>
      )}
      <div className="chat-bubble">{m.body}</div>
      <div className="chat-meta xs muted">
        {!m.from_me && <span>{m.sender.first_name} · </span>}
        <time dateTime={m.created_at}>{clockTime(m.created_at)}</time>
        {seen && <span> · Read</span>}
      </div>
    </li>
  )
}

function Composer({ clientId }: { clientId: string | null }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(clientId, body),
    onSuccess: (m) => {
      setText('')
      qc.setQueryData<MessageThread>(['thread', clientId ?? 'me'], (t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t))
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not send. Try again.'),
  })

  const submit = () => {
    if (send.isPending || !text.trim()) return
    setError(null)
    send.mutate(text)
  }

  return (
    <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); submit() }}>
      {error && (
        <div role="alert" className="chat-error small">
          {error} <button type="button" className="link" onClick={submit}>Retry</button>
        </div>
      )}
      <div className="chat-input-row">
        <textarea className="textarea chat-input" rows={1} maxLength={MAX} placeholder="Write a message" aria-label="Message"
          value={text} disabled={send.isPending}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }} />
        <button className="btn btn-primary chat-send" aria-label="Send" disabled={send.isPending || !text.trim()}>
          <Send size={18} />
        </button>
      </div>
      <div className="xs muted chat-hint">
        <span>Enter to send · Shift+Enter for a new line</span>
        {text.length > MAX - 200 && <span className={text.length >= MAX ? 'bad' : ''}>{text.length}/{MAX}</span>}
      </div>
    </form>
  )
}
