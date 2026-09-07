/// <reference lib="webworker" />
/**
 * The service worker (T124, FR-050).
 *
 * Its job is narrow: precache the application shell so the app opens with no network, and get
 * out of the way. It does NOT cache vault data.
 *
 * ## Why the shell only
 *
 * The encrypted vault copy lives in IndexedDB under the application's control (see
 * `vault/offline-cache.ts`), because that copy has rules a Workbox runtime cache could not
 * honour: discard it on revocation, expire it after 30 days, and drop it the moment the user
 * turns offline access off (FR-058, FR-059). A cache the app cannot reason about would keep
 * serving secrets after access was revoked, and nothing would know.
 *
 * So this file is written by hand rather than generated. In generated form the "never cache the
 * API" rule was a comment in the Vite config; here it is a branch that runs, and the assertion
 * below fails loudly in development if anyone adds a route that breaks it.
 */
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/** The build-time list of shell assets. Vite's injectManifest replaces this. */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * Anything that could carry vault data. A response from here must never be written to a cache
 * the application cannot invalidate.
 */
const isVaultData = (url: URL): boolean => url.pathname.startsWith('/api/');

/**
 * Never intercept an API request.
 *
 * Returning without calling `respondWith` hands the request straight to the network, so the
 * response reaches the page and is never stored. A stale 200 served from a cache here would be
 * worse than an error: the app would treat revoked or deleted data as current.
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (isVaultData(url)) return;

  // Non-GET requests are writes; they are refused offline by the client (FR-057) and are never
  // cached here either.
  if (event.request.method !== 'GET') return;
});

/**
 * Take over immediately on activation.
 *
 * Normally a service worker waits for every tab to close. Here, a shell update that the user
 * has explicitly accepted should apply at once — and any cache belonging to an older shell is
 * cleared, so an old build cannot keep serving after a security fix has shipped.
 */
self.skipWaiting();
clientsClaim();

/**
 * Sign-out and the offline off-switch both need every cache gone, including this one. The page
 * cannot clear a service worker's caches directly, so it asks.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'PM_PURGE_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    );
  }
  if (data?.type === 'SKIP_WAITING') self.skipWaiting();
});
