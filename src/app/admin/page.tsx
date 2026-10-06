import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { readAffiliateSettings } from '@/lib/settings';
import { directLinksInUse, readAttributionStatus } from '@/lib/admin-settings';
import { getCategoryInfo } from '@/lib/categories';
import { readAdminSummary, type CategoryCoverage, type DigestStatus, type Stat } from '@/lib/admin-stats';

export const dynamic = 'force-dynamic';

/**
 * Resumen del admin: lo que hay que mirar al entrar.
 *
 * Antes /admin daba 404 y nada avisaba que llevábamos 19 días sin publicar,
 * que el refresco de precios no estaba corriendo o que los links directos
 * estaban encendidos sin comprobar. Esta vista junta, de un vistazo, si el
 * catálogo crece, si los procesos automáticos están vivos y si los clics
 * hacia Mercado Libre siguen llegando.
 *
 * Si una consulta falla se muestra "—" y un aviso rojo, nunca un 0: un 0
 * por error se lee como "todo al día".
 */

/** Sin publicar por más de esto, el número se pone rojo. */
const STALE_PUBLISH_DAYS = 3;
/** El refresco corre cada 30 min: sobre 1 hora algo se atrasó. */
const PRICE_WARN_MIN = 60;
/** Sobre 6 horas el refresco no está corriendo (el respaldo de GitHub corre cada 3 a 6 h). */
const PRICE_BAD_MIN = 360;
/** La prospección corre una vez al día. */
const PROSPECT_WARN_HOURS = 26;

const TZ = 'America/Santiago';
const whenFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-fg',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  neutral: 'text-fg',
};

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-accent',
  warn: 'bg-amber-400',
  bad: 'bg-red-500',
  neutral: 'bg-muted',
};

const NUMBER = new Intl.NumberFormat('es-CL');

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : NUMBER.format(value);
}

function plural(n: number, one: string, many: string): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : whenFmt.format(date);
}

/** "45 min" o "190 min (3 h)": sobre dos horas los minutos solos cuestan leerlos. */
function formatMinutes(min: number): string {
  if (min < 120) return `${NUMBER.format(min)} min`;
  return `${NUMBER.format(min)} min (${NUMBER.format(Math.floor(min / 60))} h)`;
}

export default async function ResumenPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();

  // La configuración va primero: con los links directos en uso, un link
  // guardado repetido o sin meli.la deja de contar como problema.
  const [settings, attribution] = await Promise.all([readAffiliateSettings(admin), readAttributionStatus(admin)]);
  const directInUse = directLinksInUse(settings, attribution);
  const summary = await readAdminSummary(admin, now, { directLinks: directInUse });

  const dias = summary.diasSinPublicar.data;
  // readAffiliateSettings no avisa si falla: devuelve "apagados". Con la base
  // caída, mostrar "meli.la" sería afirmar algo que no se pudo leer.
  const linkModeUnknown = summary.errors.length > 0 && !settings.directLinks;
  const accion = summary.requierenAccion.data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Resumen</h1>
          <p className="mt-1 text-sm text-muted">Cómo está el catálogo hoy y si los procesos automáticos siguen vivos.</p>
        </div>
        <Link
          href="/admin/candidatos?orden=valor"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-accent/90"
        >
          Revisar tanda de 30 <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      {summary.errors.length > 0 && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Error al leer la base de datos: {summary.errors.join(' · ')}. Los números pueden estar incompletos.
        </div>
      )}

      {/* Fila 1: el trabajo pendiente. */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Publicados" value={num(summary.publicados.data)} href="/admin/productos" />
        <Kpi
          label="Por revisar"
          value={num(summary.porRevisar.data)}
          sub={summary.nuevosHoy.data === null ? undefined : `+${NUMBER.format(summary.nuevosHoy.data)} hoy`}
          href="/admin/candidatos?orden=valor"
        />
        <Kpi
          label="Requieren acción"
          value={num(accion?.total)}
          tone={accion && accion.total > 0 ? 'warn' : 'neutral'}
          sub={accion ? actionDetail(accion) : undefined}
          href="/admin/problemas"
        />
        <Kpi
          label="Días sin publicar"
          value={!dias ? '—' : dias.days === null ? 'Nunca' : num(dias.days)}
          tone={dias?.days !== null && dias?.days !== undefined && dias.days > STALE_PUBLISH_DAYS ? 'bad' : 'neutral'}
          sub={dias?.at ? `Último: ${formatWhen(dias.at)}` : undefined}
        />
      </section>

      {/* Salud: si lo automático está corriendo. */}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold text-fg">Salud</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          <PriceHealth stat={summary.ultimoPrecioMin} />
          <HealthRow
            tone={prospectTone(summary.ultimaProspeccion.data?.at ?? null, now, summary.ultimaProspeccion.error)}
            label="Última prospección"
            value={
              summary.ultimaProspeccion.error
                ? '—'
                : summary.ultimaProspeccion.data
                  ? `${formatWhen(summary.ultimaProspeccion.data.at)} · ${
                      summary.ultimaProspeccion.data.nuevos === null
                        ? '— nuevos'
                        : plural(summary.ultimaProspeccion.data.nuevos, 'nuevo', 'nuevos')
                    }`
                  : 'sin datos'
            }
          />
          <DigestHealth stat={summary.correoAyer} />
          <HealthRow
            tone={
              linkModeUnknown ? 'neutral' : settings.directLinks ? (attribution.status === 'confirmada' ? 'ok' : 'bad') : 'ok'
            }
            label="Modo de links"
            value={
              linkModeUnknown
                ? '—'
                : settings.directLinks
                  ? attribution.status === 'confirmada'
                    ? 'directos (comprobados)'
                    : 'directos (sin comprobar)'
                  : 'meli.la'
            }
            href="/admin/configuracion"
          />
          {directInUse && summary.linksSinVerificar.data === 0 ? (
            <HealthRow
              tone="ok"
              label="Links sin verificar"
              value="no aplica"
              hint="Con los links directos, el botón de compra se arma desde la ficha de cada producto."
            />
          ) : (
            <HealthRow
              tone={summary.linksSinVerificar.data ? 'warn' : 'neutral'}
              label="Links sin verificar"
              value={num(summary.linksSinVerificar.data)}
              hint="Activos cuyo link nunca se abrió para comprobar a qué ficha lleva."
            />
          )}
        </ul>
      </section>

      {/* Plata: los clics son lo único que se ve al tiro; las comisiones tardan semanas. */}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold text-fg">Plata</h2>
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          {summary.clics.missing ? (
            <p className="text-sm text-amber-400">Activa la medición de clics (migración 0015).</p>
          ) : (
            <div>
              <p className="text-xs text-muted">Clics a ML hoy / últimos 7 días</p>
              <p className="mt-1 font-heading text-2xl font-bold text-fg">
                {num(summary.clics.data?.hoy)} <span className="text-muted">/</span> {num(summary.clics.data?.ultimos7)}
              </p>
            </div>
          )}
          <Link
            href="/admin/metricas"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-surface2 px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50"
          >
            Ver métricas <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold text-fg">Cobertura por categoría</h2>
        <p className="mt-1 text-sm text-muted">Dónde el sitio está flaco y dónde hay candidatos esperando.</p>
        <Coverage stat={summary.coberturaPorCategoria} />
      </section>
    </div>
  );
}

function actionDetail(a: { linkNuevo: number; repetidos: number; sinRespaldo: number; total: number }): string {
  if (a.total === 0) return 'Nada pendiente';
  const parts = [
    a.linkNuevo > 0 ? `${NUMBER.format(a.linkNuevo)} link nuevo` : null,
    a.repetidos > 0 ? `${NUMBER.format(a.repetidos)} repetidos` : null,
    a.sinRespaldo > 0 ? `${NUMBER.format(a.sinRespaldo)} sin respaldo` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function prospectTone(at: string | null, now: Date, error: string | null): Tone {
  if (error) return 'neutral';
  if (!at) return 'warn';
  const hours = (now.getTime() - new Date(at).getTime()) / 3_600_000;
  return hours > PROSPECT_WARN_HOURS ? 'warn' : 'ok';
}

function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-heading text-3xl font-bold ${TONE_TEXT[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </>
  );
  const className = 'block rounded-xl border border-border bg-surface p-4';
  return href ? (
    <Link href={href} className={`${className} transition hover:border-accent/50`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function HealthRow({
  tone,
  label,
  value,
  hint,
  href,
}: {
  tone: Tone;
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">
          {label}: <strong className={`font-semibold ${TONE_TEXT[tone]}`}>{value}</strong>
        </p>
        {hint && <p className={`mt-0.5 text-xs ${tone === 'bad' ? 'text-red-400' : 'text-muted'}`}>{hint}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-xs font-medium text-accent hover:underline">
          Cambiar
        </Link>
      )}
    </li>
  );
}

function PriceHealth({ stat }: { stat: Stat<number | null> }) {
  if (stat.error) return <HealthRow tone="neutral" label="Precios verificados" value="—" />;
  const min = stat.data;
  if (min === null) return <HealthRow tone="warn" label="Precios verificados" value="sin datos" />;
  const tone: Tone = min > PRICE_BAD_MIN ? 'bad' : min > PRICE_WARN_MIN ? 'warn' : 'ok';
  return (
    <HealthRow
      tone={tone}
      label="Precios verificados"
      value={`hace ${formatMinutes(min)}`}
      hint={
        tone === 'bad'
          ? 'El refresco cada 30 min no está corriendo: aplica la migración 0011 en Supabase'
          : tone === 'warn'
            ? 'El refresco va atrasado: debería correr cada 30 minutos.'
            : undefined
      }
    />
  );
}

const DIGEST_LABELS: Record<DigestStatus, string> = {
  enviado: 'enviado',
  fallo: 'falló',
  sin_datos: 'sin datos',
};

function DigestHealth({ stat }: { stat: Stat<{ status: DigestStatus; at: string | null }> }) {
  if (stat.error) return <HealthRow tone="neutral" label="Correo diario" value="—" />;
  const status = stat.data?.status ?? 'sin_datos';
  const tone: Tone = status === 'enviado' ? 'ok' : status === 'fallo' ? 'bad' : 'neutral';
  return (
    <HealthRow
      tone={tone}
      label="Correo diario"
      value={stat.data?.at ? `${DIGEST_LABELS[status]} (${formatWhen(stat.data.at)})` : DIGEST_LABELS[status]}
      hint={
        stat.missing
          ? 'Para verlo hay que aplicar la migración 0018 (historial de los procesos automáticos).'
          : status === 'fallo'
            ? 'Revisa DIGEST_TO y la clave del servicio de correo en Vercel.'
            : undefined
      }
    />
  );
}

function Coverage({ stat }: { stat: Stat<CategoryCoverage[]> }) {
  if (!stat.data) return <p className="mt-3 text-sm text-muted">—</p>;
  if (stat.data.length === 0) return <p className="mt-3 text-sm text-muted">Todavía no hay productos ni candidatos.</p>;

  const max = Math.max(1, ...stat.data.map((c) => c.publicados + c.pendientes));
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-accent" aria-hidden /> Publicados
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-amber-400/60" aria-hidden /> Por revisar
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        {stat.data.map((c) => (
          <li key={c.category}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-fg">{getCategoryInfo(c.category)?.name ?? c.category}</span>
              <span className="shrink-0 text-xs text-muted">
                {NUMBER.format(c.publicados)} publicados · {NUMBER.format(c.pendientes)} por revisar
              </span>
            </div>
            <div
              className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-surface2"
              role="img"
              aria-label={`${c.publicados} publicados y ${c.pendientes} por revisar`}
            >
              <div className="h-full bg-accent" style={{ width: `${(c.publicados / max) * 100}%` }} />
              <div className="h-full bg-amber-400/60" style={{ width: `${(c.pendientes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
