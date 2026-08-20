'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { CATEGORIES } from '@/lib/types';

const NAV_LINKS = [
  { href: '/comparador', label: 'Comparador' },
  { href: '/buscar', label: 'Buscar' },
  { href: '/nosotros', label: 'Nosotros' },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 font-heading text-xl font-bold tracking-tight">
          <Image
            src="/icon-192.png"
            alt=""
            width={44}
            height={44}
            priority
            className="h-10 w-10 drop-shadow-[0_0_10px_rgba(0,212,255,0.35)]"
          />
          Compara<span className="text-accent">Tech</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {CATEGORIES.slice(0, 3).map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="text-sm text-muted transition hover:text-accent"
            >
              {c.name}
            </Link>
          ))}
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-muted transition hover:text-accent"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          className="text-sm text-muted md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir menú"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="py-2 text-sm text-muted hover:text-accent"
              onClick={() => setOpen(false)}
            >
              {c.name}
            </Link>
          ))}
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="py-2 text-sm text-muted hover:text-accent"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
