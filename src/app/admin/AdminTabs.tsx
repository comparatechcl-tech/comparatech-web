'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tone = 'accent' | 'warn';

interface Tab {
  href: string;
  label: string;
  count: number;
  tone: Tone;
  /** Resumen vive en /admin, que es prefijo de todas: solo cuenta la ruta exacta. */
  exact?: boolean;
}

export function AdminTabs({ pending, problems }: { pending: number; problems: number }) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: '/admin', label: 'Resumen', count: 0, tone: 'accent', exact: true },
    { href: '/admin/candidatos', label: 'Candidatos', count: pending, tone: 'accent' },
    { href: '/admin/productos', label: 'Productos', count: 0, tone: 'accent' },
    { href: '/admin/problemas', label: 'Problemas', count: problems, tone: 'warn' },
    { href: '/admin/metricas', label: 'Métricas', count: 0, tone: 'accent' },
    { href: '/admin/actividad', label: 'Actividad', count: 0, tone: 'accent' },
    { href: '/admin/configuracion', label: 'Configuración', count: 0, tone: 'accent' },
  ];

  return (
    // Siete pestañas no caben en 375 px: se desplazan de lado en vez de
    // partirse en dos líneas.
    <nav
      aria-label="Secciones del admin"
      className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition ${
              active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  t.tone === 'warn' ? 'bg-amber-500/15 text-amber-400' : 'bg-accent/15 text-accent'
                }`}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
