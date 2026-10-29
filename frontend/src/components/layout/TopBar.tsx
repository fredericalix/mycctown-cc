import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useMapStore } from '../../stores/useMapStore';
import { useOrgStore } from '../../stores/useOrgStore';
import { useRealtimeStore } from '../../stores/useRealtimeStore';
import { MayorHistory } from '../mayor/MayorHistory';
import { CinematicToggle } from './CinematicToggle';
import { FullscreenToggle } from './FullscreenToggle';
import { MayorToggle } from './MayorToggle';
import { MusicToggle } from './MusicToggle';
import { OrgSelector } from './OrgSelector';
import { WebhookSetupModal } from './WebhookSetupModal';

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const saveStatus = useMapStore((s) => s.saveStatus);
  const wsConnected = useRealtimeStore((s) => s.connected);
  const wsError = useRealtimeStore((s) => s.lastError);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const [showWebhookModal, setShowWebhookModal] = useState(false);

  return (
    <header className="cc-panel flex items-center justify-between px-4 py-2 border-b cc-border-soft">
      <div className="flex items-center gap-5">
        <span className="font-brand text-2xl" style={{ color: 'var(--cc-white)' }}>
          myCCtown
        </span>
        <span className="h-5 w-px bg-white/10" />
        <OrgSelector />
        <SaveIndicator status={saveStatus} />
        {currentOrgId && <LiveIndicator connected={wsConnected} error={wsError} />}
        {currentOrgId && (
          <button
            onClick={() => setShowWebhookModal(true)}
            className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
            style={{
              background: 'rgba(241,240,251,0.06)',
              color: 'var(--cc-white)',
            }}
            title="Set up real-time webhook for this org"
          >
            <span>⚡</span>Realtime setup
          </button>
        )}
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="font-overtitle text-[10px] flex items-center gap-1.5 rounded px-2 py-1 transition"
          style={{
            background: 'rgba(241,240,251,0.06)',
            color: 'var(--cc-white)',
          }}
          title="Open the documentation in a new tab"
        >
          <span>📖</span>Docs
        </a>
        <MusicToggle />
        <MayorToggle />
        <FullscreenToggle />
        <CinematicToggle />
      </div>
      <MayorHistory />
      {showWebhookModal && currentOrgId && (
        <WebhookSetupModal
          orgId={currentOrgId}
          onClose={() => setShowWebhookModal(false)}
        />
      )}
      <div className="flex items-center gap-3 text-sm">
        <span className="cc-muted">{user?.name ?? user?.email ?? user?.cc_user_id}</span>
        <button
          onClick={() => {
            void logout();
          }}
          className="rounded px-3 py-1 text-xs transition"
          style={{
            background: 'rgba(241,240,251,0.06)',
            color: 'var(--cc-white)',
          }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function LiveIndicator({ connected, error }: { connected: boolean; error: string | null }) {
  const color = error
    ? 'var(--cc-red-1)'
    : connected
      ? 'var(--cc-green)'
      : 'var(--cc-gray)';
  const label = error ? 'ws error' : connected ? 'live' : 'offline';
  return (
    <span
      className="font-overtitle text-[10px] flex items-center gap-1.5"
      style={{ color }}
      title={error ?? (connected ? 'WebSocket connected' : 'Reconnecting…')}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const map: Record<Exclude<SaveStatus, 'idle'>, { label: string; color: string }> = {
    saving: { label: 'Saving…', color: 'var(--cc-gray)' },
    saved: { label: 'Saved', color: 'var(--cc-green)' },
    error: { label: 'Save failed', color: 'var(--cc-red-1)' },
  };
  const { label, color } = map[status];
  return (
    <span className="font-overtitle text-[10px]" style={{ color }}>
      {label}
    </span>
  );
}
