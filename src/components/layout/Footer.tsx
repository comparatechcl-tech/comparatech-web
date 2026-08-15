import Link from 'next/link';
import { CATEGORIES } from '@/lib/types';

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="font-heading text-lg font-bold text-white">
              Compara<span className="text-accent">Tech</span>
            </p>
            <p className="mt-2 max-w-xs">
              Comparamos precios de tecnología y hogar en Chile para que elijas
              mejor, sin vueltas.
            </p>
          </div>

          <div>
            <p className="mb-2 font-medium text-white">Categorías</p>
            <ul className="space-y-1">
              {CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/categoria/${c.slug}`} className="hover:text-accent">
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
                <Link href="/comparador" className="hover:text-accent">
                  Comparador
                </Link>
              </li>
              <li>
                <Link href="/buscar" className="hover:text-accent">
                  Buscar
                </Link>
              </li>
              <li>
                <Link href="/nosotros" className="hover:text-accent">
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
        <p className="mt-4 text-xs text-muted">
          © {new Date().getFullYear()} ComparaTech. Todos los derechos
          reservados.
        </p>
      </div>
    </footer>
  );
}
