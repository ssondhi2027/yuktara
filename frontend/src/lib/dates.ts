// Date helpers. Times are stored as timestamptz in UTC and shown in the
// user's timezone; dates (log_date, week_start) are plain 'YYYY-MM-DD'.

const DAY = 86_400_000

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseDate(iso).getTime() + days * DAY))
}

/** Monday of the week containing `iso` (check_ins.week_start is always a Monday). */
export function weekStart(iso: string): string {
  const d = parseDate(iso)
  const offset = (d.getDay() + 6) % 7
  return addDays(iso, -offset)
}

/** 1-based program week for a date, given the program start date. */
export function programWeek(startIso: string, iso: string): number {
  return Math.floor((parseDate(iso).getTime() - parseDate(startIso).getTime()) / (7 * DAY)) + 1
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', opts)

/** "Sun, Oct 4" */
export const shortDay = (iso: string) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(parseDate(iso))
/** "Sunday, October 4" */
export const longDay = (iso: string) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(parseDate(iso))
/** "Oct 4" */
export const monthDay = (iso: string) => fmt({ month: 'short', day: 'numeric' }).format(parseDate(iso))
/** "Mon" */
export const weekday = (iso: string) => fmt({ weekday: 'short' }).format(parseDate(iso))

/** "Sep 28 – Oct 4" for the week starting on `mondayIso`. */
export const weekRange = (mondayIso: string) => `${monthDay(mondayIso)} – ${monthDay(addDays(mondayIso, 6))}`

/** "6:40 PM" in the viewer's timezone. */
export const clockTime = (ts: string, timeZone?: string) =>
  fmt({ hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ts))

export function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

let pinned: string | null = null
/** Demo mode only: freezes "today" on the date the demo data was drawn for. */
export const pinToday = (iso: string) => { pinned = iso }
/** The local date ('YYYY-MM-DD'). */
export const today = () => pinned ?? toISODate(new Date())

/** Local calendar date (YYYY-MM-DD) of a timestamp. */
export const localDay = (ts: string) => toISODate(new Date(ts))
