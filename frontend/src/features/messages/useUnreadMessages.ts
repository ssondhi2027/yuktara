import { useQuery } from '@tanstack/react-query'
import { api, UNREAD_REFRESH } from '@/lib/api'

/** Unread messages for the signed-in user (client or coach), for the nav badges. */
export function useUnreadMessages(): number {
  const { data } = useQuery({ queryKey: ['unread-messages'], queryFn: api.unreadMessages, ...UNREAD_REFRESH })
  return data ?? 0
}
