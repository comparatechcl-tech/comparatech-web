'use server';

/**
 * Acciones de "Agregar desde Mercado Libre" (/admin/candidatos/agregar).
 *
 * Revisar solo lee. Agregar vuelve a revisar el producto en el servidor antes
 * de guardarlo (precio, vendedor verde, categoría): lo que llega del navegador
 * no se toma por bueno. Publicar usa la misma aprobación que la cola de
 * candidatos, con su link directo, sus controles y su registro.
 */

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken, mlTokenError } from '@/lib/ml-enrichment';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { directLinksUsable } from '@/lib/admin-settings';
import { readAffiliateSettings } from '@/lib/settings';
import { parseMlInput } from '@/lib/ml-links';
import { minCommissionFromEnv } from '@/lib/prospect-filter';
import {
  inspectCatalogProduct,
  reviewInput,
  saveManualCandidate,
  type ReviewContext,
  type ReviewItem,
} from '@/lib/manual-add';
import { approveCandidate } from '../actions';

/** Links por tanda: cada uno son ~5 consultas a ML. */
const MAX_LINKS = 10;

const ML_ID = /^MLC\d{5,15}$/;

export type ReviewLinksResult =
  | { ok: true; items: ReviewItem[]; omitted: number }
  | { ok: false; error: string };

export type AddFromMlResult =
  | {
      ok: true;
      /** en_cola: quedó en Candidatos. publicado / en_pausa: ya es producto del sitio. */
      outcome: 'en_cola' | 'publicado' | 'en_pausa';
      slug?: string;
      reason?: string;
      /** Se pidió publicar y no se pudo: quedó en la cola y esto dice por qué. */
      notPublished?: string;
    }
  | { ok: false; error: string };

async function reviewContext(): Promise<ReviewContext | { error: string }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { error: 'Supabase admin no configurado' };
  const token = await getMlToken();
  if (!token) return { error: `No se pudo conectar con Mercado Libre (${mlTokenError() ?? 'sin detalle'}). Intenta de nuevo.` };
  const usable = await directLinksUsable(admin);
  const settings = usable ? await readAffiliateSettings(admin) : null;
  return {
    admin,
    token,
    affiliate: settings ? { word: settings.word, tool: settings.tool } : null,
    minCommission: minCommissionFromEnv(),
  };
}

/** Revisa lo pegado (links o códigos) sin guardar nada. */
export async function reviewMlLinks(text: string): Promise<ReviewLinksResult> {
  await requireAdmin();
  const inputs = parseMlInput(String(text ?? ''));
  if (inputs.length === 0) {
    return { ok: false, error: 'No encontré links ni códigos de Mercado Libre en lo que pegaste.' };
  }
  const ctx = await reviewContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  try {
    const items = await mapWithConcurrency(inputs.slice(0, MAX_LINKS), 4, (input) => reviewInput(input, ctx));
    return { ok: true, items, omitted: Math.max(inputs.length - MAX_LINKS, 0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo revisar. Intenta de nuevo.' };
  }
}

/**
 * Deja el producto en la cola de candidatos y, con `publish`, lo publica al
 * tiro con su link de afiliado directo.
 */
export async function addFromMl(mlProductId: string, publish: boolean): Promise<AddFromMlResult> {
  const actor = await requireAdmin();
  const id = String(mlProductId ?? '').trim().toUpperCase();
  if (!ML_ID.test(id)) return { ok: false, error: 'Ese no es un código de ficha de Mercado Libre (MLC…).' };

  const ctx = await reviewContext();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  let inspected: Awaited<ReturnType<typeof inspectCatalogProduct>>;
  try {
    inspected = await inspectCatalogProduct(id, id, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo revisar. Intenta de nuevo.' };
  }
  if ('notFound' in inspected) return { ok: false, error: `Mercado Libre no tiene una ficha con el código ${id}.` };
  const { preview, candidate } = inspected;
  if (preview.state === 'en_sitio') return { ok: false, error: 'Este producto ya está en el sitio.' };
  if (!candidate) return { ok: false, error: preview.reason ?? 'No se puede agregar este producto.' };

  const saved = await saveManualCandidate(ctx.admin, candidate);
  if (!saved.ok) return saved;

  await logAdminEvent(ctx.admin, {
    actor,
    action: 'agregar_desde_ml',
    target: saved.id,
    after: { ml_product_id: id, name: preview.name, price: preview.price, seller: preview.sellerNickname, publish },
  });
  revalidatePath('/admin/candidatos');

  if (!publish) return { ok: true, outcome: 'en_cola' };

  const approved = await approveCandidate(saved.id, '');
  if (!approved.ok) return { ok: true, outcome: 'en_cola', notPublished: approved.error };
  return {
    ok: true,
    outcome: approved.outcome,
    slug: approved.slug,
    ...(approved.reason ? { reason: approved.reason } : {}),
  };
}
