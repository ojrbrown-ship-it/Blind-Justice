// --- diagnostics: temporary ---
window.addEventListener('error', (e) => {
  console.error('[GlobalError]', e.error || e.message || e);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UnhandledRejection]', e.reason || e);
});
// --- end diagnostics ---

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

console.log('[Boot]', 'main.jsx loaded');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
