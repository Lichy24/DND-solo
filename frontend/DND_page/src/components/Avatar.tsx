import { useId } from 'react'

/** Portrait with a shadow-figure placeholder (blurred silhouette + question mark). */
export function Avatar({ name, src, size = 44 }: { name: string; src?: string; size?: number }) {
  const id = useId().replace(/:/g, '')
  if (src) return <img className="avatar" src={src} alt="" width={size} height={size} />
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${name}, no portrait yet`}>
      <defs>
        <radialGradient id={`${id}bg`} cx="50%" cy="35%" r="75%">
          <stop offset="0" stopColor="#3a4658" />
          <stop offset="1" stopColor="#141a22" />
        </radialGradient>
        <linearGradient id={`${id}fig`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c1015" />
          <stop offset="1" stopColor="#1a212b" />
        </linearGradient>
        <filter id={`${id}soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
        <clipPath id={`${id}clip`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}clip)`}>
        <rect width="64" height="64" fill={`url(#${id}bg)`} />
        <g filter={`url(#${id}soft)`} fill={`url(#${id}fig)`}>
          <circle cx="32" cy="25" r="11.5" />
          <path d="M8 66c0-17 10-25 24-25s24 8 24 25z" />
        </g>
        <text x="32" y="31" textAnchor="middle" fontFamily="Alegreya SC, Georgia, serif" fontWeight="700" fontSize="17" fill="#c2a15e" opacity=".85">
          ?
        </text>
      </g>
      <circle cx="32" cy="32" r="31" fill="none" stroke="#c2a15e" strokeOpacity=".5" strokeWidth="1.5" />
    </svg>
  )
}
