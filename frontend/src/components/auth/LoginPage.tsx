import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { loginHref } from '../../api/auth';
import { useAuthStore } from '../../stores/useAuthStore';

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    if (status === 'idle') refresh();
  }, [status, refresh]);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-10"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(165,16,80,0.18) 0%, var(--cc-black) 60%)',
      }}
    >
      <div className="text-center">
        <div className="font-overtitle text-sm" style={{ color: 'var(--cc-orange)' }}>
          Clever Cloud · medieval edition
        </div>
        <h1 className="font-brand text-7xl mt-3" style={{ color: 'var(--cc-white)' }}>
          myCCtown
        </h1>
        <p className="mt-3 cc-muted text-lg">
          Your apps and addons as a living 3D medieval town.
        </p>
      </div>
      <a href={loginHref()} className="btn-cc-gradient text-lg">
        Login with Clever Cloud
      </a>
      <Link
        to="/docs"
        className="cc-muted text-sm hover:text-white transition -mt-6"
        style={{ textUnderlineOffset: '3px' }}
      >
        Read the documentation ↗
      </Link>
    </div>
  );
}
