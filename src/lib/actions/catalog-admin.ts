'use server';

/**
 * Acciones del admin sobre el catálogo publicado.
 *
 * Existen porque el correo diario avisaba de productos con problemas, pero
 * desde el admin no había cómo resolverlos: guardar un link nuevo no
 * republicaba nada, había que esperar hasta 24 horas a que el cron lo
 * notara. Ahora cada acción consulta Mercado Libre en el momento y deja el
 * producto publicado —o explica por qué no— antes de responder.
 *
 * Los links de afiliado son la única fuente de ingresos: cada acción
 * verifica quién la pide (requireAdmin), valida el link antes de guardarlo y
 * deja registro en admin_audit_log.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken } from '@/lib/ml-enrichment';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { directLinksUsable, readAttributionStatus } from '@/lib/admin-settings';
import { sendEmail } from '@/lib/email';
import { escapeHtml } from '@/lib/daily-digest';
import { isAllowedAffiliateUrl, isMeliLaUrl } from '@/lib/outbound';
import { checkAffiliateOwnership, inspectAffiliateLink } from '@/lib/affiliate-link';
import { linkVerdict, resolveLinkTarget, type LinkVerdict } from '@/lib/link-check';
import {
  PRICED_COLUMNS,
  applyPricing,
  priceProducts,
  summarizePricing,
  type PricedProduct,
  type PricingResult,
} from '@/lib/pricing';
import {
  expectedAffiliateOwner,
  readAffiliateSettings,
  rememberAffiliateParams,
  writeAffiliateSettings,
  type AffiliateSettings,
} from '@/lib/settings';
import { MAX_BATCH, matchLinksToTargets } from '@/lib/link-batch';
import type { BatchResult } from '@/lib/batch-result';

type Fail = { ok: false; error: string };

function refreshSite() {
  // Precios y disponibilidad se ven en casi todas las páginas públicas.
  // La etiqueta 'catalog' tira además la lectura compartida del catálogo
  // (unstable_cache de 60 s), para que el cambio se vea de inmediato.
  revalidateTag('catalog');
  revalidatePath('/', 'layout');
}

/**
 * ¿Se puede guardar este link? Va antes de abrirlo: un 'javascript:' o un
 * dominio ajeno terminaría como href del botón de compra en todo el sitio.
 */
function affiliateUrlError(url: string): string | null {
  if (isAllowedAffiliateUrl(url)) return null;
  if (/^http:\/\//i.test(url) && isAllowedAffiliateUrl(url.replace(/^http:/i, 'https:'))) {
    return 'El link tiene que empezar con https://. Cópialo de nuevo desde el Generador de links de Mercado Libre.';
  }
  return 'Ese link no es de Mercado Libre';
}

const DIRECT_NOT_CONFIRMED =
  'Pega el link meli.la: la atribución de los links directos aún no está comprobada.';

/**
 * Misma regla que al aprobar un candidato: mientras no se compruebe que ML
 * paga comisión por un link directo, solo se acepta un meli.la. Sin esto se
 * podía guardar una /p/MLC… copiada del navegador, sin matt_word ni
 * matt_tool, que no deja comisión si los links directos se apagan. Va antes
 * de abrir el link, para no abrir uno que igual se va a rechazar.
 */
async function directLinkError(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>, url: string) {
  if (isMeliLaUrl(url)) return null;
  return (await directLinksUsable(admin)) ? null : DIRECT_NOT_CONFIRMED;
}

export type LinkCheck = { ok: true; verdict: LinkVerdict; featuredProductId: string | null } | Fail;

/** Botón "Verificar": dice si el link lleva a esta ficha, sin guardar nada. */
export async function checkAffiliateLink(url: string, mlProductId: string | null): Promise<LinkCheck> {
  await requireAdmin();
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link' };
  const urlError = affiliateUrlError(trimmed);
  if (urlError) return { ok: false, error: urlError };
  if (!mlProductId) return { ok: false, error: 'Este producto no tiene ficha de Mercado Libre asociada' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };
  const directError = await directLinkError(admin, trimmed);
  if (directError) return { ok: false, error: directError };

  // Queda memoizado: si después se aprueba o guarda este mismo link, no se
  // vuelve a abrir (cada apertura cuenta como un clic de afiliado).
  const inspected = await inspectAffiliateLink(trimmed);
  if (!inspected.ok) return { ok: false, error: inspected.error };

  const foreign = checkAffiliateOwnership(inspected.info, await expectedAffiliateOwner(admin));
  if (foreign) return { ok: false, error: foreign };

  return {
    ok: true,
    verdict: await linkVerdict(inspected.info, mlProductId, await getMlToken()),
    featuredProductId: inspected.info.featuredProductId,
  };
}

export type RecheckResult =
  | {
      ok: true;
      summary: ReturnType<typeof summarizePricing>;
      results: { id: string; result: PricingResult }[];
    }
  | Fail;

/**
 * Vuelve a consultar ML ahora mismo. Sin ids, revisa todos los productos
 * fuera del sitio (botón "Revisar todos ahora" de la vista de problemas).
 */
export async function recheckProducts(ids?: string[]): Promise<RecheckResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  let query = admin
    .from('products')
    .select(PRICED_COLUMNS)
    .not('ml_product_id', 'is', null)
    .eq('is_hidden', false);
  query = ids && ids.length > 0 ? query.in('id', ids) : query.eq('is_active', false);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };

  const products = (data ?? []) as unknown as PricedProduct[];
  if (products.length === 0) {
    return { ok: true, summary: summarizePricing([]), results: [] };
  }

  const token = await getMlToken();
  if (!token) return { ok: false, error: 'No se pudo conectar con Mercado Libre. Intenta de nuevo en un rato.' };

  const { directLinks } = await readAffiliateSettings(admin);
  const outcomes = await priceProducts(products, token, {
    directLinks,
    verifyLink: (p) => resolveLinkTarget(p.affiliate_url, p.ml_product_id, token),
  });
  await applyPricing(admin, outcomes);
  refreshSite();

  const summary = summarizePricing(outcomes);
  await logAdminEvent(admin, {
    actor,
    action: 'reverificar',
    target: ids && ids.length > 0 ? ids.join(',') : 'fuera_del_sitio',
    after: summary,
  });

  return {
    ok: true,
    summary,
    results: outcomes.map((o) => ({ id: o.id, result: o.result })),
  };
}

export type RepublishResult =
  | {
      ok: true;
      result: PricingResult | 'pendiente';
      /** False si no se pudo comprobar a qué ficha lleva el link (ver LinkVerdict). */
      verified: boolean;
    }
  | Fail;

/**
 * Guarda un link nuevo y deja el producto publicado en el mismo paso.
 *
 * Antes de guardar se comprueba que el link sea de Mercado Libre, de la
 * cuenta ComparaTech, y que lleve a esta ficha: un link a otro producto no
 * se acepta, porque el comprador terminaría viendo algo distinto a lo
 * publicado.
 */
export async function republishWithLink(productId: string, url: string): Promise<RepublishResult> {
  const actor = await requireAdmin();
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link de afiliado' };
  const urlError = affiliateUrlError(trimmed);
  if (urlError) return { ok: false, error: urlError };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await admin
    .from('products')
    .select(`${PRICED_COLUMNS}, name`)
    .eq('id', productId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Ese producto ya no existe' };
  const { name, ...product } = data as unknown as PricedProduct & { name: string };

  const directError = await directLinkError(admin, trimmed);
  if (directError) return { ok: false, error: directError };

  const inspected = await inspectAffiliateLink(trimmed);
  if (!inspected.ok) return { ok: false, error: `No se pudo abrir el link: ${inspected.error}` };

  const foreign = checkAffiliateOwnership(inspected.info, await expectedAffiliateOwner(admin));
  if (foreign) return { ok: false, error: foreign };

  const token = await getMlToken();
  const { featuredProductId, itemId, mattWord, mattTool } = inspected.info;
  const verdict = await linkVerdict(inspected.info, product.ml_product_id, token);

  // Solo se rechaza con evidencia: si el perfil no muestra el producto (o ML
  // le respondió otra página al servidor), el link se guarda igual. Quien lo
  // pegó lo generó desde la ficha, y bloquearlo dejaría el producto sin
  // forma de volver al sitio.
  if (verdict === 'otra_ficha') {
    return {
      ok: false,
      error: `Este link lleva a otra ficha (${featuredProductId}), no a la de este producto. Genéralo desde la ficha correcta en Mercado Libre.`,
    };
  }
  const verified = verdict === 'coincide';

  const linkFields = {
    affiliate_url: trimmed,
    ml_item_id: itemId,
    // Sin verificar queda en null, igual que un link que nunca se revisó:
    // así no hereda el "lleva a otra ficha" del link anterior.
    link_target_product_id: verified ? product.ml_product_id : null,
    link_checked_at: verified ? new Date().toISOString() : null,
  };
  const { error: saveError } = await admin.from('products').update(linkFields).eq('id', productId);
  if (saveError) return { ok: false, error: saveError.message };

  await logAdminEvent(admin, {
    actor,
    action: 'guardar_link',
    target: productId,
    before: { name, affiliate_url: product.affiliate_url },
    after: { name, affiliate_url: trimmed, verified },
  });
  await rememberAffiliateParams(admin, mattWord, mattTool);

  if (!token) {
    refreshSite();
    return { ok: true, result: 'pendiente', verified };
  }

  const [outcome] = await priceProducts([{ ...product, ...linkFields }], token);
  await applyPricing(admin, [outcome]);
  refreshSite();
  return { ok: true, result: outcome.result, verified };
}

/**
 * Configuración de afiliado editada desde /admin/configuracion.
 *
 * Es lo que decide a quién le paga Mercado Libre: cada cambio queda
 * registrado y avisa por correo. Encender los links directos sin la prueba
 * de atribución confirmada exige `confirm: true` (el diálogo del admin):
 * antes se encendían con un clic, sin aviso ni historial.
 */
export async function saveAffiliateConfig(input: {
  word: string;
  tool: string;
  directLinks: boolean;
  confirm?: boolean;
}): Promise<{ ok: true } | Fail> {
  const actor = await requireAdmin();
  const word = input.word.trim();
  const tool = input.tool.trim();

  if (input.directLinks && (!word || !tool)) {
    return { ok: false, error: 'Para usar links directos hacen falta matt_word y matt_tool.' };
  }
  if (word && !/^[A-Za-z0-9_.-]{2,64}$/.test(word)) {
    return { ok: false, error: 'matt_word solo puede tener letras, números, punto, guion y guion bajo.' };
  }
  if (tool && !/^\d{3,20}$/.test(tool)) {
    return { ok: false, error: 'matt_tool debe ser un número.' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const before = await readAffiliateSettings(admin);
  if (!before.directLinks && input.directLinks && input.confirm !== true) {
    const attribution = await readAttributionStatus(admin);
    if (attribution.status !== 'confirmada') {
      return { ok: false, error: 'Confirma el cambio: la atribución de los links directos no está comprobada.' };
    }
  }

  const saved = await writeAffiliateSettings(admin, {
    word: word || null,
    tool: tool || null,
    directLinks: input.directLinks,
  });
  if (!saved.ok) return saved;

  await logAdminEvent(admin, {
    actor,
    action: 'config_afiliado',
    target: 'affiliate',
    before: saved.previous,
    after: saved.settings,
  });

  const changed =
    saved.previous.word !== saved.settings.word ||
    saved.previous.tool !== saved.settings.tool ||
    saved.previous.directLinks !== saved.settings.directLinks;
  if (changed) await notifyAffiliateChange(actor, saved.previous, saved.settings);

  // Encender o apagar los links directos cambia si importa a dónde lleva el
  // link guardado: los productos afectados se ajustan ahora y no en el
  // próximo refresco.
  if (saved.previous.directLinks !== input.directLinks) {
    await repriceLinkMismatches(admin, input.directLinks);
  }

  refreshSite();
  return { ok: true };
}

/**
 * Aviso por correo de un cambio en la configuración de afiliado. Si alguien
 * cambia el matt_word o enciende los links directos, el dueño se entera el
 * mismo día y no cuando las comisiones dejen de llegar. Un fallo del correo
 * no deshace el guardado: queda en los logs de Vercel.
 */
async function notifyAffiliateChange(
  actor: string,
  before: AffiliateSettings,
  after: AffiliateSettings
): Promise<void> {
  const to = process.env.DIGEST_TO?.trim();
  if (!to) {
    console.error('[config_afiliado] DIGEST_TO no configurado: no se envió el aviso');
    return;
  }

  const mode = (directLinks: boolean) => (directLinks ? 'Directos' : 'meli.la');
  const rows: [string, string, string][] = [
    ['matt_word', before.word ?? '(vacío)', after.word ?? '(vacío)'],
    ['matt_tool', before.tool ?? '(vacío)', after.tool ?? '(vacío)'],
    ['Modo de links', mode(before.directLinks), mode(after.directLinks)],
  ];
  const when = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date());

  const text = [
    'Cambió la configuración de afiliado de ComparaTech.',
    '',
    ...rows.map(([label, a, b]) => `${label}: ${a} → ${b}${a === b ? ' (sin cambio)' : ''}`),
    '',
    `Quién: ${actor}`,
    `Cuándo: ${when} (hora de Chile)`,
    '',
    'Si no reconoces este cambio, revisa /admin/configuracion y /admin/actividad.',
  ].join('\n');

  const items = rows
    .map(
      ([label, a, b]) =>
        `<li${a === b ? ' style="color:#888"' : ''}><strong>${escapeHtml(label)}</strong>: ${escapeHtml(a)} → ${escapeHtml(b)}${a === b ? ' (sin cambio)' : ''}</li>`
    )
    .join('');
  const html =
    '<p>Cambió la configuración de afiliado de ComparaTech.</p>' +
    `<ul>${items}</ul>` +
    `<p>Quién: <strong>${escapeHtml(actor)}</strong><br>Cuándo: ${escapeHtml(when)} (hora de Chile)</p>` +
    '<p>Si no reconoces este cambio, revisa /admin/configuracion y /admin/actividad.</p>';

  try {
    const sent = await sendEmail({ to, subject: 'ComparaTech · Cambió la configuración de afiliado', html, text });
    if (!sent.ok) console.error(`[config_afiliado] no se pudo enviar el aviso: ${sent.error}`);
  } catch (err) {
    console.error('[config_afiliado] no se pudo enviar el aviso:', err);
  }
}

/** Productos cuyo link guardado lleva a otra ficha que la publicada. */
async function repriceLinkMismatches(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  directLinks: boolean
): Promise<void> {
  const { data } = await admin
    .from('products')
    .select(PRICED_COLUMNS)
    .not('link_target_product_id', 'is', null)
    .eq('is_hidden', false);
  const mismatched = ((data ?? []) as unknown as PricedProduct[]).filter(
    (p) => p.link_target_product_id !== p.ml_product_id
  );
  if (mismatched.length === 0) return;

  const token = await getMlToken();
  if (!token) return;
  await applyPricing(admin, await priceProducts(mismatched, token, { directLinks }));
}

/**
 * Guarda de una vez los links generados en bloque (ver lib/link-batch) y
 * deja los productos publicados. `productIds` va en el mismo orden en que se
 * entregaron las URLs al generador.
 */
export async function republishBatch(productIds: string[], pasted: string): Promise<BatchResult> {
  const actor = await requireAdmin();
  if (productIds.length === 0) return { ok: false, error: 'No hay productos para republicar' };
  if (productIds.length > MAX_BATCH) return { ok: false, error: `Máximo ${MAX_BATCH} productos por tanda` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await admin
    .from('products')
    .select(`${PRICED_COLUMNS}, name`)
    .in('id', productIds);
  if (error) return { ok: false, error: error.message };

  type Row = PricedProduct & { name: string };
  const rows = new Map(((data ?? []) as unknown as Row[]).map((p) => [p.id, p]));
  const products = productIds.map((id) => rows.get(id)).filter((p): p is Row => Boolean(p));

  const expected = await expectedAffiliateOwner(admin);
  const match = await matchLinksToTargets(
    pasted,
    products.map((p) => ({ id: p.id, mlProductId: p.ml_product_id })),
    expected
  );
  if (match.linksFound === 0) {
    return { ok: false, error: 'No encontré links de Mercado Libre (meli.la) en lo que pegaste.' };
  }

  const now = new Date().toISOString();
  const saved: PricedProduct[] = [];
  const verifiedById = new Map<string, boolean>();
  const failedById = new Map<string, string>();

  for (const a of match.assigned) {
    const product = rows.get(a.targetId);
    if (!product) continue;
    // Misma regla que al guardar de a uno. matchLinksToTargets ya deja fuera
    // los links de otra cuenta; esto cubre lo que llegue igual hasta acá.
    const rejectReason = affiliateUrlError(a.url) ?? (a.info ? checkAffiliateOwnership(a.info, expected) : null);
    if (rejectReason) {
      failedById.set(product.id, rejectReason);
      continue;
    }
    const linkFields = {
      affiliate_url: a.url,
      ml_item_id: a.info?.itemId ?? null,
      link_target_product_id: a.verified ? product.ml_product_id : null,
      link_checked_at: a.verified ? now : null,
    };
    const { error: saveError } = await admin.from('products').update(linkFields).eq('id', product.id);
    if (saveError) {
      failedById.set(product.id, saveError.message);
      continue;
    }
    saved.push({ ...product, ...linkFields });
    verifiedById.set(product.id, a.verified);
  }

  if (saved.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'guardar_link',
      target: `${saved.length} productos`,
      before: Object.fromEntries(saved.map((p) => [p.id, rows.get(p.id)?.affiliate_url ?? null])),
      after: Object.fromEntries(saved.map((p) => [p.id, p.affiliate_url])),
    });
  }

  const withParams = match.assigned.find(
    (a) => a.info?.mattWord && a.info?.mattTool && !failedById.has(a.targetId)
  );
  if (withParams) await rememberAffiliateParams(admin, withParams.info!.mattWord, withParams.info!.mattTool);

  const token = saved.length > 0 ? await getMlToken() : null;
  const outcomes = token ? await priceProducts(saved, token) : [];
  if (outcomes.length > 0) await applyPricing(admin, outcomes);
  if (saved.length > 0) refreshSite();
  const outcomeById = new Map(outcomes.map((o) => [o.id, o.result]));

  return {
    ok: true,
    items: products.map((p) => ({
      id: p.id,
      name: p.name,
      outcome: failedById.has(p.id)
        ? 'error'
        : verifiedById.has(p.id)
          ? (outcomeById.get(p.id) ?? 'pendiente')
          : 'sin_link',
      verified: verifiedById.get(p.id) ?? false,
      detail: failedById.get(p.id),
    })),
    wrongLinks: match.wrong,
    // El motivo va pegado al link: el panel muestra esta lista tal cual.
    unmatchedLinks: match.unmatched.map((url) => {
      const reason = match.rejected.find((r) => r.url === url)?.reason;
      return reason ? `${url} (${reason})` : url;
    }),
    linksFound: match.linksFound,
  };
}
