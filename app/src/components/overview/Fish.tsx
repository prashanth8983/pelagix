// The overview water scene: three brand fish (docs/brand/pelagix-mark-wave.svg) over and in
// a band of water that the Ask box floats on. Decorative only: hidden from assistive tech,
// and still for prefers-reduced-motion.
//
// Layers, back to front: deep water and a small fish swimming through it, a large fish
// cruising just under the surface, the surface itself (a translucent fill, so anything below
// it reads as submerged), then a fish that leaps out of the water, dives back in and raises a
// splash, and a few bubbles. Each fish has its own carrier (position across the scene) and an
// inner element for bob or arc, so the motion never looks mechanical.

function FishShape({ id, tint = 1 }: { id: string; tint?: number }) {
  return (
    <svg viewBox="54 46 110 56" className="relative w-full overflow-visible" style={{ opacity: tint }}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <path className="fish-tail" d="M132,74 L162,52 L150,74 L162,96Z" fill="var(--brand)" />
      <path className="fish-fin" d="M96,62 L114,50 L112,66Z" fill="var(--brand)" opacity="0.9" />
      <path d="M58,74 C74,52 116,50 136,74 C116,98 74,96 58,74Z" fill={`url(#${id}-body)`} />
      <path d="M66,70 C80,60 104,58 124,68 C108,64 84,65 66,70Z" fill="#fff" opacity="0.22" />
      <path className="fish-fin" d="M98,82 L112,94 L116,80Z" fill="var(--accent)" opacity="0.8" />
      <circle cx="72" cy="70" r="4.5" fill="var(--surface)" />
      <circle cx="71" cy="70" r="2.4" fill="var(--primary)" />
      <circle cx="70.2" cy="69.2" r="0.8" fill="#fff" />
    </svg>
  )
}

const WAVE = (y: number, amp: number) =>
  `M-80 ${y} ` + Array.from({ length: 22 }, (_, i) => (i === 0 ? `q20-${amp} 40 0` : 't40 0')).join(' ')

export function WaterScene({ className }: { className?: string }) {
  return (
    <div aria-hidden className={`fish-scene relative h-[204px] w-full select-none overflow-hidden ${className ?? ''}`}>
      {/* Deep water: a soft gradient that gets denser toward the bottom. */}
      <div className="water-deep absolute inset-x-0 bottom-0 h-[124px]" />

      {/* A small fish well below the surface, heading the other way. */}
      <div className="fish-carrier-deep absolute top-[158px] w-[40px]">
        <div className="fish-bob-slow"><FishShape id="fish-deep" tint={0.55} /></div>
      </div>

      {/* The big fish cruising just under the surface. */}
      <div className="fish-carrier absolute top-[108px] w-[76px]">
        <div className="fish-bob"><FishShape id="fish-main" tint={0.92} /></div>
      </div>

      {/* The surface: a translucent fill in front of the swimmers, and two crest lines. */}
      <svg viewBox="0 0 640 124" className="water-surface absolute inset-x-0 bottom-0 h-[124px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="water-surface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path className="wave-drift-slow" fill="url(#water-surface)" d={`${WAVE(30, 10)} V124 H-80Z`} />
        <path className="wave-drift-slow" fill="none" stroke="var(--brand)" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" d={WAVE(30, 10)} />
        <path className="wave-drift-fast" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round" d={WAVE(44, 7)} />
        <path className="wave-drift-fast" fill="none" stroke="var(--accent)" strokeOpacity="0.25" strokeWidth="1.2" strokeLinecap="round" d={WAVE(58, 6)} />
      </svg>

      {/* The leaper: out of the water on the left, an arc, a dive on the right, then a splash. */}
      {/* The shape faces left, and the leap travels right, so the carrier mirrors it. */}
      <div className="fish-leap-x absolute top-[108px] w-[58px]">
        <div className="fish-leap-y"><div className="scale-x-[-1]"><FishShape id="fish-leap" /></div></div>
      </div>
      <div className="fish-splash absolute left-[58%] top-[102px] -ml-8 w-16">
        <span className="splash-ring absolute left-1/2 top-3 h-3 w-12 -translate-x-1/2 rounded-[50%] border-2 border-[var(--brand)]" />
        {[-22, -11, -3, 6, 14, 24].map((dx, i) => (
          <span key={i} className="splash-drop absolute left-1/2 top-2 size-2 rounded-full bg-[var(--brand)]"
            style={{ ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${-22 - (i % 3) * 12}px` }} />
        ))}
      </div>

      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="fish-bubble absolute top-[160px] rounded-full border border-[var(--brand)]"
          style={{ animationDelay: `${i * 1.3}s`, left: `${14 + i * 24}%`, width: i % 2 ? 5 : 7, height: i % 2 ? 5 : 7 }} />
      ))}
    </div>
  )
}

/** Kept for callers that import the old name. */
export const SwimmingFish = WaterScene
