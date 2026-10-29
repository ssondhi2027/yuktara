// Unit tests for the public pages' search tags, sitemap and robots.txt (src/features/public/site.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FAQ, headTags, PRIVATE_PATHS, PUBLIC_PAGES, robotsTxt, SITE_URL, sitemapXml, structuredData } from '../src/features/public/site.ts'

test('every public page has a short title and description, and a unique path', () => {
  assert.equal(new Set(PUBLIC_PAGES.map((p) => p.path)).size, PUBLIC_PAGES.length)
  for (const p of PUBLIC_PAGES) {
    assert.ok(p.title.length >= 20 && p.title.length <= 60, `${p.path} title: ${p.title.length} characters`)
    assert.ok(p.description.length >= 70 && p.description.length <= 160, `${p.path} description: ${p.description.length} characters`)
    assert.ok(!PRIVATE_PATHS.some((x) => p.path.startsWith(x)), `${p.path} is public, not an app page`)
  }
})

test('head tags: canonical, Open Graph and Twitter on the site address, valid JSON-LD', () => {
  assert.match(SITE_URL, /^https:\/\/[^/]+[^/]$/)
  const home = headTags(PUBLIC_PAGES[0])
  assert.ok(home.includes(`<link rel="canonical" href="${SITE_URL}/" />`))
  assert.ok(home.includes(`<meta property="og:image" content="${SITE_URL}/og-image.png" />`))
  assert.ok(home.includes('<meta name="twitter:card" content="summary_large_image" />'))
  const privacy = headTags(PUBLIC_PAGES.find((p) => p.path === '/privacy')!)
  assert.ok(privacy.includes(`<link rel="canonical" href="${SITE_URL}/privacy" />`))
  // Each JSON-LD block parses, and can't close its <script> early.
  for (const page of PUBLIC_PAGES) {
    const blocks = [...headTags(page).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => m[1])
    assert.equal(blocks.length, structuredData(page).length)
    for (const b of blocks) {
      assert.ok(!b.includes('<'))
      assert.equal(JSON.parse(b)['@context'], 'https://schema.org')
    }
  }
  const faq = structuredData(PUBLIC_PAGES[0]).find((d) => (d as { '@type': string })['@type'] === 'FAQPage') as { mainEntity: unknown[] }
  assert.equal(faq.mainEntity.length, FAQ.length)
})

test('titles and descriptions are escaped for HTML', () => {
  const tags = headTags({ path: '/x', title: 'A "quoted" <title> & more', description: 'd', priority: 0.1 })
  assert.ok(tags.includes('<title>A &quot;quoted&quot; &lt;title&gt; &amp; more</title>'))
})

test('sitemap lists the public pages only; robots.txt keeps the app out and points to the sitemap', () => {
  const xml = sitemapXml('2026-10-29')
  assert.equal((xml.match(/<url>/g) ?? []).length, PUBLIC_PAGES.length)
  assert.ok(xml.includes(`<loc>${SITE_URL}/</loc>`) && xml.includes(`<loc>${SITE_URL}/privacy</loc>`))
  assert.ok(xml.includes('<lastmod>2026-10-29</lastmod>'))
  assert.ok(!PRIVATE_PATHS.some((p) => xml.includes(`${SITE_URL}${p}<`)))
  const robots = robotsTxt()
  for (const p of PRIVATE_PATHS) assert.ok(robots.includes(`Disallow: ${p}\n`))
  assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`))
  assert.ok(!robots.includes('Disallow: /\n'))
})
