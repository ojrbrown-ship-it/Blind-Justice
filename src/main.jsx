// src/main.jsx
// --- diagnostics: global traps so we see the real error object ---
window.addEventListener('error', (e) => {
  console.error('[GlobalError]', e.error || e.message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UnhandledRejection]', e.reason || e);
});
// ---------------------------------------------------------------

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

try {
  console.log('[Boot] main.jsx loaded');
  const el = document.getElementById('root');
  if (!el) throw new Error('#root not found');
  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log('[Boot] React 18 createRoot OK');
} catch (err) {
  console.error('[Boot] Fatal error', err);
  const el = document.getElementById('root');
  if (el) el.textContent = 'Boot error: ' + (err?.message || String(err));
}