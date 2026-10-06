import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Null when no project is configured; the app then runs on demo data. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
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
    : null

export const isDemo = supabase === null

/** Signed URL for a file in a private bucket (progress photos, meal photos). */
export async function signedUrl(bucket: string, path: string, expiresIn = 3600) {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}
