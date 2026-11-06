import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

declare const __PREVIEW__: boolean;

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

// Offline support: register the service worker in the standalone build only.
if (!__PREVIEW__ && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode unavailable */ }); });
}
