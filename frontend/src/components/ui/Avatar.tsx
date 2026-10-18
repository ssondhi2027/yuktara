import { useQuery } from '@tanstack/react-query'
import { api, type Person } from '@/lib/api'

const TONES = ['', 'sage', 'sand', 'peach', 'gold'] as const

/**
 * The person's profile picture as a signed URL, or undefined. One cached query
 * covers everyone the signed-in person can see (users RLS); signed URLs last an
 * hour, so it refreshes well before then.
 */
export function useAvatarUrl(id: string | undefined): string | undefined {
  const { data } = useQuery({ queryKey: ['avatars'], queryFn: api.avatars, staleTime: 45 * 60_000, refetchOnWindowFocus: false })
  return id ? data?.[id] : undefined
}

/** Profile picture, or initials. Tone is stable per person so lists don't flicker. */
export function Avatar({ person, size, tone, className }: { person: Pick<Person, 'id' | 'initials'>; size?: 'sm' | 'lg'; tone?: (typeof TONES)[number]; className?: string }) {
  const url = useAvatarUrl(person.id)
  const t = tone ?? TONES[[...person.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 3]
  return (
    <span className={['avatar', size, t, url && 'has-photo', className].filter(Boolean).join(' ')}>
      {url ? <img src={url} alt="" loading="lazy" /> : person.initials}
    </span>
  )
}
