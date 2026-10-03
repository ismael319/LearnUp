import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Proxy evita CORS em desenvolvimento: o front chama /api e o Vite
      // repassa para a API, mantendo a mesma origem para o navegador.
      proxy: {
        '/api': { target: env.VITE_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true },
        '/health': { target: env.VITE_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
