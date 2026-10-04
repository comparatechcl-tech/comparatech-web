'use client';

import Link from 'next/link';
import Form from 'next/form';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type Ref } from 'react';
import {
  Menu,
  Flame,
  X,
  Smartphone,
  Laptop,
  Headphones,
  Cpu,
  Sofa,
  WashingMachine,
  Package,
  Gamepad2,
  Scale,
  Search,
  Info,
} from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CategoryInfo } from '@/lib/types';

const CATEGORY_ICONS: Record<string, typeof Smartphone> = {
  celulares: Smartphone,
  computacion: Laptop,
  audio: Headphones,
  gaming: Gamepad2,
  electronica: Cpu,
  hogar: Sofa,
  electrodomesticos: WashingMachine,
};

// "Buscar" ya no es un link: el campo de búsqueda está siempre a mano en
// el encabezado.
const FIXED_LINKS = [
  { href: '/ofertas', label: 'Ofertas', icon: Flame },
  { href: '/comparador', label: 'Comparador', icon: Scale },
  { href: '/nosotros', label: 'Nosotros', icon: Info },
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

/**
 * `categories` llega desde el layout (server component) con las categorías
 * que hoy tienen productos, en vez de una lista fija. Antes el menú ofrecía
 * "Electrónica" sin un solo producto adentro.
 */
export function Header({ categories }: { categories: CategoryInfo[] }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  // Al abrir el buscador en el celular, el teclado tiene que salir solo:
  // si hay que tocar el campo de nuevo, se siente como un paso de más.
  useEffect(() => {
    if (searchOpen) mobileSearchRef.current?.focus();
  }, [searchOpen]);

  const links = [
    ...categories.map((c) => ({
      href: `/categoria/${c.slug}`,
      label: c.name,
      icon: CATEGORY_ICONS[c.slug] ?? Package,
    })),
    ...FIXED_LINKS,
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="flex items-center gap-2.5 font-heading text-xl font-extrabold tracking-tight text-fg">
          <Logo size={34} className="text-fg" />
          <span>
            Compara<span className="text-accent">Tech</span>
          </span>
        </Link>

        {/* Desde lg y no md: entre 768 y 1023 px las categorías no caben en
            una fila y la página se desplazaba de lado. El campo de búsqueda
            va recién desde xl; antes, un ícono que lleva a /buscar (que
            tiene su propio buscador) ocupa lo mismo que el viejo link. */}
        <div className="hidden min-w-0 items-center gap-6 lg:flex">
          <nav className="flex items-center gap-5">
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
          <SearchForm className="hidden xl:block xl:w-52" />
          <Link
            href="/buscar"
            aria-label="Buscar"
            className={`transition xl:hidden ${pathname === '/buscar' ? 'text-accent' : 'text-muted hover:text-fg'}`}
          >
            <Search size={18} />
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3 lg:hidden">
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
          <ThemeToggle />
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
    </header>
  );
}
