import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
