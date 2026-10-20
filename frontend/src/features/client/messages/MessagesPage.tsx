import { ThreadView } from '@/features/messages/ThreadView'
import { GuestPage, useIsGuest } from '@/components/guest/Guest'

/** /messages: the client's one conversation, with their coach. */
export function MessagesPage() {
  if (useIsGuest()) return <GuestPage title="Messages" text="Messages are a chat with your coach. Create an account and add your coach's invite code to start one." />
  return (
    <div className="page chat-page">
      <ThreadView clientId={null} checkinHref={(id) => `/check-in/${id}`} />
    </div>
  )
}
