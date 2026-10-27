import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { couponKey } from '@/lib/social/coupons-url';
import { metaCredentials, readMetaConnection } from '@/lib/social/meta';
import { CouponsView } from './CouponsView';

export const dynamic = 'force-dynamic';

/**
 * Cupones del canal de afiliados de Mercado Libre: el dueño pega el aviso,
 * revisa los códigos y los publica en Instagram (feed e historia) y Facebook
 * desde el teléfono, sin pasar por el PC. Los cupones duran poco: mejor que
 * salgan apenas llegan.
 */
export default async function CuponesPage() {
  const admin = getSupabaseAdmin();
  const metaReady = metaCredentials() !== null && (await readMetaConnection(admin)).connection !== null;
  const signing = couponKey() !== null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <Link href="/admin/historias" className="text-sm text-muted hover:text-fg">
        ← Historias
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-bold text-fg">Cupones del canal</h1>
      <p className="mt-1 text-sm text-muted">
        Cuando el canal de afiliados mande cupones de Mercado Libre, publícalos desde aquí en un minuto: en el feed de
        Instagram, en una historia y en Facebook.
      </p>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          En WhatsApp, mantén apretado el aviso de cupones del canal y toca <strong>Copiar</strong>.
        </li>
        <li>
          Pégalo abajo y toca <strong>Leer cupones</strong>. Revisa que cada código, monto y compra mínima calce con el
          aviso. Si no los leyó bien, corrígelos a mano.
        </li>
        <li>
          Toca <strong>Armar imágenes</strong> y mira cómo quedaron.
        </li>
        <li>
          Toca <strong>Publicar</strong>. No hace falta sticker ni link: el código se ingresa al pagar en Mercado Libre.
        </li>
      </ol>

      {!signing && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Falta CRON_SECRET en Vercel: no se pueden armar las imágenes.
        </div>
      )}

      <CouponsView metaReady={metaReady} />

      <p className="mt-6 text-xs text-muted">
        La imagen y el texto dicen &quot;para hoy&quot; y que los cupones aplican a productos seleccionados por Mercado
        Libre. No publiques cupones de otro día: Mercado Libre los cambia seguido.
      </p>
    </div>
  );
}
