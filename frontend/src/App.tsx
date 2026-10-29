import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from './components/auth/AuthGate';
import { LoginPage } from './components/auth/LoginPage';
import { DocsPage } from './components/docs/DocsPage';
import { TopBar } from './components/layout/TopBar';
import { BuilderLayout } from './components/builder/BuilderLayout';
import { MayorPopup } from './components/mayor/MayorPopup';
import { useMayorTips } from './mayor/useMayorTips';
import { useAmbientMusic } from './hooks/useAmbientMusic';
import { useAssetLoader } from './hooks/useAssetLoader';
import { useAssetStore } from './stores/useAssetStore';
import { useMapStore } from './stores/useMapStore';
import { useOrgStore } from './stores/useOrgStore';
import { useWsClient } from './ws/useWsClient';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route
        path="/"
        element={
          <AuthGate>
            <Home />
          </AuthGate>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Home() {
  useAssetLoader();
  useAmbientMusic();
  const assetsReady = useAssetStore((s) => s.isLoaded);
  const assetProgress = useAssetStore((s) => s.loadingProgress);

  const orgsStatus = useOrgStore((s) => s.orgsStatus);
  const loadOrgs = useOrgStore((s) => s.loadOrgs);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const orgs = useOrgStore((s) => s.orgs);

  const mapCurrentOrgId = useMapStore((s) => s.currentOrgId);
  const mapLoadStatus = useMapStore((s) => s.loadStatus);
  const loadMapFromServer = useMapStore((s) => s.loadFromServer);

  useEffect(() => {
    if (orgsStatus === 'idle') void loadOrgs();
  }, [orgsStatus, loadOrgs]);

  useEffect(() => {
    if (!currentOrgId) return;
    if (mapCurrentOrgId !== currentOrgId) {
      void loadMapFromServer(currentOrgId);
    }
  }, [currentOrgId, mapCurrentOrgId, loadMapFromServer]);

  useWsClient(currentOrgId);
  useMayorTips(currentOrgId);

  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar />
      <main className="relative flex-1 overflow-hidden">
        {!assetsReady && <AssetsLoading progress={assetProgress} />}
        {assetsReady && !currentOrg && (
          <EmptyState>
            {orgs.length === 0
              ? 'No organisation found on your Clever Cloud account.'
              : 'Pick an organisation from the top bar.'}
          </EmptyState>
        )}
        {assetsReady && currentOrg && mapLoadStatus === 'loading' && (
          <EmptyState>Loading the town of {currentOrg.name}…</EmptyState>
        )}
        {assetsReady && currentOrg && mapLoadStatus === 'error' && (
          <EmptyState>Failed to load the map.</EmptyState>
        )}
        {assetsReady && currentOrg && mapLoadStatus === 'ready' && <BuilderLayout />}
        <MayorPopup />
      </main>
    </div>
  );
}

function AssetsLoading({ progress }: { progress: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <div className="font-overtitle text-xs" style={{ color: 'var(--cc-orange)' }}>
        Loading assets
      </div>
      <div className="w-64 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${progress}%`, background: 'var(--cc-gradient-red)' }}
        />
      </div>
      <div className="text-xs cc-muted">{progress.toFixed(0)}%</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center cc-muted">{children}</div>
  );
}
