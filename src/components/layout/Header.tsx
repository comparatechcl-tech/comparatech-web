'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { CATEGORIES } from '@/lib/types';
import { Logo } from '@/components/brand/Logo';

const NAV_LINKS = [
  { href: '/comparador', label: 'Comparador' },
  { href: '/buscar', label: 'Buscar' },
  { href: '/nosotros', label: 'Nosotros' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    ...CATEGORIES.slice(0, 3).map((c) => ({ href: `/categoria/${c.slug}`, label: c.name })),
    ...NAV_LINKS,
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 font-heading text-xl font-bold tracking-tight text-white">
          <Logo size={34} className="text-white" />
          Compara<span className="text-accent">Tech</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium transition ${
                  active ? 'text-accent' : 'text-muted hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <button
          className="text-muted transition hover:text-white md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-2 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white'
                }`}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
