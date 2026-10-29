// Runs after `vite build` (npm run build): saves the public pages as finished
// HTML so search engines and link previews read them without running the app,
// and writes sitemap.xml and robots.txt. The page list, text and tags come from
// src/features/public/site.ts.
//
//   dist/index.html          the landing page (/), pre-rendered
//   dist/privacy/index.html  /privacy, pre-rendered
//   dist/app.html            the plain app shell, noindex: netlify.toml serves it for every app route
//   dist/sitemap.xml, dist/robots.txt
//
// The app still starts as usual on these pages (it replaces the pre-rendered
// HTML when it loads); index.html hides the pre-rendered page from anyone
// already signed in.
//
//   node scripts/prerender.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const dist = join(root, 'dist')
const fail = (msg) => { console.error(`prerender: ${msg}`); process.exit(1) }

// The app modules expect a browser's storage; at build time nobody is signed in.
const store = new Map()
globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, length: 0 }

const template = readFileSync(join(dist, 'index.html'), 'utf8')
const TITLE = '<title>Yuktara</title>'
const ROOT = '<div id="root"></div>'
// The app shell's general description; each public page has its own instead.
const DESCRIPTION = /\n\s*<meta name="description"[^>]*>/
if (!template.includes(TITLE) || !template.includes(ROOT) || !DESCRIPTION.test(template)) fail('dist/index.html is missing the <title>, description or empty #root this script fills in')

const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const React = (await import('react')).default
  const { renderToString } = await import('react-dom/server')
  const { MemoryRouter } = await import('react-router')
  const site = await vite.ssrLoadModule('/src/features/public/site.ts')
  const { LandingPage } = await vite.ssrLoadModule('/src/features/public/LandingPage.tsx')
  const { PrivacyPage } = await vite.ssrLoadModule('/src/features/public/PrivacyPage.tsx')
  const components = { '/': LandingPage, '/privacy': PrivacyPage }

  // The app shell for every route behind sign-in: never indexed.
  writeFileSync(join(dist, 'app.html'), template.replace(TITLE, `${TITLE}\n    <meta name="robots" content="noindex" />`))

  for (const page of site.PUBLIC_PAGES) {
    const Component = components[page.path]
    if (!Component) fail(`no component for ${page.path}`)
    const body = renderToString(React.createElement(MemoryRouter, { initialEntries: [page.path] }, React.createElement(Component)))
    if (/NaN|>undefined<|Infinity/.test(body)) fail(`${page.path} rendered NaN, undefined or Infinity`)
    const html = template
      .replace(DESCRIPTION, '')
      .replace(TITLE, site.headTags(page))
      .replace(ROOT, `<div id="root"><div data-prerendered>${body}</div></div>`)
    const file = page.path === '/' ? join(dist, 'index.html') : join(dist, page.path.slice(1), 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, html)
    console.log(`prerender: ${page.path} → ${file.slice(root.length)} (${Math.round(html.length / 1024)} kB)`)
  }

  writeFileSync(join(dist, 'sitemap.xml'), site.sitemapXml(new Date().toISOString().slice(0, 10)))
  writeFileSync(join(dist, 'robots.txt'), site.robotsTxt())
  console.log(`prerender: sitemap.xml and robots.txt for ${site.SITE_URL}`)
} finally {
  await vite.close()
}
