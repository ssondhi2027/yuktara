import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { api, type CheckinReview, type Targets } from '@/lib/api'
import { clockTime } from '@/lib/dates'

/** Quick-insert snippets. Coaches will be able to edit these in Settings. */
const SNIPPETS = (name: string) => [
  { label: 'Great week', text: `Great week, ${name}. ` },
  { label: 'Sleep tips', text: 'On late work nights, aim for lights out by 11 and keep your phone out of the bedroom. ' },
  { label: 'Exercise swap', text: "Yes to the swap. I've updated your program so you'll see it in your next session. " },
]

export function useSendReview(r: CheckinReview) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (body: { message: string; mark_reviewed: boolean; targets: Targets | null }) => api.sendReview(r.check_in_id, body),
    onSuccess: ({ next_id }) => {
      qc.invalidateQueries({ queryKey: ['coach-dashboard'] })
      qc.invalidateQueries({ queryKey: ['checkin-lists'] })
      qc.invalidateQueries({ queryKey: ['review'] })
      qc.invalidateQueries({ queryKey: ['client-detail'] })
      navigate(next_id ? `/coach/check-ins/${next_id}` : '/coach')
    },
  })
}

export function FeedbackBox({ r, targets, compact }: { r: CheckinReview; targets: Targets | null; compact?: boolean }) {
  const [msg, setMsg] = useState(r.draft)
  const [markReviewed, setMarkReviewed] = useState(true)
  const [savedAt, setSavedAt] = useState(r.draft_saved_at)
  const send = useSendReview(r)
  const saveDraft = useMutation({
    mutationFn: (draft: string) => api.saveReviewDraft(r.check_in_id, { draft }),
    onSuccess: (res) => setSavedAt(res.draft_saved_at),
  })

  return (
    <section className={`card feedback${compact ? ' compact' : ''}`}>
      {!compact && <h2>Your feedback</h2>}
      {!compact && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {SNIPPETS(r.client.first_name).map((s) => (
            <button key={s.label} type="button" className="chip-btn small" onClick={() => setMsg((m) => (m ? `${m.trimEnd()} ${s.text}` : s.text))}>
              + {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="field grow-field">
        <label htmlFor="fb">{compact ? `Feedback for ${r.client.first_name}` : `Message to ${r.client.first_name}`}</label>
        <textarea id="fb" className="textarea" value={msg} onChange={(e) => setMsg(e.target.value)}
          onBlur={() => msg !== r.draft && saveDraft.mutate(msg)} placeholder={`What should ${r.client.first_name} know about this week?`} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={markReviewed} onChange={(e) => setMarkReviewed(e.target.checked)} />
        {compact ? 'Mark as reviewed' : 'Mark this check-in as reviewed'}
      </label>
      <button className="btn btn-primary btn-lg btn-block btn-square" disabled={!msg.trim() || send.isPending}
        onClick={() => send.mutate({ message: msg, mark_reviewed: markReviewed, targets })}>
        {!compact && <Send size={18} />} {send.isPending ? 'Sending…' : 'Send and open next'}
      </button>
      {send.error && <div role="alert" className="auth-note err">{send.error.message}</div>}
      {!compact && savedAt && <div className="xs muted">Draft saved {clockTime(savedAt)}</div>}
    </section>
  )
}
