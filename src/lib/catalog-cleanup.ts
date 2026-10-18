/**
 * Qué conviene sacar del catálogo (/admin/productos/limpiar).
 *
 * Los candidatos se aprueban en bloque y se cuela de todo. Cada producto
 * visible cuesta trabajo en cada revisión de precios (cada 30 minutos, con un
 * techo de 60 segundos: con ~1.200 productos ya usa 26-40 s) y pesa en el
 * catálogo que arma cada página. Sacarlo lo oculta y lo marca como eliminado:
 * deja de revisarse y se puede reponer desde Productos → Eliminados.
 *
 * Esto solo sugiere: decide el dueño. Nunca sugiere lo fijado en la portada,
 * lo que tuvo clics en el último mes, lo publicado en redes hace poco ni las
 * versiones de un modelo con página propia (lib/models): esas páginas viven
 * de mostrar todos los colores y capacidades. El 18-10-2026 los "colores
 * repetidos" se llevaron 15 versiones de los iPhone y Galaxy, incluidas las
 * de 512 GB y 2 TB, porque Mercado Libre pone las capacidades en la misma
 * familia que los colores.
 *
 * Sin imports del servidor: lo usan también los tests sin base.
 */

import { estimateCommission } from '@/lib/commission';
import { domainLabel } from '@/lib/product-types';
import { modelOf } from '@/lib/models';

export type CleanupReason = 'pausa_larga' | 'comision_baja' | 'color_repetido';

/** En pausa (sin vendedor, o vendedor no verde) por más de esto: lleva días sin vender nada. */
export const LONG_PAUSE_DAYS = 7;

/** Bajo esto por venta, el producto casi no aporta aunque se venda. */
export const LOW_COMMISSION_CLP = 1000;

/** Lo publicado en redes en estos días se queda: sus links siguen circulando. */
export const RECENT_POST_DAYS = 14;

/** Lo agregado en estos días se puede revisar en "Recién agregados". */
export const RECENT_ADD_DAYS = 7;

const DAY_MS = 86_400_000;

export interface CleanupRow {
  id: string;
  slug: string;
  name: string;
  image_url: string;
  price: number;
  category: string;
  ml_domain_id: string | null;
  ml_root_category: string | null;
  ml_family_id: string | null;
  is_active: boolean;
  inactive_since: string | null;
  inactive_reason: string | null;
  created_at: string;
  is_featured?: boolean | null;
}

export interface CleanupItem {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  price: number;
  category: string;
  domainId: string | null;
  typeLabel: string;
  commission: number;
  /** Clics hacia ML en los últimos 30 días. */
  clicks: number;
  createdAt: string;
  /** Días en pausa; null si está a la venta. */
  pausedDays: number | null;
  reasons: CleanupReason[];
  /** Por qué no se sugiere aunque tenga motivos; null si se puede sugerir. */
  keep: string | null;
}

export interface CleanupSignals {
  /** Clics de los últimos 30 días por producto. */
  clicks: Map<string, number>;
  /** Productos publicados en redes en los últimos RECENT_POST_DAYS días. */
  recentlyPosted: Set<string>;
  now: Date;
}

/**
 * La capacidad que dice el nombre, en GB ("256 GB", "2 TB", "8+256gb"): la
 * cifra más grande, porque la memoria RAM ("8 GB de RAM") siempre es menor.
 * null si el nombre no dice ninguna.
 */
export function storageOf(name: string): number | null {
  let max: number | null = null;
  for (const m of name.matchAll(/(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi)) {
    const gb = parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'tb' ? 1024 : 1);
    if (Number.isFinite(gb) && (max === null || gb > max)) max = gb;
  }
  return max;
}

/**
 * Los colores de un mismo producto: misma familia de Mercado Libre y misma
 * capacidad. La familia junta también las capacidades (un iPhone de 256 GB y
 * uno de 2 TB), y esas son productos distintos, no colores. null si no tiene familia.
 */
function colorGroup(row: CleanupRow): string | null {
  return row.ml_family_id ? `${row.ml_family_id}|${storageOf(row.name) ?? ''}` : null;
}

/** El color que se queda de cada grupo: el más barato a la venta (o el más barato, si ninguno lo está). */
function familyKeepers(rows: CleanupRow[]): Set<string> {
  const best = new Map<string, CleanupRow>();
  const better = (a: CleanupRow, b: CleanupRow) =>
    a.is_active !== b.is_active ? a.is_active : a.price !== b.price ? a.price < b.price : a.created_at < b.created_at;
  for (const row of rows) {
    const group = colorGroup(row);
    if (!group) continue;
    const current = best.get(group);
    if (!current || better(row, current)) best.set(group, row);
  }
  return new Set([...best.values()].map((r) => r.id));
}

export function analyzeCatalog(rows: CleanupRow[], signals: CleanupSignals): CleanupItem[] {
  const now = signals.now.getTime();
  const groupSize = new Map<string, number>();
  for (const row of rows) {
    const group = colorGroup(row);
    if (group) groupSize.set(group, (groupSize.get(group) ?? 0) + 1);
  }
  const keepers = familyKeepers(rows);

  return rows.map((row) => {
    const commission = estimateCommission(row.price, row.ml_root_category);
    const since = row.inactive_since ? new Date(row.inactive_since).getTime() : NaN;
    const pausedDays = row.is_active ? null : Number.isFinite(since) ? Math.floor((now - since) / DAY_MS) : 0;
    const clicks = signals.clicks.get(row.id) ?? 0;

    const reasons: CleanupReason[] = [];
    if (pausedDays !== null && pausedDays > LONG_PAUSE_DAYS) reasons.push('pausa_larga');
    if (commission < LOW_COMMISSION_CLP) reasons.push('comision_baja');
    const group = colorGroup(row);
    if (group && (groupSize.get(group) ?? 0) > 1 && !keepers.has(row.id)) {
      reasons.push('color_repetido');
    }

    const model = modelOf(row);
    const keep = row.is_featured
      ? 'Fijado en la portada'
      : clicks > 0
        ? `${clicks} ${clicks === 1 ? 'clic' : 'clics'} este mes`
        : signals.recentlyPosted.has(row.id)
          ? 'Publicado en redes hace poco'
          : model
            ? `Versión de ${model.name}, que tiene su página`
            : null;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      imageUrl: row.image_url,
      price: row.price,
      category: row.category,
      domainId: row.ml_domain_id,
      typeLabel: domainLabel(row.ml_domain_id),
      commission,
      clicks,
      createdAt: row.created_at,
      pausedDays,
      reasons,
      keep,
    };
  });
}

export type CleanupView = 'sugeridos' | 'pausa' | 'comision' | 'colores' | 'recientes' | 'tipo';

export const CLEANUP_VIEWS: { value: CleanupView; label: string }[] = [
  { value: 'sugeridos', label: 'Sugeridos' },
  { value: 'recientes', label: 'Recién agregados' },
  { value: 'pausa', label: 'En pausa hace días' },
  { value: 'comision', label: 'Comisión baja' },
  { value: 'colores', label: 'Colores repetidos' },
  { value: 'tipo', label: 'Por tipo' },
];

const VIEW_REASON: Partial<Record<CleanupView, CleanupReason>> = {
  pausa: 'pausa_larga',
  comision: 'comision_baja',
  colores: 'color_repetido',
};

export function isCleanupView(value: string | undefined): value is CleanupView {
  return CLEANUP_VIEWS.some((v) => v.value === value);
}

/**
 * Los productos de una vista, en el orden en que conviene mirarlos. Las
 * vistas de motivos dejan fuera lo protegido; "Recién agregados" y "Por tipo"
 * muestran todo (lo protegido, con su nota).
 */
export function cleanupView(items: CleanupItem[], view: CleanupView, now: Date, type?: string): CleanupItem[] {
  if (view === 'recientes') {
    const since = now.getTime() - RECENT_ADD_DAYS * DAY_MS;
    return items
      .filter((i) => new Date(i.createdAt).getTime() >= since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (view === 'tipo') {
    return items.filter((i) => (i.domainId ?? '') === (type ?? '')).sort((a, b) => a.commission - b.commission);
  }
  const reason = VIEW_REASON[view];
  return items
    .filter((i) => !i.keep && (reason ? i.reasons.includes(reason) : i.reasons.length > 0))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.commission - b.commission);
}

/** Tipos de producto con cuántos hay de cada uno, del que más tiene al que menos. */
export function typeCounts(items: CleanupItem[]): { domainId: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const key = item.domainId ?? '';
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { label: item.typeLabel, count: 1 });
  }
  return [...counts.entries()]
    .map(([domainId, v]) => ({ domainId, ...v }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

/** "Lleva 12 días en pausa", "Deja ~$350 por venta"… para cada motivo. */
export function reasonText(item: CleanupItem, reason: CleanupReason): string {
  switch (reason) {
    case 'pausa_larga':
      return `Lleva ${item.pausedDays} días en pausa`;
    case 'comision_baja':
      return `Deja ~$${item.commission.toLocaleString('es-CL')} por venta`;
    case 'color_repetido':
      return 'Otro color de un modelo que ya está';
  }
}
