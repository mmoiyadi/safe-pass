import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: false, // served from public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Vault data is NEVER cached by the service worker. The encrypted copy lives in
        // IndexedDB under the app's control, so it can be discarded on revocation and
        // expired on staleness (FR-058, FR-059). A Workbox runtime cache could not.
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
