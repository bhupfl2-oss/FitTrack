import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/app.css'
import App from './App.tsx'

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration);

        // When a new SW is found, it will install then activate immediately
        // (because we call skipWaiting in sw.js). When it activates and
        // claims this page, we reload so the user gets the new version.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('New SW activated — reloading for fresh version');
          window.location.reload();
        });
      })
      .catch((err) => {
        console.log('SW registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)