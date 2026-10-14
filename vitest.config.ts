import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig.json deja el JSX sin transformar para Next. En los tests lo
  // transforma esbuild, con el runtime automático (como Next): sin esto, un
  // test que dibuja una pieza falla con "React is not defined".
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // El mismo alias de tsconfig.json, para que los tests importen igual
      // que el código.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' lanza un error fuera de los componentes de servidor de
      // Next. En los tests no hay navegador al que proteger, así que se
      // reemplaza por su versión vacía (la misma que usa Next en el servidor).
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // scripts/reels: lo que arma los videos del día corre fuera del sitio
    // (GitHub Actions), pero sus pruebas van con las demás.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/reels/**/*.test.ts'],
  },
});
