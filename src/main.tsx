import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

declare const __PREVIEW__: boolean;

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

// Offline support: register the service worker in the standalone build only.
if (!__PREVIEW__ && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // when a new version takes over, reload once so the new version shows immediately
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      // check for a new version whenever the app comes back to the foreground
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => { /* offline mode unavailable */ });
  });
}
