import { useMapStore } from '../../stores/useMapStore';
import { useAnimationStore } from '../../stores/useAnimationStore';
import { useUiModeStore } from '../../stores/useUiModeStore';

/**
 * Minimal side rail. Top stack: primary mode toggle (builder / view).
 * Middle stack: live scene animation toggles (wind, water, day-night,
 * particles, clouds). Bottom: clear-city escape hatch + autosave dot.
 *
 * The mode toggle used to live in the topbar but visually competed with
 * the user menu there — moving it here makes it the first control the eye
 * lands on when looking at the tool rail.
 */
export function LeftSidebar() {
  const clearMap = useMapStore((s) => s.clearMap);
  const saveStatus = useMapStore((s) => s.saveStatus);
  const uiMode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);

  return (
    <div className="absolute left-0 top-0 bottom-0 z-20 flex pointer-events-none">
      <div
        className="cc-panel flex flex-col items-center py-3 px-2 gap-2 pointer-events-auto w-[74px]"
        style={{
          borderLeft: 'none',
          borderTopRightRadius: 14,
          borderBottomRightRadius: 14,
        }}
      >
        <ModeButton
          icon="✎"
          label="Builder"
          active={uiMode === 'builder'}
          onClick={() => setMode('builder')}
        />
        <ModeButton
          icon="👁"
          label="View"
          active={uiMode === 'view'}
          onClick={() => setMode('view')}
        />

        <Separator />

        <AnimToggles />

        <Separator />

        <button
          onClick={clearMap}
          title="Clear city (resets all placements)"
          className="w-full rounded-lg py-2 flex flex-col items-center gap-0.5 transition"
          style={{ color: 'var(--cc-red-1)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(230,63,72,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="text-xl leading-none">🧹</span>
          <span className="text-[11px] leading-tight font-medium">Clear</span>
        </button>

        <div className="flex-1" />

        <SaveDot status={saveStatus} />
      </div>
    </div>
  );
}

function ModeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-full rounded-lg py-2 flex flex-col items-center gap-0.5 transition"
      style={{
        background: active ? 'rgba(165,16,80,0.35)' : 'transparent',
        color: active ? 'var(--cc-white)' : 'var(--cc-gray-soft)',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(241,240,251,0.06)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[11px] leading-tight">{label}</span>
    </button>
  );
}

function Separator() {
  return <div className="w-10 h-px my-1" style={{ background: 'rgba(241,240,251,0.12)' }} />;
}

function SaveDot({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  const map = {
    saving: { label: '…', color: 'var(--cc-gray)' },
    saved: { label: '✓', color: 'var(--cc-green)' },
    error: { label: '⚠', color: 'var(--cc-red-1)' },
  } as const;
  const { label, color } = map[status];
  return (
    <span className="text-sm" style={{ color }} title={`Autosave: ${status}`}>
      {label}
    </span>
  );
}

function AnimToggles() {
  const store = useAnimationStore();
  const toggles = [
    { key: 'windEnabled' as const, icon: '💨', title: 'Wind' },
    { key: 'waterEnabled' as const, icon: '🌊', title: 'Water' },
    { key: 'dayNightEnabled' as const, icon: '🌅', title: 'Day / night cycle' },
    { key: 'particlesEnabled' as const, icon: '✨', title: 'Particles' },
    { key: 'cloudsEnabled' as const, icon: '☁️', title: 'Clouds' },
  ];

  return (
    <div className="flex flex-col gap-1 items-center">
      {toggles.map(({ key, icon, title }) => (
        <button
          key={key}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-lg transition"
          onClick={() => store.toggle(key)}
          title={title + (store[key] ? ' (on)' : ' (off)')}
          style={{
            background: store[key] ? 'rgba(17,190,169,0.15)' : 'transparent',
            opacity: store[key] ? 1 : 0.4,
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
