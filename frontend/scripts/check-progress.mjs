// Renders the Progress page to HTML in Node (no browser), with the demo data,
// for phone, tablet and desktop layouts and both units, plus a brand-new client,
// and the coach's Insights card for every demo client. Catches runtime errors in
// the data and the render, and any NaN, undefined or Infinity in the output;
// prints a short summary and exits 1 if anything is wrong.
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
  const { SignalsCard } = await vite.ssrLoadModule('/src/components/progress/SignalsCard.tsx')
  const { rowFlags, signalsFor } = await vite.ssrLoadModule('/src/lib/insights.ts')
  const problems = []
  const bad = (label, text) => {
    const m = /NaN|>undefined|undefined[ <]|Infinity/.exec(text)
    if (m) problems.push(`${label}: "${text.slice(Math.max(0, m.index - 60), m.index + 20)}"`)
  }

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
    const f = d.weight.forecast
    const sig = signalsFor(d, 'metric', 'client')
    console.log(`  forecast: enough ${f.enough} · slope ${f.slope_kg_week} kg/wk · goal ${f.goal ? `${f.goal.date} (${f.goal.early} – ${f.goal.late})` : f.goal_note}`
      + ` · weight plateau ${d.weight.plateau ? `${d.weight.plateau.weeks} wk` : 'none'}`
      + ` · lifts ${d.strength.map((l) => `${l.name} ${l.points.at(-1)?.smooth} kg${l.forecast.enough ? ` → ${l.forecast.points.at(-1).kg} (${l.forecast.points.at(-1).lo}–${l.forecast.points.at(-1).hi})` : ' (no forecast)'}${l.plateau ? ' plateau' : ''}`).join(', ')}`)
    console.log(`  card: ${[sig.goal, sig.next, ...sig.plateaus, ...sig.insights.map((i) => `[${i.id}] ${i.text}`)].filter(Boolean).join(' | ')}`)
    bad(`signals ${period}`, JSON.stringify(sig))
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
      bad(`render ${name} ${units}`, html)
      const cards = (html.match(/class="card chart-card/g) ?? []).length
      const unit = units === 'imperial' ? / lb/ : / kg/
      const insights = html.indexOf('class="card signals')
      const weight = html.indexOf('<h3>Weight</h3>')
      const order = insights < 0 ? 'missing' : insights < weight ? 'insights first' : 'weight first'
      console.log(`render ${name} ${units}: ${html.length} chars · ${cards} chart cards · ${(html.match(/class="card kpi"/g) ?? []).length} KPIs · unit shown ${unit.test(html)}`
        + ` · section tabs ${html.includes('section-tabs')} · Insights card ${order} · "Estimates" ${html.includes('>Estimates<')} · band ${html.includes('opacity="0.14"')}`)
      if (insights < 0 || (name === 'phone') !== (order === 'insights first')) problems.push(`${name} ${units}: Insights card ${order}`)
      if (!unit.test(html)) problems.push(`${name} ${units}: unit not shown`)
    }
  }
  for (const units of ['imperial', 'metric']) {
    for (const [name, w] of [['phone', 390], ['desktop', 1400]]) {
      const empty = render(brandNew, units, w)
      bad(`brand-new ${name} ${units}`, empty)
      console.log(`render brand-new client ${name} ${units}: KPIs empty ${(empty.match(/<b class="num">—<\/b>/g) ?? []).length} of 6 · "No weigh-ins" ${empty.includes('No weigh-ins')} · "Not enough data yet" ${empty.includes('Not enough data yet')}`)
      if (!empty.includes('Not enough data yet')) problems.push(`brand-new ${name} ${units}: no "Not enough data yet"`)
    }
  }
  for (const period of ['p4', 'all']) {
    for (const units of ['imperial', 'metric']) bad(`render desktop ${period} ${units}`, render(demo.progressDetail(period), units, 1400))
  }

  // Coach side: every demo client's Insights card and list flags, both units.
  const rows = demo.coachClients()
  for (const units of ['imperial', 'metric']) {
    let flagged = 0
    for (const r of rows) {
      const d = demo.clientProgress(r.client.id, 'p12')
      const html = renderToString(React.createElement(SignalsCard, { d, units, voice: 'coach' }))
      bad(`coach card ${r.client.first_name} ${units}`, html)
      const flags = r.signals ? rowFlags(r.signals, '2026-10-04') : []
      if (flags.length) flagged++
      if (units === 'metric' && (r.client.first_name === 'Aisha' || r.client.first_name === 'Priya' || r.client.first_name === 'Hana')) {
        const s = signalsFor(d, units, 'coach')
        console.log(`coach ${r.client.first_name}: flags [${flags.map((f) => f.text).join(', ')}] · ${[s.goal, ...s.plateaus, ...s.insights.map((i) => i.text)].filter(Boolean).join(' | ')}`)
      }
    }
    const lb = renderToString(React.createElement(SignalsCard, { d: demo.clientProgress('c-jordan', 'p12'), units, voice: 'coach' }))
    console.log(`coach cards ${units}: ${rows.length} clients rendered · ${flagged} with list flags · unit shown ${(units === 'imperial' ? / lb/ : / kg/).test(lb)}`)
  }

  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
  } else console.log('all checks passed')
} finally {
  await vite.close()
  process.exit(process.exitCode ?? 0) // React Query's cache timers would keep Node alive
}
