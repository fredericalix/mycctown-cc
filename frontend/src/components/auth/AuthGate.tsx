import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);
  const location = useLocation();

  useEffect(() => {
    if (status === 'idle') refresh();
  }, [status, refresh]);

  if (status === 'idle' || status === 'loading') {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (status === 'error') {
    return <CenteredMessage>Could not reach the backend. Try reloading.</CenteredMessage>;
  }

  return <>{children}</>;
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center opacity-60">{children}</div>
  );
}
