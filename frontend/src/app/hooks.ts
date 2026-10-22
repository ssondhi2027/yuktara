import { useSyncExternalStore } from 'react'

export const BP = { tablet: '(min-width: 768px)', desktop: '(min-width: 1200px)' } as const

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    // Rendering outside a browser (scripts/check-progress.mjs stubs matchMedia per width).
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
  )
}

/** 'phone' < 768 ≤ 'tablet' < 1200 ≤ 'desktop' — matches the three artboard sizes. */
export function useLayout(): 'phone' | 'tablet' | 'desktop' {
  const tablet = useMediaQuery(BP.tablet)
  const desktop = useMediaQuery(BP.desktop)
  return desktop ? 'desktop' : tablet ? 'tablet' : 'phone'
}

export type ThemePref = 'system' | 'light' | 'dark'
const THEME_KEY = 'yuktara.theme'

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(t: ThemePref) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

// One shared theme store so every menu shows the same choice.
let theme: ThemePref = readTheme()
const listeners = new Set<() => void>()
applyTheme(theme) // before first render, so there's no flash

function setThemePref(t: ThemePref) {
  theme = t
  applyTheme(t)
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* private mode: the choice just won't persist */
  }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => theme,
    () => theme, // server render (checks): the same stored choice
  )
  return [value, setThemePref] as const
}

/** True when the page is rendering dark, whether chosen or from the OS. */
export function useIsDark() {
  const system = useMediaQuery('(prefers-color-scheme: dark)')
  const [pref] = useTheme()
  return pref === 'system' ? system : pref === 'dark'
}

// ---------- Celebrating new personal records (Profile → Settings) ----------
// On this device only; badges show either way, this only turns the moment on
// the workout summary on or off.
const CELEBRATE_KEY = 'yuktara.celebrate'
let celebrate = (() => {
  try {
    return localStorage.getItem(CELEBRATE_KEY) !== 'off'
  } catch {
    return true
  }
})()
const celebrateListeners = new Set<() => void>()

function setCelebrate(on: boolean) {
  celebrate = on
  try {
    localStorage.setItem(CELEBRATE_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: the choice just won't persist */
  }
  celebrateListeners.forEach((l) => l())
}

export function useCelebrations() {
  const value = useSyncExternalStore(
    (cb) => {
      celebrateListeners.add(cb)
      return () => celebrateListeners.delete(cb)
    },
    () => celebrate,
    () => celebrate,
  )
  return [value, setCelebrate] as const
}
