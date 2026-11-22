import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El 22-11-2026, recién mudado el sitio a Railway, las páginas de modelo, las
 * comparaciones y las guías respondieron 404 después de cada revisión de
 * precios, hasta el despliegue siguiente.
 *
 * Tenían `dynamicParams = false`. Con `next start` (fuera de Vercel), cuando
 * se purga la caché (revalidateTag o revalidatePath) Next trata la página
 * guardada como si no existiera, y a una ruta sin "fallback" no la vuelve a
 * armar: responde 404. En Vercel no pasaba. Las direcciones que no existen
 * las corta cada página con notFound().
 */

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(path));
    else if (/^(page|layout|route)\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('páginas del sitio', () => {
  it('ninguna usa dynamicParams = false (en Railway daba 404 después de cada purga de caché)', () => {
    const files = pageFiles(join(process.cwd(), 'src', 'app'));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => /export\s+const\s+dynamicParams\s*=\s*false/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('las que arman sus direcciones en el despliegue cortan lo que no existe con notFound()', () => {
    for (const route of ['modelo/[modelo]', 'comparar/[par]', 'guias/[guia]', 'categoria/[categoria]/[tipo]/[filtro]']) {
      const source = readFileSync(join(process.cwd(), 'src', 'app', ...route.split('/'), 'page.tsx'), 'utf8');
      expect(source, route).toContain('generateStaticParams');
      expect(source, route).toMatch(/notFound\(\)/);
    }
  });
});
