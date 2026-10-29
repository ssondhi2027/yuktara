import { useEffect } from 'react'
import { Link } from 'react-router'
import { PublicFooter, PublicHeader } from './LandingPage'
import { PUBLIC_PAGES, SITE_NAME } from './site'
import './public.css'

const page = PUBLIC_PAGES.find((p) => p.path === '/privacy')!

/** /privacy: what the app stores and who can see it, in plain words. Saved as finished HTML at build time. */
export function PrivacyPage() {
  useEffect(() => { document.title = page.title }, [])
  return (
    <div className="public">
      <PublicHeader />
      <main className="public-section">
        <article className="public-wrap narrow prose">
          <p className="eyebrow">Privacy</p>
          <h1>How {SITE_NAME} handles your data</h1>
          <p className="lead">In short: your data is for you and your coach. Nobody else can see it, and nothing is sold or used for ads.</p>

          <h2>What is stored</h2>
          <ul>
            <li><b>Your account:</b> your name, email address, units (kg or lb) and profile picture if you add one.</li>
            <li><b>Your setup answers:</b> goal, experience, training days, diet, foods to avoid, injuries and similar, so your coach can plan for you.</li>
            <li><b>What you log:</b> workouts and sets, cardio, meals and foods, steps, water, sleep, weight, check-ins, progress photos, measurements and messages.</li>
            <li><b>What your coach sets:</b> programs, targets, meal plans and their replies to you.</li>
          </ul>

          <h2>Who can see it</h2>
          <ul>
            <li><b>You,</b> and <b>your coach</b> (the coach whose invite code you joined with). The database enforces this on every request, not just the app's screens.</li>
            <li><b>Not</b> other clients, and <b>not</b> other coaches.</li>
            <li>Progress and meal photos are private files. They open through links that stop working after an hour.</li>
            <li>A coach's private notes about a client are visible to that coach only.</li>
          </ul>

          <h2>Guest mode</h2>
          <p>
            If you try {SITE_NAME} without an account, everything you log stays in your browser on that device and is never sent to our servers.
            Signing out of guest mode, or choosing "Delete my data", removes it.
          </p>

          <h2>Where it's kept</h2>
          <p>
            Accounts, data and photos are kept with Supabase (database, sign-in and file storage). A small server of ours handles a few
            actions such as sending a check-in or uploading photos. The website itself is served by Netlify.
          </p>

          <h2>Emails</h2>
          <p>Your email address is used to sign you in and to confirm your account or reset your password. We don't send marketing email.</p>

          <h2>Cookies and tracking</h2>
          <p>
            {SITE_NAME} has no ads and no analytics or tracking scripts. It keeps your sign-in and a few preferences (such as light or dark mode)
            in your browser's storage. The fonts are loaded from Google Fonts, which sees your browser's request for them.
          </p>

          <p className="muted small">Questions about your data? Ask your coach, or contact the {SITE_NAME} team.</p>
          <p><Link to="/" className="btn btn-ghost btn-sm">Back to {SITE_NAME}</Link></p>
        </article>
      </main>
      <PublicFooter />
    </div>
  )
}
