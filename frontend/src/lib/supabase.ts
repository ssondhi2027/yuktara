import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertNotGuest } from './session'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when a Supabase project is configured (the build's env). */
export const hasSupabase = !!(url && anonKey)

/** No project configured: the app runs on demo data. */
export const isDemo = !hasSupabase

let client: SupabaseClient | null = null

/**
 * The Supabase client, created on first use. Refuses in a guest session
 * (lib/session.ts), so a guest's reload never creates it and nothing a guest
 * does can reach the database or storage.
 */
export function getSupabase(): SupabaseClient {
  assertNotGuest('Supabase')
  if (!url || !anonKey) throw new Error('Supabase is not configured')
  client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The confirm-email link lands on /login with the session in the URL;
      // supabase-js reads it, saves the session and clears the hash.
      detectSessionInUrl: true,
      // Implicit, not PKCE: PKCE can only finish in the browser that signed
      // up, but people often open the link in their mail app or another
      // device. lib/auth.ts still exchanges a ?code= if one ever arrives.
      flowType: 'implicit',
    },
  })
  return client
}

/** Signed URL for a file in a private bucket (progress photos, meal photos). */
export async function signedUrl(bucket: string, path: string, expiresIn = 3600) {
  if (!hasSupabase) return null
  const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}
