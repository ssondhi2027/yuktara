// Live messaging for both apps. One conversation per client (messages.client_id);
// RLS (0007, 0014) limits it to the client and their coach, makes sender_id the
// caller, and lets only the recipient set read_at. A trigger rate-limits sending.

import type { ChatMessage, CheckinSummary, Conversation, MessageThread, Person } from '../api'
import { ApiError } from '../backend'
import { db, must, myId, person } from './shared'

const MESSAGE_COLS = 'id, body, created_at, sender_id, check_in_id, read_at, check_ins(week_start)'
const THREAD_LIMIT = 300

function toMessage(r: any, me: string, people: Map<string, Person>): ChatMessage {
  return {
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    from_me: r.sender_id === me,
    // A previous coach isn't visible to the client any more (users RLS).
    sender: people.get(r.sender_id) ?? person(r.sender_id, 'Coach'),
    check_in: r.check_in_id ? { id: r.check_in_id, week_start: r.check_ins?.week_start ?? '' } : null,
    read_at: r.read_at,
  }
}

async function people(ids: (string | null)[]): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))]
  const rows = must(await db().from('users').select('id, full_name').in('id', list)) as { id: string; full_name: string }[]
  return new Map(rows.map((u) => [u.id, person(u.id, u.full_name)]))
}

/** Who's in the conversation: the client and the coach the caller can message. */
async function members(clientId: string | null) {
  const me = await myId()
  if (!clientId || clientId === me) {
    const prof: any = must(await db().from('client_profiles').select('coach_id').eq('user_id', me).maybeSingle())
    return { me, client: me, coach: (prof?.coach_id as string | null) ?? null, iAmClient: true }
  }
  // Column list on purpose: coach_notes is hidden from select *.
  const prof = must(await db().from('client_profiles').select('user_id').eq('user_id', clientId).eq('coach_id', me).maybeSingle())
  if (!prof) throw new ApiError(404, "That client isn't one of yours.")
  return { me, client: clientId, coach: me, iAmClient: false }
}

async function thread(clientId: string | null): Promise<MessageThread> {
  const m = await members(clientId)
  const [rows, who] = await Promise.all([
    db().from('messages').select(MESSAGE_COLS).eq('client_id', m.client).order('created_at', { ascending: false }).limit(THREAD_LIMIT),
    people([m.me, m.client, m.coach]),
  ])
  const messages = (must(rows) as any[]).reverse().map((r) => toMessage(r, m.me, who))
  const client = who.get(m.client) ?? person(m.client, null)
  const other = m.iAmClient ? (m.coach ? who.get(m.coach) ?? person(m.coach, 'Coach') : null) : client
  return { client, other, messages, can_send: !!m.coach }
}

async function send(clientId: string | null, body: string): Promise<ChatMessage> {
  const me = await myId()
  const text = body.trim()
  if (!text) throw new ApiError(422, 'Write a message first.')
  if (text.length > 2000) throw new ApiError(422, 'Messages can be up to 2,000 characters.')
  const res = await db().from('messages')
    .insert({ client_id: clientId ?? me, sender_id: me, body: text })
    .select(MESSAGE_COLS).single()
  if (res.error) {
    if (res.status === 429 || res.error.code === 'PT429') throw new ApiError(429, "You're sending messages too fast. Wait a minute and try again.", 'PT429')
    if (res.error.code === '42501') throw new ApiError(403, "You can't message this person.", res.error.code)
  }
  return toMessage(must(res), me, await people([me]))
}

async function markRead(clientId: string | null) {
  const me = await myId()
  const client = clientId ?? me
  let q = db().from('messages').update({ read_at: new Date().toISOString() }).eq('client_id', client).is('read_at', null)
  // The recipient's side only (RLS enforces the same).
  q = client === me ? q.neq('sender_id', me) : q.eq('sender_id', client)
  must(await q)
  return { ok: true }
}

async function unreadCount(): Promise<number> {
  return (must(await db().rpc('unread_message_count')) as number) ?? 0
}

async function conversations(): Promise<Conversation[]> {
  const me = await myId()
  const rows = must(await db().rpc('message_threads')) as any[]
  return rows
    .map((r): Conversation => ({
      client: person(r.client_id, r.full_name),
      last: r.last_at ? { body: r.last_body, created_at: r.last_at, from_me: r.last_sender_id === me, feedback: !!r.last_check_in_id } : null,
      unread: r.unread ?? 0,
    }))
    .sort((a, b) => (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? '') || a.client.full_name.localeCompare(b.client.full_name))
}

async function checkinSummary(id: string): Promise<CheckinSummary> {
  const me = await myId()
  const [ci, msgs] = await Promise.all([
    db().from('check_ins')
      .select('id, client_id, week_start, status, submitted_at, avg_weight_kg, waist_cm, hips_cm, energy, sleep, stress, hunger, wins, struggles, question')
      .eq('id', id).maybeSingle(),
    db().from('messages').select(MESSAGE_COLS).eq('check_in_id', id).order('created_at'),
  ])
  const c: any = must(ci)
  if (!c) throw new ApiError(404, "That check-in doesn't exist.")
  const rows = must(msgs) as any[]
  const who = await people([me, ...rows.map((r) => r.sender_id)])
  const n = (x: unknown) => (x == null ? null : Number(x))
  return {
    id: c.id, week_start: c.week_start, status: c.status, submitted_at: c.submitted_at,
    avg_weight_kg: n(c.avg_weight_kg), waist_cm: n(c.waist_cm), hips_cm: n(c.hips_cm),
    energy: c.energy, sleep: c.sleep, stress: c.stress, hunger: c.hunger,
    wins: c.wins, struggles: c.struggles, question: c.question,
    feedback: rows.map((r) => toMessage(r, me, who)),
  }
}

export const liveMessages = { thread, send, markRead, unreadCount, conversations, checkinSummary }
