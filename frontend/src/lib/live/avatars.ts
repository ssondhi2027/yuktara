// Profile pictures (0020). users.avatar_url holds the storage path; RLS on users
// already limits the rows to the signed-in person, their coach and the coach's
// clients, and the avatars bucket policy matches, so one query plus one batch of
// signed URLs covers every avatar the app can show.

import { uploadPhoto } from '../backend'
import { db, must, myId, signedUrls } from './shared'

/** Signed avatar URLs by user id, for everyone the signed-in person can see. */
async function all(): Promise<Record<string, string>> {
  const rows = must(await db().from('users').select('id, avatar_url').not('avatar_url', 'is', null)) as { id: string; avatar_url: string }[]
  const urls = await signedUrls(rows.map((r) => r.avatar_url))
  return Object.fromEntries(rows.filter((r) => urls[r.avatar_url]).map((r) => [r.id, urls[r.avatar_url]]))
}

async function current(uid: string): Promise<string | null> {
  return (must(await db().from('users').select('avatar_url').eq('id', uid).single()) as { avatar_url: string | null }).avatar_url
}

/** Uploads a new photo (compressed on the device), points the profile at it, then removes the old file. */
async function set(localUrl: string) {
  const uid = await myId()
  const old = await current(uid)
  const path = await uploadPhoto('avatar', localUrl)
  must(await db().from('users').update({ avatar_url: path }).eq('id', uid))
  if (old && old !== path) await db().storage.from('avatars').remove([old]) // best effort: a leftover file is harmless
  return { ok: true }
}

async function remove() {
  const uid = await myId()
  const old = await current(uid)
  must(await db().from('users').update({ avatar_url: null }).eq('id', uid))
  if (old) await db().storage.from('avatars').remove([old])
  return { ok: true }
}

export const liveAvatars = { all, set, remove }
