import Link from 'next/link';
import { CATEGORIES } from '@/lib/types';
import { SocialLinks } from '@/components/brand/SocialLinks';
import { Logo } from '@/components/brand/Logo';

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="flex items-center gap-2 font-heading text-lg font-bold text-white">
              <Logo size={26} className="text-white" />
              <span>
                Compara<span className="text-accent">Tech</span>
              </span>
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-accent">
              Compara · Elige · Ahorra
            </p>
            <p className="mt-3 max-w-xs">
              Comparamos precios de tecnología y hogar en Chile para que elijas
              mejor, sin vueltas.
            </p>
            <SocialLinks className="mt-4" />
          </div>

          <div>
            <p className="mb-2 font-medium text-white">Categorías</p>
            <ul className="space-y-1">
              {CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/categoria/${c.slug}`} className="transition hover:text-accent">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 font-medium text-white">Sitio</p>
            <ul className="space-y-1">
              <li>
                <Link href="/comparador" className="transition hover:text-accent">
                  Comparador
                </Link>
              </li>
              <li>
                <Link href="/buscar" className="transition hover:text-accent">
                  Buscar
                </Link>
              </li>
              <li>
                <Link href="/nosotros" className="transition hover:text-accent">
                  Nosotros
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-border pt-6 text-xs leading-relaxed text-muted">
          ComparaTech es afiliado del Programa de Afiliados y Creadores de
          Mercado Libre y puede recibir una comisión por compras calificadas
          realizadas a través de los links de este sitio, sin costo adicional
          para ti. Los precios y la disponibilidad son responsabilidad del
          vendedor en Mercado Libre y pueden cambiar en cualquier momento.
        </p>
        <div className="mt-4 flex flex-col gap-1 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} ComparaTech. Todos los derechos reservados.</p>
          <p>Datos de Mercado Libre · Los precios pueden variar</p>
        </div>
      </div>
    </footer>
  );
}
