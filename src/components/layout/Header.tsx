'use client';

import Link from 'next/link';
import Form from 'next/form';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Menu, Flame, X, Search } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import {
  COMPARADOR_ICON,
  IconTile,
  NOSOTROS_ICON,
  OFERTAS_ICON,
  categoryIconStyle,
} from '@/components/brand/CategoryIcon';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CategoryInfo } from '@/lib/types';

// "Buscar" ya no es un link: el campo de búsqueda está siempre a mano en
// el encabezado.
const FIXED_LINKS = [
  { href: '/ofertas', label: 'Ofertas', style: OFERTAS_ICON },
  { href: '/comparador', label: 'Comparador', style: COMPARADOR_ICON },
  { href: '/nosotros', label: 'Nosotros', style: NOSOTROS_ICON },
];

const MOBILE_MENU_ID = 'menu-movil';
const MOBILE_SEARCH_ID = 'buscador-movil';

/**
 * Buscador del encabezado. GET a /buscar con `q`, igual que el del home:
 * funciona sin JavaScript, y con él next/form navega sin recargar la página.
 */
function SearchForm({
  inputRef,
  onSubmit,
  className = '',
}: {
  inputRef?: Ref<HTMLInputElement>;
  onSubmit?: () => void;
  className?: string;
}) {
  return (
    <Form action="/buscar" role="search" onSubmit={onSubmit} className={`relative ${className}`}>
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        name="q"
        aria-label="Buscar"
        placeholder="Buscar productos"
        autoComplete="off"
        enterKeyHint="search"
        required
        className="w-full rounded-xl border border-border bg-surface2 py-2 pl-8 pr-3 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
      />
    </Form>
  );
}

/** Cuántas ofertas hay hoy, al lado de "Ofertas". Sin ofertas no se muestra. */
function DealsCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-orange-600 dark:text-orange-400">
      {count}
    </span>
  );
}

/**
 * `categories` llega desde el layout (server component) con las categorías
 * que hoy tienen productos, en vez de una lista fija. Antes el menú ofrecía
 * "Electrónica" sin un solo producto adentro.
 */
export function Header({ categories, dealsCount = 0 }: { categories: CategoryInfo[]; dealsCount?: number }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  // Al abrir el buscador en el celular, el teclado tiene que salir solo:
  // si hay que tocar el campo de nuevo, se siente como un paso de más.
  useEffect(() => {
    if (searchOpen) mobileSearchRef.current?.focus();
  }, [searchOpen]);

  const categoryLinks = categories.map((c) => ({
    href: `/categoria/${c.slug}`,
    label: c.name,
    style: categoryIconStyle(c.slug),
  }));
  const links = [...categoryLinks, ...FIXED_LINKS];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 lg:gap-6 lg:py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-heading text-xl font-extrabold tracking-tight text-fg"
        >
          <Logo size={34} className="text-fg" />
          <span>
            Compara<span className="text-accent">Tech</span>
          </span>
        </Link>

        {/* Escritorio: arriba solo el logo, el buscador y el tema; las
            categorías van en su propia fila, más abajo. Antes iba todo en
            una fila y, al llegar a siete categorías, el menú medía más que
            la pantalla de un notebook: la página se desplazaba de lado y el
            buscador quedaba fuera de la vista. */}
        <SearchForm className="hidden min-w-0 max-w-xl flex-1 lg:block" />
        <div className="hidden shrink-0 lg:block">
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          {/* Las ofertas a un toque desde cualquier página: en el celular
              estaban dentro del menú, dos toques más lejos. */}
          <Link
            href="/ofertas"
            aria-label={dealsCount > 0 ? `Ofertas (${dealsCount})` : 'Ofertas'}
            className="flex items-center gap-1 text-orange-600 transition hover:text-orange-500 dark:text-orange-400"
          >
            <Flame size={21} aria-hidden />
            <DealsCount count={dealsCount} />
          </Link>
          <button
            type="button"
            className="text-muted transition hover:text-fg"
            onClick={() => {
              setSearchOpen((v) => !v);
              setOpen(false);
            }}
            aria-label={searchOpen ? 'Cerrar buscador' : 'Abrir buscador'}
            aria-expanded={searchOpen}
            aria-controls={MOBILE_SEARCH_ID}
          >
            <Search size={21} />
          </button>
          {/* El cambio de tema va dentro del menú: con el acceso a Ofertas
              ya no cabía acá, y en un teléfono de 360 px empujaba el botón
              del menú fuera de la pantalla. */}
          <button
            type="button"
            className="text-muted transition hover:text-fg"
            onClick={() => {
              setOpen((v) => !v);
              setSearchOpen(false);
            }}
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls={MOBILE_MENU_ID}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Fila de categorías (desde lg; antes, el menú desplegable). Solo
          texto, para que quepan aunque se sumen categorías; si igual no
          caben, la fila se desliza de lado sin mover el resto de la página.
          Las secciones del sitio van a la derecha, con Ofertas destacada. */}
      <nav aria-label="Categorías y secciones" className="hidden border-t border-border/60 lg:block">
        <div className="mx-auto flex max-w-6xl items-center gap-x-5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categoryLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 whitespace-nowrap text-sm font-medium transition ${
                pathname === l.href ? 'text-accent' : 'text-muted hover:text-fg'
              }`}
            >
              {l.label}
            </Link>
          ))}
          {FIXED_LINKS.map((l, i) => {
            const isDeals = l.href === '/ofertas';
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium transition ${
                  i === 0 ? 'ml-auto' : ''
                } ${
                  isDeals
                    ? 'font-semibold text-orange-600 hover:text-orange-500 dark:text-orange-400'
                    : pathname === l.href
                      ? 'text-accent'
                      : 'text-muted hover:text-fg'
                }`}
              >
                {isDeals && <Flame size={15} aria-hidden />}
                {l.label}
                {isDeals && <DealsCount count={dealsCount} />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div id={MOBILE_SEARCH_ID} hidden={!searchOpen} className="border-t border-border px-4 py-3 lg:hidden">
        <SearchForm inputRef={mobileSearchRef} onSubmit={() => setSearchOpen(false)} />
      </div>

      {/* Siempre en el DOM (oculto con `hidden`) para que aria-controls
          apunte a un elemento que existe. */}
      <nav
        id={MOBILE_MENU_ID}
        hidden={!open}
        aria-label="Menú principal"
        className="flex-col gap-1 border-t border-border px-4 py-3 [&:not([hidden])]:flex lg:!hidden"
      >
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition ${
                active ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-surface2'
              }`}
              onClick={() => setOpen(false)}
            >
              <IconTile {...l.style} size="sm" />
              {l.label}
              {l.href === '/ofertas' && <DealsCount count={dealsCount} />}
            </Link>
          );
        })}
        <div className="mt-1 flex items-center justify-between border-t border-border px-2 pb-1 pt-3 text-sm font-medium text-muted">
          Tema claro u oscuro
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
