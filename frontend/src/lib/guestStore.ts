// A guest's data: everything they log without an account, kept on this device
// only and never sent to Supabase or the backend. One versioned record
// ("yuktara.guest.v1") in IndexedDB (photos as Blobs); localStorage if
// IndexedDB isn't available (photos then last for the session only); memory
// only if neither works, and then the app says the data won't be kept.
// Every storage read and write is guarded: blocked or full storage never
// breaks the app. Unit-tested in tests/guestStore.test.ts.

import type { BodyModel, DietType, ExerciseLevel, GoalType, MealType, OnPlan, TrainLocation, UnitSystem } from '../types/db'
import type { SetWrite } from './api'
import type { MealItem } from './meals'

export const GUEST_STORE_KEY = 'yuktara.guest.v1'
/** The guest's user id (never a real account's: those are UUIDs). */
export const GUEST_ID = 'guest'
export const GUEST_VERSION = 1

export interface GuestProfile {
  full_name: string
  units: UnitSystem
  body_model: BodyModel
  start_date: string
  height_cm: number | null
  start_weight_kg: number | null
  goal_weight_kg: number | null
  goal: GoalType | null
  experience: ExerciseLevel | null
  diet: DietType | null
  foods_to_avoid: string | null
  meals_per_day: number | null
  training_days: number | null
  train_location: TrainLocation | null
  injuries: string | null
  phone: string | null
}

export interface GuestDay { steps: number | null; water_ml: number | null; sleep_hours: number | null; weight_kg: number | null; day_rating: OnPlan | null }

export interface GuestMeal {
  id: string
  date: string
  meal_type: MealType
  eaten_at: string
  title: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  on_plan: OnPlan
  /** a key in `photos`, or null */
  photo: string | null
  items?: MealItem[]
}

export interface GuestSession {
  id: string
  performed_on: string
  started_at: string
  finished_at: string | null
  duration_min: number | null
  notes: string
  effort: number | null
  sets: SetWrite[]
}

export interface GuestState {
  version: typeof GUEST_VERSION
  profile: GuestProfile
  days: Record<string, GuestDay>
  meals: GuestMeal[]
  sessions: GuestSession[]
  /** meal and profile photos, by id; Blobs stay on the device */
  photos: Record<string, Blob>
  /** the profile photo's key in `photos` */
  avatar: string | null
}

export function emptyGuestState(today: string): GuestState {
  return {
    version: GUEST_VERSION,
    profile: {
      full_name: 'Guest', units: 'imperial', body_model: 'female', start_date: today, height_cm: null, start_weight_kg: null,
      goal_weight_kg: null, goal: null, experience: null, diet: null, foods_to_avoid: null, meals_per_day: 3, training_days: null,
      train_location: null, injuries: null, phone: null,
    },
    days: {}, meals: [], sessions: [], photos: {}, avatar: null,
  }
}

/** A stored record as state, or null if it isn't this version's (or isn't one at all). */
export function fromStored(raw: unknown, today: string): GuestState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<GuestState>
  if (r.version !== GUEST_VERSION || !r.profile || typeof r.days !== 'object' || !Array.isArray(r.meals) || !Array.isArray(r.sessions)) return null
  const base = emptyGuestState(today)
  return { ...base, ...r, profile: { ...base.profile, ...r.profile }, photos: r.photos ?? {}, avatar: r.avatar ?? null } as GuestState
}

// ---------- Where it's kept ----------

export interface StoreBackend {
  name: 'indexeddb' | 'localstorage' | 'memory'
  /** false: kept for this page only */
  persistent: boolean
  load(): Promise<unknown>
  save(state: GuestState): Promise<void>
  clear(): Promise<void>
}

export function memoryBackend(): StoreBackend {
  let kept: GuestState | null = null
  return {
    name: 'memory', persistent: false,
    load: async () => kept,
    save: async (s) => { kept = s },
    clear: async () => { kept = null },
  }
}

/** JSON in localStorage. Photos can't go in JSON: they're left out (and last for the session). */
export function localStorageBackend(ls: Storage): StoreBackend {
  return {
    name: 'localstorage', persistent: true,
    load: async () => {
      const raw = ls.getItem(GUEST_STORE_KEY) // throws when storage is blocked
      return raw ? JSON.parse(raw) : null
    },
    save: async (s) => {
      const meals = s.meals.map((m) => ({ ...m, photo: null }))
      ls.setItem(GUEST_STORE_KEY, JSON.stringify({ ...s, meals, photos: {}, avatar: null }))
    },
    clear: async () => { ls.removeItem(GUEST_STORE_KEY) },
  }
}

const DB_NAME = 'yuktara'
const STORE = 'guest'

/** One record in IndexedDB (structured clone, so photos stay Blobs). */
export function indexedDbBackend(idb: IDBFactory): StoreBackend {
  let opening: Promise<IDBDatabase> | null = null
  const open = () => (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'))
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  }))
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = f(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'))
  }))
  return {
    name: 'indexeddb', persistent: true,
    load: () => run('readonly', (s) => s.get(GUEST_STORE_KEY)),
    save: (st) => run('readwrite', (s) => s.put(st, GUEST_STORE_KEY)).then(() => undefined),
    clear: () => run('readwrite', (s) => s.delete(GUEST_STORE_KEY)).then(() => undefined),
  }
}

/** The browser's options, best first. Accessing either API can itself throw (blocked site data). */
export function browserBackends(): StoreBackend[] {
  const out: StoreBackend[] = []
  try { if (typeof indexedDB !== 'undefined' && indexedDB) out.push(indexedDbBackend(indexedDB)) } catch { /* blocked */ }
  try { if (typeof localStorage !== 'undefined' && localStorage) out.push(localStorageBackend(localStorage)) } catch { /* blocked */ }
  out.push(memoryBackend())
  return out
}

// ---------- The store ----------

export type SaveStatus = 'saved' | 'not_kept'

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class GuestStore {
  state: GuestState
  private backend: StoreBackend | null = null
  private loading: Promise<void> | null = null
  private saving: Promise<void> = Promise.resolve()
  private failed = false
  private listeners = new Set<() => void>()

  private backends: () => StoreBackend[]
  private today: () => string

  constructor(backends: () => StoreBackend[], today: () => string = isoToday) {
    this.backends = backends
    this.today = today
    this.state = emptyGuestState(today())
  }

  /** Loads the saved record once (the first backend that works wins); an empty state if there's none. */
  ready(): Promise<void> {
    this.loading ??= (async () => {
      for (const b of this.backends()) {
        try {
          const raw = await b.load()
          this.backend = b
          this.state = fromStored(raw, this.today()) ?? emptyGuestState(this.today())
          break
        } catch {
          // blocked or broken: try the next one
        }
      }
      this.notify()
    })()
    return this.loading
  }

  /** 'not_kept' when nothing can be saved on this device (blocked, full, or memory only). */
  get status(): SaveStatus {
    return this.failed || !this.backend?.persistent ? 'not_kept' : 'saved'
  }

  /** Where it's kept, for the banner and tests. */
  get where(): StoreBackend['name'] | null {
    return this.backend?.name ?? null
  }

  /** Changes the state, then saves it (in order; a failed save marks the data "not kept" but the session goes on). */
  update(f: (s: GuestState) => void) {
    f(this.state)
    const snapshot = this.state
    this.saving = this.saving.then(async () => {
      try {
        await this.backend?.save(snapshot)
        if (this.failed) { this.failed = false; this.notify() }
      } catch {
        if (!this.failed) { this.failed = true; this.notify() }
      }
    })
  }

  /** Waits for pending saves. */
  flush(): Promise<void> {
    return this.saving
  }

  /** Deletes the saved record and starts over empty (signing out of a guest session). */
  async clear() {
    await this.flush()
    try {
      await this.backend?.clear()
    } catch {
      /* nothing more we can do; the in-memory state is gone either way */
    }
    this.state = emptyGuestState(this.today())
    this.failed = false
    this.notify()
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private notify() {
    this.listeners.forEach((l) => l())
  }
}

/** The app's guest store (browser storage). */
export const guestStore = new GuestStore(browserBackends)
