import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Netlify / tên miền riêng: '/'. GitHub Pages: '/<tên-repo>/' — workflow tự truyền qua biến BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()]
});
