'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, Smartphone, Laptop, Headphones, Scale, Search, Info } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

const NAV_LINKS = [
  { href: '/categoria/celulares', label: 'Celulares', icon: Smartphone },
  { href: '/categoria/computacion', label: 'Computación', icon: Laptop },
  { href: '/categoria/electronica', label: 'Electrónica', icon: Headphones },
  { href: '/comparador', label: 'Comparador', icon: Scale },
  { href: '/buscar', label: 'Buscar', icon: Search },
  { href: '/nosotros', label: 'Nosotros', icon: Info },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = NAV_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 font-heading text-xl font-extrabold tracking-tight text-fg">
          <Logo size={34} className="text-fg" />
          <span>
            Compara<span className="text-accent">Tech</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <nav className="flex items-center gap-6">
            {links.map((l) => {
              const active = pathname === l.href;
              const Icon = l.icon;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`flex items-center gap-1.5 text-sm font-medium transition ${
                    active ? 'text-accent' : 'text-muted hover:text-fg'
                  }`}
                >
                  <Icon size={16} />
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3 md:hidden">
          <ThemeToggle />
          <button
            className="text-muted transition hover:text-fg"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {links.map((l) => {
            const active = pathname === l.href;
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setOpen(false)}
              >
                <Icon size={16} />
                {l.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
