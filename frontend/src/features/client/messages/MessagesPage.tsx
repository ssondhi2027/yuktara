import { ThreadView } from '@/features/messages/ThreadView'

/** /messages: the client's one conversation, with their coach. */
export function MessagesPage() {
  return (
    <div className="page chat-page">
      <ThreadView clientId={null} checkinHref={(id) => `/check-in/${id}`} />
    </div>
  )
}
