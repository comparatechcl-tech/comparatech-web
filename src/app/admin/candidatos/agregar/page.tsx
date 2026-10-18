import Link from 'next/link';
import { AddFromMl } from './AddFromMl';

export const dynamic = 'force-dynamic';

/**
 * Agregar al sitio un producto visto en Mercado Libre: se pega el link, se
 * revisa como en la prospección y queda en la cola o publicado con su link
 * de afiliado (ver lib/manual-add). Vive bajo Candidatos porque lo que se
 * agrega entra a esa misma cola.
 */
export default function AgregarPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <Link href="/admin/candidatos" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← Candidatos
      </Link>
      <h1 className="font-heading text-2xl font-bold text-fg">Agregar desde Mercado Libre</h1>
      <p className="mt-1 text-sm text-muted">
        Pega el link de un producto que viste en Mercado Libre. Reviso el precio, el vendedor y la comisión, armo
        el link de afiliado y lo dejas en la cola o lo publicas al tiro.
      </p>
      <AddFromMl />
    </main>
  );
}
