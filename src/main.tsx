import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { app } from './state/app';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Offline support: the service worker precaches the app shell and every built asset.
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_SINGLE !== '1') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      const ready = () => app.set({ offlineReady: true });
      if (navigator.serviceWorker.controller || reg.active) ready();
      navigator.serviceWorker.ready.then(ready);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            // A new version is cached; it takes over on the next launch.
            app.set((s) => ({ toasts: [...s.toasts, { id: Date.now(), kind: 'info', text: 'An update is ready. It applies the next time you open Chordlab.' }] }));
          }
        });
      });
    }).catch(() => { /* offline mode unavailable (e.g. private browsing) */ });
  });
} else if (import.meta.env.DEV) {
  app.set({ offlineReady: false });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.set({ installPrompt: e as Event & { prompt: () => Promise<void> } });
});
