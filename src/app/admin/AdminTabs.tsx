'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AdminTabs({ pending, problems }: { pending: number; problems: number }) {
  const pathname = usePathname();

  const tabs = [
    { href: '/admin/candidatos', label: 'Candidatos', count: pending, tone: 'accent' as const },
    { href: '/admin/productos', label: 'Productos', count: 0, tone: 'accent' as const },
    { href: '/admin/problemas', label: 'Problemas', count: problems, tone: 'warn' as const },
    { href: '/admin/configuracion', label: 'Configuración', count: 0, tone: 'accent' as const },
  ];

  return (
    <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition ${
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
