// The FastAPI backend (VITE_API_URL): multi-table writes, called with the
// user's Supabase access token. The backend reads the user id from the
// verified token only.

import { compressImage } from './image'
import { supabase } from './supabase'

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

export async function backend<T>(path: string, body?: unknown): Promise<T> {
  const { data: { session } } = await supabase!.auth.getSession()
  if (!session) throw new ApiError(401, 'Your session has ended. Log in again.')
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach Yuktara right now. Check your connection and try again.")
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, json?.error?.message ?? 'Something went wrong.', json?.error?.code)
  return json as T
}

interface UploadUrl { bucket: string; path: string; signed_url: string; token: string; expires_in: number }

/**
 * Compresses a photo picked on the device (a blob: URL), gets a signed link
 * for the user's own folder from the backend and uploads to it. Returns the
 * storage path to save in the database.
 */
export async function uploadPhoto(kind: 'progress' | 'meals', localUrl: string): Promise<string> {
  const blob = await (await fetch(localUrl)).blob()
  const jpeg = await compressImage(new File([blob], 'photo', { type: blob.type || 'image/jpeg' }))
  const up = await backend<UploadUrl>('/photos/upload-url', { kind, content_type: 'image/jpeg', size_bytes: jpeg.size })
  const res = await fetch(up.signed_url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg })
  if (!res.ok) throw new ApiError(res.status, "A photo couldn't be uploaded. Try again.")
  return up.path
}
