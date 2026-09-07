import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { registerServiceWorker } from './sw/register.js';
import './theme.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/**
 * The shell is cached so the app opens with no network (FR-050). An update is offered rather
 * than applied silently: swapping the client's own code out mid-session would be alarming in a
 * product where the client is what holds the keys.
 */
registerServiceWorker({
  onUpdateAvailable: (prompt) => {
    if (window.confirm('A new version of the app is ready. Reload to use it?')) {
      void prompt.update();
    }
  },
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
