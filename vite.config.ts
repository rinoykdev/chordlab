import { createHash } from 'node:crypto';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Files from /public that the service worker must also precache. */
const PUBLIC_FILES = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

/**
 * Emits sw.js with a precache list built from the real bundle, so every hashed JS/CSS/font/worker
 * file is available offline after the first visit. The cache name changes whenever any file does.
 */
function serviceWorker(): Plugin {
  return {
    name: 'chordlab-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = ['./', ...built, ...PUBLIC_FILES];
      const hash = createHash('sha256');
      for (const f of built) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      const version = hash.digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, files) });
    },
  };
}

function swSource(version: string, files: string[]): string {
  return `/* Chordlab service worker — generated at build time. */
const CACHE = 'chordlab-${version}';
const PRECACHE = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chordlab-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // App navigation: serve the cached shell (offline-first), refresh it in the background.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match('./');
        const network = fetch(req).then((res) => { if (res.ok) cache.put('./', res.clone()); return res; }).catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }
  // Static assets: cache first, then network (and keep a copy).
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
`;
}

// `vite build --mode single` produces one self-contained index.html for hosted previews:
// no service worker, everything (worker, fonts, icons) inlined.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react(), serviceWorker()],
  worker: { format: 'es' },
  build: mode === 'single'
    ? { target: 'es2022', outDir: 'dist-single', assetsInlineLimit: 100_000_000 }
    : { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
}) as UserConfig & { test: unknown });
