// Guest mode check: renders the client app for a guest in Node (no browser),
// with the build set up for a real Supabase project but the Supabase client
// library and the network replaced by stubs that fail and record any call. A
// guest must never reach either. Checks a brand-new guest, then one with logged
// data, at phone and desktop widths; that a reload (a fresh app instance on the
// same storage) keeps the data; and that a signed-in user and a demo build still
// go where they did before. Prints a summary and exits 1 on any problem.
//
//   node scripts/check-guest.mjs

import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const calls = [] // every attempt to reach Supabase or the network
const problems = []
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) problems.push(msg) }

// ---------- Browser stand-ins ----------
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size },
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.window = globalThis
const el = { dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } }
globalThis.document = { documentElement: el, body: el, querySelector: () => null, addEventListener() {}, removeEventListener() {} }
let width = 390
globalThis.matchMedia = (q) => {
  const min = /min-width:\s*(\d+)px/.exec(q)
  const max = /max-width:\s*([\d.]+)px/.exec(q)
  return { matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
}
// Any network call fails the check (a guest's data never leaves the device).
globalThis.fetch = async (input) => {
  calls.push(`fetch ${String(input)}`)
  throw new Error(`network call in the check: ${String(input)}`)
}

// The Supabase library, replaced: creating a client is recorded and refused.
const stubSupabase = {
  name: 'stub-supabase',
  enforce: 'pre',
  resolveId: (id) => (id === '@supabase/supabase-js' ? '\0stub-supabase' : null),
  load: (id) => (id === '\0stub-supabase'
    ? `export function createClient(url) { globalThis.__supabaseCalls = (globalThis.__supabaseCalls ?? 0) + 1; throw new Error('createClient called: ' + url) }`
    : null),
}

/** A Vite server for one "page load"; `live` sets up the build as if a Supabase project were configured. */
async function server(live) {
  if (live) {
    process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1'
    process.env.VITE_SUPABASE_ANON_KEY = 'placeholder-anon-key'
    process.env.VITE_API_URL = 'http://127.0.0.1:2'
  } else {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.VITE_SUPABASE_ANON_KEY
    delete process.env.VITE_API_URL
  }
  // noExternal: otherwise Vite loads the real library from node_modules and the stub never runs.
  return createServer({
    root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', plugins: [stubSupabase], envDir: '/nonexistent-env-dir',
    ssr: { noExternal: ['@supabase/supabase-js'] },
  })
}

const React = (await import('react')).default
const { renderToString } = await import('react-dom/server')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MemoryRouter, Routes, Route } = await import('react-router')

async function app(vite) {
  const m = (p) => vite.ssrLoadModule(p)
  return {
    session: await m('/src/lib/session.ts'),
    supabase: await m('/src/lib/supabase.ts'),
    auth: await m('/src/lib/auth.ts'),
    authCtx: await m('/src/app/auth.tsx'),
    api: (await m('/src/lib/api.ts')).api,
    store: (await m('/src/lib/guestStore.ts')).guestStore,
    dates: await m('/src/lib/dates.ts'),
    pages: {
      shell: (await m('/src/components/layout/ClientShell.tsx')).ClientShell,
      home: (await m('/src/features/client/home/HomePage.tsx')).ClientHomePage,
      train: (await m('/src/features/client/train/TrainPage.tsx')).default,
      food: (await m('/src/features/client/food/FoodPage.tsx')).FoodPage,
      progress: (await m('/src/features/client/progress/ProgressPage.tsx')).ProgressPage,
      profile: (await m('/src/features/client/profile/ProfilePage.tsx')).ProfilePage,
      messages: (await m('/src/features/client/messages/MessagesPage.tsx')).MessagesPage,
      checkin: (await m('/src/features/client/checkin/CheckinPage.tsx')).CheckinPage,
    },
  }
}

/** Loads what each screen asks for through the app's own API (so through the guest layer), then renders. */
async function render(a, user, page, w) {
  width = w
  const t = a.dates.today()
  const qc = new QueryClient()
  const load = async (key, f) => qc.setQueryData(key, await f())
  await load(['client-home'], a.api.clientHome)
  await load(['train'], a.api.trainWeek)
  await load(['food', t], () => a.api.foodDay(t))
  await load(['progress'], a.api.progress)
  await load(['progress-detail', 'p12'], () => a.api.progressDetail('p12'))
  await load(['my-profile'], a.api.myProfile)
  await load(['avatars'], a.api.avatars)
  await load(['unread-messages'], a.api.unreadMessages)
  await load(['exercise-library'], a.api.exerciseLibrary)
  const tree = React.createElement(a.authCtx.AuthContextForTests.Provider,
    { value: { status: 'ready', user, error: null, notice: null, clearNotice() {}, refresh: async () => {}, signOut: async () => {} } },
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(MemoryRouter, null,
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/', element: React.createElement(a.pages.shell) },
            React.createElement(Route, { index: true, element: React.createElement(page) }))))))
  return renderToString(tree).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
}

const bad = (label, html) => ok(!/NaN|>undefined<|undefined (kg|lb|kcal|g)\b|Infinity/.test(html), `${label}: no NaN, undefined or Infinity`)
const untouched = (label) => ok(calls.length === 0 && !globalThis.__supabaseCalls, `${label}: nothing reached Supabase or the network (${calls.length + (globalThis.__supabaseCalls ?? 0)} calls)`)

try {
  // ---------- 1. A brand-new guest, on a build set up for Supabase ----------
  let vite = await server(true)
  let a = await app(vite)
  ok(a.supabase.hasSupabase && !a.supabase.isDemo, 'the build is set up for a Supabase project (not a demo build)')
  await a.auth.startGuest()
  let user = await a.auth.loadUser()
  ok(user?.guest === true && user.role === 'client' && user.setupDone, 'Try without an account: a local client user, guest: true')
  ok(store.get('yuktara.guest.session') === '1', 'the guest session survives a reload (flag on the device)')
  for (const [name, w] of [['phone', 390], ['desktop', 1400]]) {
    for (const [label, page] of Object.entries(a.pages)) {
      if (label === 'shell') continue
      const html = await render(a, user, page, w)
      bad(`new guest ${label} (${name})`, html)
      if (label === 'home') ok(html.includes('Guest mode:') && html.includes("It isn't backed up or synced") && html.includes('Delete my data'), `new guest home (${name}): the guest banner`)
      if (label === 'messages' || label === 'checkin') ok(html.includes('Create an account to work with a coach'), `new guest ${label} (${name}): a "create an account" card, not an error`)
      if (label === 'food') ok(html.includes('Targets come from a coach') && html.includes('Meal plans come from a coach'), `new guest food (${name}): targets and meal plans say they need a coach`)
      if (label === 'progress') ok(html.includes('Progress'), `new guest progress (${name}) renders`)
    }
  }
  const home0 = await a.api.clientHome()
  ok(home0.food.meals.length === 0 && home0.days.every((d) => !d.logged) && home0.bests.length === 0, 'a new guest starts with empty data, not the demo sample')
  let refused = null
  try { await a.api.messageThread(null) } catch (e) { refused = e }
  ok(refused?.code === 'guest_only', 'coach-only calls are refused in guest mode before reaching anything')
  try { a.supabase.getSupabase(); ok(false, 'getSupabase refuses in guest mode') } catch (e) { ok(e.name === 'GuestBoundaryError', 'getSupabase refuses in guest mode (loudly)') }
  untouched('new guest')

  // ---------- 2. Some logged data ----------
  const t = a.dates.today()
  const day = (n) => a.dates.addDays(t, -n)
  a.store.update((s) => { s.profile.start_date = day(35) }) // as if they started five weeks ago
  for (let n = 35; n >= 0; n -= 2) await a.api.logDaily(day(n), { weight_kg: 80 - (35 - n) * 0.07, steps: 7000 + n * 50, sleep_hours: 7, water_ml: 2000 })
  await a.api.rateDay(t, 'yes')
  await a.api.logMeal(t, { meal_type: 'lunch', eaten_at: `${t}T12:30:00`, title: 'Dal and rice', calories: 520, protein_g: 21, carbs_g: 88, fat_g: 7, on_plan: 'yes', photo_url: null,
    items: [{ food_id: null, food_name: 'Dal and rice', quantity: 1, unit: 'serving', serving: '1 plate', calories: 520, protein_g: 21, carbs_g: 88, fat_g: 7 }] })
  const lib = await a.api.exerciseLibrary()
  const squat = lib.find((e) => e.name === 'Back squat') ?? lib[0]
  for (const [n, kg] of [[14, 60], [7, 62.5], [0, 65]]) {
    // older workouts: started and finished "on" those days
    const { id } = await a.api.startWorkout(null)
    a.store.update((s) => { const x = s.sessions.find((q) => q.id === id); x.performed_on = day(n); x.started_at = `${day(n)}T18:00:00.000Z` })
    await a.api.saveSet(id, { exercise_id: squat.id, template_exercise_id: null, set_number: 1, weight_kg: kg, reps: 6, rpe: 8, is_warmup: false })
    await a.api.saveSet(id, { exercise_id: squat.id, template_exercise_id: null, set_number: 2, weight_kg: kg, reps: 6, rpe: 8.5, is_warmup: false })
    await a.api.saveSet(id, { exercise_id: squat.id, template_exercise_id: null, set_number: 3, weight_kg: kg - 15, reps: 10, rpe: null, is_warmup: false, drop_of: 2 })
    await a.api.finishWorkout(id, 7)
  }
  let dropRefused = null
  const { id: open } = await a.api.startWorkout(null)
  try { await a.api.saveSet(open, { exercise_id: squat.id, template_exercise_id: null, set_number: 2, weight_kg: 40, reps: 8, rpe: null, is_warmup: false, drop_of: 1 }) } catch (e) { dropRefused = e }
  ok(/Tick that set first/.test(dropRefused?.message ?? ''), 'guest logger: the same drop-set rules')
  await a.api.discardWorkout(open)
  await a.store.flush()
  user = await a.auth.loadUser()
  const train = await a.api.trainWeek()
  ok(train.recent.length === 3 && train.recent[0].sets === 2, `Train: own workouts listed; a set and its drop count once (${train.recent[0]?.sets} hard sets)`)
  const detail = await a.api.progressDetail('p12')
  ok(detail.kpis.weight.value != null && detail.weight.forecast.enough, `Progress: KPIs and a weight forecast from the guest's own data (${detail.kpis.weight.value} kg)`)
  ok(detail.strength.length === 1 && detail.strength[0].points.length === 3, 'Progress: 1RM points per session (drops left out)')
  // Personal records from the guest's own workouts (60 → 62.5 → 65 kg squats): worked out on the device.
  const recs = detail.records.filter((r) => r.kind !== 'milestone').map((r) => `${r.kind} ${r.value}`)
  ok(recs.includes('weight 65') && recs.includes('weight 62.5') && !recs.includes('weight 60'), `Progress: personal records from their workouts, the first one the baseline (${recs.join(', ')})`)
  ok(train.recent[0].records.some((r) => r.kind === 'weight' && r.value === 65), 'Train: the latest workout carries its records')
  for (const [name, w] of [['phone', 390], ['desktop', 1400]]) {
    for (const [label, page] of Object.entries(a.pages)) {
      if (label === 'shell') continue
      const html = await render(a, user, page, w)
      bad(`guest with data ${label} (${name})`, html)
      if (label === 'food') ok(html.includes('Dal and rice'), `guest with data food (${name}): the logged meal`)
      // Phones show one chart group at a time (Weight first); strength is on the Training tab.
      if (label === 'progress' && name === 'desktop') ok(html.includes('Back squat'), `guest with data progress (${name}): strength from their workouts`)
      if (label === 'progress' && name === 'desktop') ok(html.includes('<h3>Personal records</h3>') && html.includes('kit-dot mark'), `guest with data progress (${name}): records card and rings on the strength chart`)
      if (label === 'home') ok(html.includes(name === 'desktop' ? 'New this week' : 'new personal record'), `guest with data home (${name}): this week's records`)
    }
  }
  untouched('guest with data')
  ok(store.has('yuktara.guest.v1'), 'the data is saved under yuktara.guest.v1 (localStorage here; IndexedDB in browsers that have it)')
  await vite.close()

  // ---------- 3. A reload keeps the data ----------
  vite = await server(true)
  a = await app(vite)
  user = await a.auth.loadUser()
  ok(user?.guest === true, 'after a reload: still a guest, without asking Supabase')
  const home = await a.api.clientHome()
  const food = await a.api.foodDay(a.dates.today())
  const train2 = await a.api.trainWeek()
  const detail2 = await a.api.progressDetail('p12')
  ok(food.meals.some((m) => m.title === 'Dal and rice') && home.habits.steps_avg != null && detail2.weight.daily.length === 18 && train2.recent.length === 3,
    `after a reload: meals, daily logs (${detail2.weight.daily.length} weigh-ins) and workouts (${train2.recent.length}) are all there`)
  untouched('reload')

  // ---------- 4. Signing out deletes it ----------
  await a.auth.signOut()
  ok(!store.has('yuktara.guest.v1') && !store.has('yuktara.guest.session') && !a.session.isGuest(), 'signing out of a guest session deletes the data and ends the session')
  untouched('sign-out')

  // ---------- 5. Everyone else is unchanged ----------
  let liveCall = null
  try { await a.api.clientHome() } catch (e) { liveCall = e }
  ok((globalThis.__supabaseCalls ?? 0) > 0 && /createClient called/.test(String(liveCall?.message ?? liveCall)), 'not a guest: the same call goes to Supabase as before (the stub refused it)')
  await vite.close()
  globalThis.__supabaseCalls = 0
  calls.length = 0

  vite = await server(false)
  a = await app(vite)
  ok(a.supabase.isDemo, 'demo build (no Supabase keys)')
  const demoHome = await a.api.clientHome()
  ok(demoHome.food.meals.length > 0 && demoHome.coach != null, 'demo build: the sample data (Aisha and her coach) as before')
  untouched('demo build')
  await vite.close()
} catch (e) {
  console.log('FAIL', e.stack)
  problems.push(String(e))
}

console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'all checks passed')
process.exit(problems.length ? 1 : 0)
