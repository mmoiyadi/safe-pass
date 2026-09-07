/**
 * Service-worker registration and the update prompt (T124).
 *
 * The update is offered rather than applied silently. A password manager that swaps its own
 * code out from under a user mid-edit would be alarming in a product where trust in the client
 * IS the security model — the client is what holds the keys.
 */
import { registerSW } from 'virtual:pwa-register';

export interface UpdatePrompt {
  /** Applies the waiting update and reloads. */
  update: () => Promise<void>;
}

export function registerServiceWorker(handlers: {
  onUpdateAvailable: (prompt: UpdatePrompt) => void;
  onOfflineReady?: () => void;
}): void {
  // Vite's dev server does not serve a service worker; registering there is a no-op.
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      handlers.onUpdateAvailable({ update: async () => updateSW(true) });
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
  });
}

/**
 * Asks the service worker to drop every cache it holds.
 *
 * Called on sign-out and when offline access is turned off. The shell is not secret, but a user
 * who has said "remove the offline copy" means all of it, and leaving a cached shell behind
 * would make the setting look like it had not worked.
 */
export function purgeServiceWorkerCaches(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'PM_PURGE_CACHES' });
}
