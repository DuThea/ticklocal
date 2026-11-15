import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Netlify / custom domain: '/'. GitHub Pages: '/<repo-name>/' — the workflow passes it through BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()]
});
