import { useEffect } from 'react';
import { useMayorStore } from '../../stores/useMayorStore';
import { MayorPortrait, moodAccent } from './MayorPortrait';

/** How long an announcement stays before auto-advancing. Bad news lingers. */
function dwellMs(mood: string): number {
  return mood === 'alarmed' ? 9_000 : 6_500;
}

/**
 * The mayor advisor popup. Sits bottom-left over the 3D scene (clear of the
 * 74px builder rail), shows one announcement at a time, auto-dismisses after a
 * mood-dependent dwell, then pulls the next queued announcement in.
 *
 * Mounted inside the scene's `<main>` (App.tsx) — never on the /docs route, so
 * it can't interfere with that page's scroll container.
 */
export function MayorPopup() {
  const current = useMayorStore((s) => s.current);
  const next = useMayorStore((s) => s.next);

  // Auto-advance timer, reset whenever the displayed announcement changes.
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => next(), dwellMs(current.mood));
    return () => window.clearTimeout(t);
  }, [current, next]);

  if (!current) return null;
  const accent = moodAccent(current.mood);

  return (
    <div
      // `key` re-triggers the slide-in animation on each new announcement.
      key={current.id}
      className="mayor-pop cc-panel absolute z-30 rounded-2xl p-5 pr-12 flex items-center gap-5 pointer-events-auto"
      style={{
        left: 88,
        bottom: 24,
        width: 680,
        maxWidth: 'calc(100vw - 112px)',
        borderLeft: `5px solid ${accent}`,
      }}
      role="status"
      aria-live="polite"
    >
      <MayorPortrait mood={current.mood} size={112} />

      <div className="min-w-0">
        <div className="font-overtitle text-[14px]" style={{ color: accent }}>
          The Mayor
        </div>
        <div className="font-brand text-[28px] leading-tight text-white">
          {current.title}
        </div>
        <div className="cc-muted text-[18px] mt-1 truncate" title={current.detail}>
          {current.detail}
        </div>
      </div>

      <button
        onClick={() => next()}
        className="absolute top-3 right-3 cc-muted hover:text-white text-lg leading-none"
        title="Dismiss"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
