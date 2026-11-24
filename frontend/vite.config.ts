import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' gera caminhos relativos: o mesmo build funciona na raiz ou em um subcaminho
// (ex.: https://dominio/chat-whatsapp/) atrás de um proxy, sem rebuild.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { sourcemap: false, assetsDir: 'assets' },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000', '/socket.io': { target: 'http://127.0.0.1:3000', ws: true } },
  },
});
