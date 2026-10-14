// Renders the Progress page to HTML in Node (no browser), with the demo data,
// for phone, tablet and desktop layouts and both units, plus a brand-new client.
// Catches runtime errors in the data and the render; prints a short summary.
//
//   node scripts/check-progress.mjs

import { createServer } from 'vite'

// Browser globals the app touches while rendering.
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
let width = 390
const matches = (q) => {
  const min = /min-width:\s*(\d+)px/.exec(q)
  const max = /max-width:\s*([\d.]+)px/.exec(q)
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
}
globalThis.window = globalThis
const el = { dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } }
globalThis.document = { documentElement: el, body: el, querySelector: () => null, addEventListener() {}, removeEventListener() {} }
globalThis.matchMedia = (q) => ({ matches: matches(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

const vite = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  // Libraries load natively (Vite externalizes them for the app modules too, so it's one React).
  const React = (await import('react')).default
  const { renderToString } = await import('react-dom/server')
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { MemoryRouter } = await import('react-router')
  const { demo } = await vite.ssrLoadModule('/src/lib/demo.ts')
  const { progressFrom } = await vite.ssrLoadModule('/src/lib/progress.ts')
  const { ProgressPage } = await vite.ssrLoadModule('/src/features/client/progress/ProgressPage.tsx')
  const { AuthContextForTests } = await vite.ssrLoadModule('/src/app/auth.tsx')

  const brandNew = progressFrom({ today: '2026-10-04', start_date: '2026-10-04', goal_weight_kg: null, days: [], meals: [], targets: [], programs: [], sessions: [], check_ins: [] }, 'p12')
  for (const period of ['p4', 'p12', 'all']) {
    const d = demo.progressDetail(period)
    const k = d.kpis
    console.log(`demo ${period}: ${d.weeks.length} weeks · weight ${k.weight.value} kg (${k.weight.change} change, ${k.weight.to_goal} to goal, prev ${k.weight.previous})`
      + ` · workouts ${k.workouts.value}% ${k.workouts.done}/${k.workouts.planned} streak ${k.workouts.streak}`
      + ` · kcal ${k.calories.value}/${k.calories.target} · protein ${k.protein.value}/${k.protein.target} · on plan ${k.meals_on_plan.value}%`
      + ` · steps ${k.steps.value}/${k.steps.target} · sleep ${k.sleep.value}/${k.sleep.target} · water ${k.water.value}`
      + ` · lifts ${d.strength.map((s) => `${s.name} (${s.sessions})`).join(', ')} · muscles ${d.training.muscles.slice(0, 3).map((m) => `${m.muscle} ${m.sets}`).join(', ')}`
      + ` · projection ${d.weight.projection ? d.weight.projection.kg : '-'} · check-ins ${d.check_ins.length}`)
  }

  const render = (detail, units, w) => {
    width = w
    const qc = new QueryClient()
    qc.setQueryData(['progress'], demo.progress())
    qc.setQueryData(['progress-detail', 'p12'], detail)
    const user = { id: 'c-aisha', email: 'a@example.test', full_name: 'Aisha Rahman', first_name: 'Aisha', initials: 'AR', role: 'client', setupDone: true, coachFirstName: 'S', units }
    const tree = React.createElement(AuthContextForTests.Provider, { value: { status: 'ready', user, error: null, notice: null, clearNotice() {}, refresh: async () => {}, signOut: async () => {} } },
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(MemoryRouter, null, React.createElement(ProgressPage))))
    return renderToString(tree)
  }
  for (const [name, w] of [['phone', 390], ['tablet', 900], ['desktop', 1400]]) {
    for (const units of ['imperial', 'metric']) {
      const html = render(demo.progressDetail('p12'), units, w)
      const cards = (html.match(/class="card chart-card/g) ?? []).length
      const unit = units === 'imperial' ? / lb/ : / kg/
      console.log(`render ${name} ${units}: ${html.length} chars · ${cards} chart cards · ${(html.match(/class="card kpi"/g) ?? []).length} KPIs · unit shown ${unit.test(html)} · section tabs ${html.includes('section-tabs')}`)
    }
  }
  const empty = render(brandNew, 'imperial', 390)
  console.log(`render brand-new client: KPIs empty ${(empty.match(/<b class="num">—<\/b>/g) ?? []).length} of 6 · "No weigh-ins" ${empty.includes('No weigh-ins')} · NaN ${empty.includes('NaN')} · undefined ${empty.includes('undefined')}`)
  const full = render(demo.progressDetail('all'), 'imperial', 1400)
  console.log(`render desktop since start: NaN ${full.includes('NaN')} · undefined ${full.includes('>undefined')} · Infinity ${full.includes('Infinity')}`)
} finally {
  await vite.close()
  process.exit(0) // React Query's cache timers would keep Node alive
}
