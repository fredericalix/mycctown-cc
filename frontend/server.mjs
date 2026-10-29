// Lightweight same-origin reverse proxy + static server.
//
// In prod we have a single public origin (https://mycctown.cleverapps.io):
//   /api/*, /auth/*, /ws/*  → forwarded to the Rust backend
//   everything else          → served from ./dist (Vite build output)
//
// Keeping everything under one origin avoids the cross-site cookie problem
// that breaks OAuth session auth in modern browsers (Safari/Firefox block
// third-party cookies by default; `cleverapps.io` is on the Public Suffix
// List, so `mycctown.cleverapps.io` and `mycctown-backend.cleverapps.io`
// count as separate sites).

import compression from 'compression';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8080;
const BACKEND_URL = process.env.BACKEND_URL;

if (!BACKEND_URL) {
  console.error('BACKEND_URL env var is required (e.g. https://mycctown-backend.cleverapps.io)');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');

// `pathFilter` keeps the original URL intact when forwarding (Express's
// `app.use('/api', ...)` would strip the prefix, which the backend doesn't
// expect).
const proxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  logger: console,
  pathFilter: (p) =>
    p.startsWith('/api') || p.startsWith('/auth') || p.startsWith('/ws'),
});

const app = express();
app.use(proxy);

// Gzip compression. Skip already-compressed payloads (.bin/.png/.webp/.jpg/
// media) — gzipping them wastes CPU and doesn't shrink size. Also skip any
// request carrying a `Range:` header: `compression` mangles 206 responses
// (drops Content-Length, forces chunked) which breaks HTTP/2 framing behind
// the CC edge — the browser then reports ERR_HTTP2_PROTOCOL_ERROR on audio
// streaming.
app.use(
  compression({
    filter: (req, res) => {
      if (req.headers.range) return false;
      if (/\.(bin|png|webp|jpg|jpeg|gif|mp3|wav|ogg|m4a|mp4|webm)$/i.test(req.path)) return false;
      return compression.filter(req, res);
    },
  }),
);

// Static assets + SPA fallback.
// - index.html: no-cache so a new deploy is picked up on next page load.
// - Vite-hashed bundles (`assets/index-XYZ.js|css|woff2`): immutable + 1y.
// - Everything else under /assets/ (gltf, bin, png, …) is NOT hashed by
//   path, so we must NOT mark it `immutable`. We let it cache for 1h with
//   etag-based revalidation — that way a content change after a deploy
//   is picked up on the next request via 304/200, instead of being
//   sealed in the browser cache for hours.
const VITE_HASHED = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]+\.(?:js|css|woff2?)$/;
app.use(
  express.static(DIST_DIR, {
    extensions: ['html'],
    // Disable the default directory → trailing-slash 301. Vite outputs
    // real files under dist/ (e.g. /docs/img/*.png) but the SPA route
    // `/docs` should not be intercepted as a directory. Without this,
    // a visit to `/docs` triggers a 301 to `/docs/` and the client
    // round-trips unnecessarily.
    redirect: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else if (VITE_HASHED.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
      }
    },
  }),
);
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Frontend listening on :${PORT}, proxying /api /auth /ws → ${BACKEND_URL}`);
});

// http-proxy-middleware requires explicit upgrade handling for WebSockets.
// Log each upgrade attempt with the cookie fingerprint so a failing WS auth
// (backend returns 401) can be distinguished between "browser didn't send
// the cookie" and "proxy dropped the cookie".
server.on('upgrade', (req, socket, head) => {
  const hasSession = (req.headers.cookie ?? '').includes('mycctown.sid');
  console.log(
    `[upgrade] ${req.method} ${req.url} cookie=${hasSession ? 'present' : 'missing'} origin=${req.headers.origin ?? '-'}`,
  );
  proxy.upgrade(req, socket, head);
});
