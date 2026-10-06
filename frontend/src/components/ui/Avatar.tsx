import type { Person } from '@/lib/api'

const TONES = ['', 'sage', 'sand', 'peach', 'gold'] as const

/** Initials avatar. Tone is stable per person so lists don't flicker. */
export function Avatar({ person, size, tone }: { person: Pick<Person, 'id' | 'initials'>; size?: 'sm' | 'lg'; tone?: (typeof TONES)[number] }) {
  const t = tone ?? TONES[[...person.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 3]
  return <span className={['avatar', size, t].filter(Boolean).join(' ')}>{person.initials}</span>
}
