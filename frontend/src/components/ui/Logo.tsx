import { useId } from 'react'

/** The Yuktara mark: raised-arms Y, two leaves, gold-to-green ring, star. */
export function LogoMark({ size = 40, tile = true, fg = tile ? '#F3EFE4' : 'var(--ink)' }: { size?: number; tile?: boolean; fg?: string }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Yuktara">
      <defs>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#DDAC4F" />
          <stop offset="1" stopColor="#5A8A3C" />
        </linearGradient>
      </defs>
      {tile && <rect width="64" height="64" rx="15" fill="#123A2B" />}
      <path d="M24.5 12.6 A21 21 0 1 0 39.5 12.6" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 6.5 l1.5 3.6 3.6 1.5 -3.6 1.5 -1.5 3.6 -1.5 -3.6 -3.6 -1.5 3.6 -1.5z" fill="#DDAC4F" />
      <circle cx="32" cy="22.5" r="3.6" fill={fg} />
      <path d="M22.5 20.5 C25 27 28 29.5 30 30.5 L30 44 L34 44 L34 30.5 C36 29.5 39 27 41.5 20.5" fill="none" stroke={fg} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 46 C24 46 18.5 43 16.5 36.5 C23 36 28.5 39.5 30 46z" fill="#5A8A3C" />
      <path d="M34 46 C40 46 45.5 43 47.5 36.5 C41 36 35.5 39.5 34 46z" fill="#8CC27A" />
    </svg>
  )
}

/** Wordmark set in capitals with open, bar-less A's. */
export function Wordmark({ height = 18, color = 'currentColor' }: { height?: number; color?: string }) {
  return (
    <svg height={height} width={height * 6.9} viewBox="-0.6 -0.6 68.7 11.2" aria-label="YUKTARA" role="img"
      fill="none" stroke={color} strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0.5 0.5 L3.5 5 L6.5 0.5 M3.5 5 V9.5" />
      <path d="M10.5 0.5 V6 C10.5 8.3 11.7 9.5 13.5 9.5 C15.3 9.5 16.5 8.3 16.5 6 V0.5" />
      <path d="M20.5 0.5 V9.5 M26.5 0.5 L20.8 5.8 M22.8 4 L27 9.5" />
      <path d="M30 0.5 H37 M33.5 0.5 V9.5" />
      <path d="M40 9.5 L43.5 0.5 L47 9.5" />
      <path d="M50.5 9.5 V0.5 H53.5 C55.5 0.5 56.5 1.6 56.5 3.2 C56.5 4.8 55.5 5.9 53.5 5.9 H50.5 M53.5 5.9 L57 9.5" />
      <path d="M60 9.5 L63.5 0.5 L67 9.5" />
    </svg>
  )
}
