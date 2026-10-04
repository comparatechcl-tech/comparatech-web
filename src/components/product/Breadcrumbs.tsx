import Link from 'next/link';
import { SITE_URL } from '@/lib/site';
import { jsonLdString } from '@/components/seo/ProductJsonLd';

export interface Crumb {
  name: string;
  /** Ruta relativa ("/categoria/audio"). El último paso va sin link. */
  href?: string;
}

/**
 * "Inicio › Audio › Parlante JBL Go 5".
 *
 * Además de orientar a quien llega directo a una ficha desde Google, el
 * BreadcrumbList hace que Google muestre la ruta en vez de la URL larga, y
 * le da un camino de un clic a la categoría (donde están las alternativas).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.href ? { item: item.href === '/' ? SITE_URL : `${SITE_URL}${item.href}` } : {}),
    })),
  };

  return (
    <nav aria-label="Ruta de navegación" className="mb-6 text-xs text-muted">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.name}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="transition hover:text-accent">
                  {item.name}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="truncate text-fg">
                  {item.name}
                </span>
              )}
              {!last && <span aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
