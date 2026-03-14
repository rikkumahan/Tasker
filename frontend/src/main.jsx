import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Widget from './Widget.jsx'
import './index.css'

// Phase 9: Lightweight pathname-based router (no dependency needed)
const isWidgetView = window.location.pathname === '/widget';

// Phase 8: Auto-trigger sync if URL has ?sync=1 shortcut
if (window.location.search.includes('sync=1')) {
  // Will be handled by App.jsx mount logic
  window.history.replaceState({}, '', '/');
}

// Phase 10: Register PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.log('[SW] Registration failed:', err));
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isWidgetView ? <Widget /> : <App />}
  </React.StrictMode>,
)
