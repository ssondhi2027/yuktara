// Unit tests for the guest's local store (src/lib/guestStore.ts): saving and
// loading, the version key, blocked or full storage, and clearing on sign-out.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyGuestState, fromStored, GUEST_STORE_KEY, GUEST_VERSION, GuestStore, localStorageBackend, memoryBackend,
  type StoreBackend,
} from '../src/lib/guestStore.ts'

const TODAY = '2026-10-20'

/** A localStorage stand-in; `blocked` throws on every access, `full` throws on writes. */
function fakeStorage(mode: 'ok' | 'blocked' | 'full' = 'ok'): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  const guard = (write: boolean) => {
    if (mode === 'blocked' || (mode === 'full' && write)) throw new DOMException('nope', mode === 'full' ? 'QuotaExceededError' : 'SecurityError')
  }
  return {
    data,
    get length() { return data.size },
    clear: () => { guard(true); data.clear() },
    getItem: (k) => { guard(false); return data.get(k) ?? null },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { guard(true); data.delete(k) },
    setItem: (k, v) => { guard(true); data.set(k, String(v)) },
  }
}

const meal = { id: 'm1', date: TODAY, meal_type: 'lunch' as const, eaten_at: `${TODAY}T12:30:00`, title: 'Dal and rice', calories: 520, protein_g: 21, carbs_g: 88, fat_g: 7, on_plan: 'yes' as const, photo: null }

test('a fresh guest starts empty, with no sample data', async () => {
  const store = new GuestStore(() => [memoryBackend()], () => TODAY)
  await store.ready()
  assert.deepEqual(store.state, emptyGuestState(TODAY))
  assert.equal(store.state.meals.length, 0)
  assert.equal(store.state.sessions.length, 0)
  assert.equal(store.state.profile.start_date, TODAY)
})

test('saved after each change and loaded again on the next visit (a reload)', async () => {
  const ls = fakeStorage()
  const first = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await first.ready()
  first.update((s) => { s.meals.push(meal) })
  first.update((s) => { s.days[TODAY] = { steps: 8000, water_ml: 1500, sleep_hours: 7.5, weight_kg: 71.2, day_rating: 'yes' } })
  first.update((s) => { s.profile.units = 'metric'; s.profile.body_model = 'male' })
  await first.flush()
  assert.equal(first.status, 'saved')
  assert.equal(first.where, 'localstorage')

  const again = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await again.ready()
  assert.deepEqual(again.state.meals, [meal])
  assert.equal(again.state.days[TODAY].steps, 8000)
  assert.equal(again.state.profile.units, 'metric')
  assert.equal(again.state.profile.body_model, 'male')
})

test('one versioned key; a record from another version is not loaded', async () => {
  const ls = fakeStorage()
  const store = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await store.ready()
  store.update((s) => { s.meals.push(meal) })
  await store.flush()
  assert.deepEqual([...ls.data.keys()], [GUEST_STORE_KEY])
  assert.equal(GUEST_STORE_KEY, 'yuktara.guest.v1')
  assert.equal(JSON.parse(ls.data.get(GUEST_STORE_KEY)!).version, GUEST_VERSION)

  ls.data.set(GUEST_STORE_KEY, JSON.stringify({ ...JSON.parse(ls.data.get(GUEST_STORE_KEY)!), version: 99 }))
  const later = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await later.ready()
  assert.equal(later.state.meals.length, 0)
  assert.equal(fromStored({ version: 1 }, TODAY), null) // not a full record
  assert.equal(fromStored('junk', TODAY), null)
})

test('blocked storage: falls back to memory, works for the session, says it is not kept', async () => {
  const store = new GuestStore(() => [localStorageBackend(fakeStorage('blocked')), memoryBackend()], () => TODAY)
  await store.ready()
  assert.equal(store.where, 'memory')
  assert.equal(store.status, 'not_kept')
  store.update((s) => { s.meals.push(meal) })
  await store.flush()
  assert.equal(store.state.meals.length, 1) // still there for this visit
})

test('full storage: the change stays for the session, the status says it is not kept, and listeners hear it', async () => {
  const store = new GuestStore(() => [localStorageBackend(fakeStorage('full'))], () => TODAY)
  await store.ready() // reading works
  assert.equal(store.status, 'saved')
  let heard = 0
  store.subscribe(() => heard++)
  store.update((s) => { s.meals.push(meal) })
  await store.flush()
  assert.equal(store.status, 'not_kept')
  assert.equal(store.state.meals.length, 1)
  assert.equal(heard, 1)
})

test('the first storage that works is used (IndexedDB broken: localStorage)', async () => {
  const broken: StoreBackend = { name: 'indexeddb', persistent: true, load: async () => { throw new Error('IndexedDB blocked') }, save: async () => {}, clear: async () => {} }
  const ls = fakeStorage()
  const store = new GuestStore(() => [broken, localStorageBackend(ls), memoryBackend()], () => TODAY)
  await store.ready()
  assert.equal(store.where, 'localstorage')
})

test('photos stay out of localStorage (they last for the session there)', async () => {
  const ls = fakeStorage()
  const store = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await store.ready()
  store.update((s) => {
    s.photos.p1 = new Blob(['jpeg'], { type: 'image/jpeg' })
    s.meals.push({ ...meal, photo: 'p1' })
    s.avatar = 'p1'
  })
  await store.flush()
  const saved = JSON.parse(ls.data.get(GUEST_STORE_KEY)!)
  assert.deepEqual(saved.photos, {})
  assert.equal(saved.meals[0].photo, null)
  assert.equal(saved.avatar, null)
  assert.ok(store.state.photos.p1) // still shown this visit
})

test('clearing (signing out) deletes the saved record and starts over empty', async () => {
  const ls = fakeStorage()
  const store = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await store.ready()
  store.update((s) => { s.meals.push(meal) })
  await store.clear()
  assert.equal(ls.data.has(GUEST_STORE_KEY), false)
  assert.deepEqual(store.state, emptyGuestState(TODAY))
  const next = new GuestStore(() => [localStorageBackend(ls)], () => TODAY)
  await next.ready()
  assert.equal(next.state.meals.length, 0)
})

test('clearing still works when storage refuses', async () => {
  const store = new GuestStore(() => [localStorageBackend(fakeStorage('full'))], () => TODAY)
  await store.ready()
  store.update((s) => { s.meals.push(meal) })
  await store.clear() // removeItem throws; the session's data is gone anyway
  assert.equal(store.state.meals.length, 0)
})
