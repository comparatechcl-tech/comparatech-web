import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { OPTIONAL_SCOPES, REQUIRED_SCOPES, metaCredentials, readMetaConnection, toStatus } from '@/lib/social/meta';
import { MetaConnectForm, MetaConnectedActions } from './MetaConnect';

export const dynamic = 'force-dynamic';

function formatChile(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Conectar la app propia de Meta. El token nunca llega a esta página: se
 * lee la conexión y se pasa solo su resumen (toStatus).
 */
export default async function MetaPage() {
  const hasCreds = metaCredentials() !== null;
  const { available, connection } = await readMetaConnection(getSupabaseAdmin());
  const status = connection ? toStatus(connection) : null;
  const scopes = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];

  let expiry = 'No se pudo confirmar';
  if (status?.tokenExpiryKnown) expiry = status.tokenExpiresAt ? `Vence el ${formatChile(status.tokenExpiresAt)}` : 'No vence';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/configuracion" className="text-sm text-accent hover:underline">
        ← Configuración
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-bold text-fg">Instagram y Facebook (app de Meta)</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Con esta conexión el sitio puede publicar en tu página de Facebook y en Instagram sin usar el cupo de
        Metricool. Conectar no publica nada: cada publicación la apruebas tú.
      </p>

      {!hasCreds && (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          Faltan <code>META_APP_ID</code> y <code>META_APP_SECRET</code> en Vercel (solo Production). Son el paso 1 de la
          guía. Después de agregarlos hay que publicar el sitio de nuevo para que los tome.
        </p>
      )}
      {!available && (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          No se pudo leer la configuración privada (tabla de la migración 0013).
        </p>
      )}

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">{status ? 'Conectado' : 'Sin conectar'}</h2>
        {status ? (
          <>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Página de Facebook</dt>
                <dd className="mt-0.5 text-fg">{status.pageName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Instagram</dt>
                <dd className="mt-0.5 text-fg">{status.igUsername ? `@${status.igUsername}` : status.igUserId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Conectado</dt>
                <dd className="mt-0.5 text-fg">
                  {formatChile(status.connectedAt)}
                  {status.connectedBy && <span className="text-muted"> · {status.connectedBy}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Permiso de publicación</dt>
                <dd className="mt-0.5 text-fg">{expiry}</dd>
              </div>
            </dl>
            <MetaConnectedActions />
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium text-fg">Volver a conectar</summary>
              <MetaConnectForm scopes={scopes} />
            </details>
          </>
        ) : (
          <MetaConnectForm scopes={scopes} />
        )}
      </section>
    </main>
  );
}
