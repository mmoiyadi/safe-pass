import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The service worker is written by hand (src/sw/service-worker.ts) rather than generated,
      // so the rule that vault data is never cached is a branch that runs instead of a comment
      // in this file. injectManifest builds it and substitutes the precache list.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'service-worker.ts',
      registerType: 'prompt',
      manifest: false, // served from public/manifest.webmanifest
      injectManifest: {
        // The application shell only. No vault data is ever precached: the encrypted copy lives
        // in IndexedDB under the app's control, so it can be discarded on revocation and expired
        // on staleness (FR-058, FR-059). A Workbox cache could honour neither.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
