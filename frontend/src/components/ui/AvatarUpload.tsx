import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { api, type Person } from '@/lib/api'
import { Avatar, useAvatarUrl } from './Avatar'

/** Change or remove your own profile picture (Profile page, coach Settings). */
export function AvatarUpload({ person }: { person: Pick<Person, 'id' | 'initials' | 'full_name'> }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const has = !!useAvatarUrl(person.id)
  const done = () => { setError(null); return qc.invalidateQueries({ queryKey: ['avatars'] }) }
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Could not save the photo. Try again.')
  const upload = useMutation({ mutationFn: (url: string) => api.setAvatar(url), onSuccess: done, onError: fail })
  const remove = useMutation({ mutationFn: () => api.removeAvatar(), onSuccess: done, onError: fail })
  const busy = upload.isPending || remove.isPending

  return (
    <div className="avatar-upload">
      <Avatar person={person} size="lg" />
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            <Camera size={16} /> {upload.isPending ? 'Uploading…' : has ? 'Change photo' : 'Add a photo'}
          </button>
          {has && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove.mutate()}>{remove.isPending ? 'Removing…' : 'Remove'}</button>}
        </div>
        <span className="xs muted">Shown to you, your coach or clients. JPEG, PNG or WebP; it's resized on your device.</span>
        {error && <span role="alert" className="xs bad">{error}</span>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setError('Choose a JPEG, PNG or WebP image.')
          if (f.size > 20 * 1024 * 1024) return setError('That image is very large. Choose one under 20 MB.')
          upload.mutate(URL.createObjectURL(f))
        }} />
    </div>
  )
}
