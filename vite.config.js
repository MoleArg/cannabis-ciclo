import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dos páginas: la plataforma (index.html) y el indoor 3D (indoor.html), que la
// plataforma carga en su pestaña "Indoor 3D". base relativa para servir desde
// GitHub Pages o cualquier subcarpeta. Se mira desde la Mac por Tailscale.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), indoor: resolve(import.meta.dirname, 'indoor.html') },
    },
  },
  server: { allowedHosts: ['.ts.net'] },
  preview: { allowedHosts: ['.ts.net'], port: 4640 },
});
