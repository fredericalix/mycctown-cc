import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App';
import './styles/index.css';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  const release = import.meta.env.VITE_SENTRY_RELEASE as string | undefined;
  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string) || 'development',
    release,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    enableLogs: true,
  });
  Sentry.getGlobalScope().setAttributes({
    service: 'mycctown-frontend',
    ...(release ? { release } : {}),
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);

function CrashFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center cc-muted">
      Something went wrong. Reload the page to try again.
    </div>
  );
}
