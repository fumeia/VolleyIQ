import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  // The website's version, for the About page (the app reads its own from Android).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
    },
  },
});
