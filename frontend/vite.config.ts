import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// GLTF assets live under `public/assets/gltf/` so Vite serves them at
// `/assets/gltf/...` in dev and copies them to `dist/` at build time
// without an extra plugin. Keeping them inside `frontend/` also makes the
// app deployable independently (Clever Cloud `git subtree push --prefix=frontend`).
export default defineConfig(({ mode }) => {
  // loadEnv with prefix '' picks up non-VITE_* vars too (e.g. SENTRY_AUTH_TOKEN).
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  // Sourcemap upload is gated on SENTRY_AUTH_TOKEN + SENTRY_URL + SENTRY_ORG:
  // any of them missing (local dev, CI without the secret, a self-hosted
  // instance without GlitchTip) = plugin is a no-op. The token is a
  // GlitchTip/Sentry personal auth token (kept out of the repo).
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  const sentryUrl = env.SENTRY_URL || process.env.SENTRY_URL;
  const sentryOrg = env.SENTRY_ORG || process.env.SENTRY_ORG;
  const sentryProject = env.SENTRY_PROJECT || process.env.SENTRY_PROJECT || 'mycctown-frontend';

  return {
    plugins: [
      react(),
      tailwindcss(),
      sentryAuthToken && sentryUrl && sentryOrg
        ? sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuthToken,
            url: sentryUrl,
            telemetry: false,
          })
        : null,
    ],
    build: {
      // 'hidden' generates .map files at build time (uploaded to GlitchTip by
      // the plugin) but does NOT reference them from the served bundle, so
      // browsers don't fetch them and clients can't deobfuscate the code.
      sourcemap: 'hidden',
    },
    server: {
      port: 3000,
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/auth': { target: backendTarget, changeOrigin: true },
        // WebSocket proxy: `changeOrigin` combined with `ws: true` is known to
        // break the upgrade handshake in Vite's underlying http-proxy — the
        // 101 response from the backend is dropped on the way back to the
        // browser. Drop changeOrigin here. The backend is only accessed
        // through the proxy in dev so the Host header mismatch doesn't matter.
        '/ws': { target: backendTarget, ws: true },
      },
    },
  };
});
