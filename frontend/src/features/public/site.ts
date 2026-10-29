// The public pages (the landing page and Privacy): their text, search-engine
// tags and structured data, in one place. scripts/prerender.mjs saves these
// pages as finished HTML at build time and writes sitemap.xml and robots.txt
// from the same list.

/** The live site's address, no trailing slash. Set VITE_SITE_URL in the build's environment if it changes. */
export const SITE_URL = ((import.meta.env?.VITE_SITE_URL as string | undefined) || 'https://yuktara.netlify.app').replace(/\/+$/, '')

export const SITE_NAME = 'Yuktara'
export const TAGLINE = 'Strong weeks, well fed.'
/** The share image (1200 × 630), in public/. */
export const SHARE_IMAGE = '/og-image.png'

export interface PublicPage {
  path: string
  /** under 60 characters: what search results show as the link */
  title: string
  /** under 160 characters: the snippet under it */
  description: string
  /** sitemap hint, 0–1 */
  priority: number
}

export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: 'Yuktara: online coaching app for training and nutrition',
    description: 'Coach clients week by week: programs, workout logging, meal plans, habits and weekly check-ins with progress charts. Try it without an account.',
    priority: 1,
  },
  {
    path: '/privacy',
    title: 'Privacy: how Yuktara handles your data',
    description: 'What Yuktara stores, who can see it (you and your coach, nobody else), and how guest mode keeps everything on your device.',
    priority: 0.3,
  },
]

/** App pages behind sign-in: kept out of search (robots.txt and a noindex header in netlify.toml). */
export const PRIVATE_PATHS = ['/login', '/train', '/food', '/check-in', '/progress', '/messages', '/settings', '/coach']

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I need a coach to use Yuktara?',
    a: 'No. You can log workouts, meals, steps, water, sleep and weight on your own, and try it without an account: in guest mode everything stays on your device. Programs, meal plans, targets and weekly check-ins come from a coach.',
  },
  {
    q: 'How does a client join their coach?',
    a: "The coach shares their invite code. The client creates an account with it, answers a short setup (goal, experience, training days, diet), and shows up in the coach's client list straight away.",
  },
  {
    q: 'Can I log cardio as well as weights?',
    a: 'Yes. Strength sets are logged as weight × reps, with warm-ups, drop sets and supersets. Cardio such as treadmill, cycling, rowing or swimming is logged by time, with distance, incline or level and heart rate if you like.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes. Yuktara is a web app built for phones first and also works on tablets and computers. You can add it to your home screen like an app.',
  },
  {
    q: 'Kilograms or pounds?',
    a: 'Either. Each person picks their own units, and coach and client can use different ones: weights are stored once and shown in each person\'s unit.',
  },
  {
    q: 'Who can see my data?',
    a: 'You and your coach, nobody else. Other clients and other coaches can\'t see it, and progress photos are private files opened through short-lived links.',
  },
]

const abs = (path: string) => `${SITE_URL}${path === '/' ? '/' : path}`

/** Structured data (JSON-LD) for a page: the web app on the landing page, its FAQ, and a breadcrumb elsewhere. */
export function structuredData(page: PublicPage): object[] {
  if (page.path === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE_NAME,
        url: abs('/'),
        description: page.description,
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires JavaScript',
        image: abs(SHARE_IMAGE),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ]
  }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE_NAME, item: abs('/') },
        { '@type': 'ListItem', position: 2, name: page.title.split(':')[0], item: abs(page.path) },
      ],
    },
  ]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The <head> tags for a page: title, description, canonical, Open Graph, Twitter and JSON-LD. */
export function headTags(page: PublicPage): string {
  const url = abs(page.path)
  const image = abs(SHARE_IMAGE)
  return [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${SITE_NAME}: ${esc(TAGLINE)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    ...structuredData(page).map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ')
}

/** sitemap.xml for the public pages. */
export function sitemapXml(lastmod: string): string {
  const urls = PUBLIC_PAGES.map((p) => `  <url>\n    <loc>${abs(p.path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/** robots.txt: the public pages in, the app out, and where the sitemap is. */
export function robotsTxt(): string {
  return ['User-agent: *', 'Allow: /', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n')
}
