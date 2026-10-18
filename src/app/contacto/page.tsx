import Link from 'next/link';
import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { SocialLinks } from '@/components/brand/SocialLinks';
import { CONTACT_EMAIL } from '@/lib/contact';

export const metadata: Metadata = {
  title: 'Contacto',
  alternates: { canonical: '/contacto' },
  description:
    'Cómo escribirle a ComparaTech: un precio que no coincide, un producto que quieras que sigamos, medios y privacidad.',
};

/**
 * Contacto (SEO etapa 2, punto 8): quién responde y por dónde. Sin
 * formulario a propósito: un formulario necesita protección contra spam y
 * un correo que lo reciba, y el correo directo ya funciona.
 */
export default function ContactoPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: 'Contacto' }]} />
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Contacto</h1>

      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Mail size={18} aria-hidden />
        </span>
        <span>
          <span className="block text-xs text-muted">Escríbenos a</span>
          <span className="font-medium text-fg">{CONTACT_EMAIL}</span>
        </span>
      </a>
      <p className="mt-3 text-sm text-muted">Te respondemos apenas podamos.</p>

      <h2 className="mt-10 font-heading text-lg font-semibold text-fg">Para qué escribirnos</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>Un precio o un dato que no coincide con Mercado Libre: mándanos el link de la ficha.</li>
        <li>Un producto que quieras que empecemos a seguir.</li>
        <li>
          Medios y prensa: tenemos el historial de precios de tecnología y hogar en Mercado Libre Chile desde octubre de
          2026.
        </li>
        <li>
          Tus datos y la privacidad: está todo en la{' '}
          <Link href="/privacidad" className="text-accent hover:underline">
            política de privacidad
          </Link>
          .
        </li>
      </ul>

      <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-muted">
        No vendemos productos. Para una compra, un envío, una garantía o una devolución, escríbele al vendedor en Mercado
        Libre, desde tu compra.
      </p>

      <h2 className="mt-10 font-heading text-lg font-semibold text-fg">En redes</h2>
      <p className="mt-2 text-sm text-muted">También estamos en Instagram, TikTok y YouTube.</p>
      <SocialLinks className="mt-3" />

      <p className="mt-10 text-sm text-muted">
        ¿Quieres saber de dónde salen los precios?{' '}
        <Link href="/como-funciona" className="text-accent hover:underline">
          Así funciona ComparaTech
        </Link>
        .
      </p>
    </div>
  );
}
