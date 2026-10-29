import { useEffect, useState } from 'react';
import type { MayorMood } from '../../stores/useMayorStore';

/** Accent colour per mood — green = good news, orange = info, red = bad news. */
export function moodAccent(mood: MayorMood): string {
  switch (mood) {
    case 'happy':
      return 'var(--cc-green)';
    case 'alarmed':
      return 'var(--cc-red-1)';
    default:
      return 'var(--cc-orange)';
  }
}

/** Emoji shown if the portrait PNG isn't present yet (graceful placeholder). */
function moodEmoji(mood: MayorMood): string {
  switch (mood) {
    case 'happy':
      return '😄';
    case 'alarmed':
      return '😱';
    default:
      return '🧐';
  }
}

function portraitSrc(mood: MayorMood): string {
  return `/mayor/mayor_${mood}.png`;
}

/**
 * The mayor's portrait, ringed in the mood's accent colour. Falls back to a
 * crowned medallion + mood emoji while the generated PNGs aren't in place, so
 * the feature works end-to-end before the art lands.
 */
export function MayorPortrait({ mood, size }: { mood: MayorMood; size: number }) {
  const [failed, setFailed] = useState(false);
  const accent = moodAccent(mood);

  // Re-attempt the image when the mood changes (different file).
  useEffect(() => setFailed(false), [mood]);

  return (
    <div
      className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
      style={{
        width: size,
        height: size,
        border: `2px solid ${accent}`,
        background: 'rgba(0,0,0,0.35)',
        boxShadow: `0 0 14px ${accent}55`,
      }}
    >
      {failed ? (
        <span
          className="flex flex-col items-center justify-center leading-none"
          style={{ fontSize: size * 0.42 }}
          aria-hidden
        >
          <span style={{ fontSize: size * 0.24 }}>👑</span>
          <span>{moodEmoji(mood)}</span>
        </span>
      ) : (
        <img
          src={portraitSrc(mood)}
          alt="The mayor"
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
