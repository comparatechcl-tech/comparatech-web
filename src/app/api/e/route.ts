import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import {
  MAX_CLICKS_PER_DAY,
  MAX_CLICK_BODY_BYTES,
  isBotUserAgent,
  parseClickBody,
  startOfChileDay,
} from '@/lib/clicks';

/**
 * Registro de un clic hacia Mercado Libre (lo manda AffiliateButton con
 * navigator.sendBeacon). Siempre responde 204 y en silencio: el navegador
 * no espera la respuesta, y a quien prueba el endpoint a mano no le
 * contamos qué se descartó ni por qué.
 *
 * Qué NO se guarda: IP, user-agent, cookies ni la URL completa. Solo el
 * producto, desde dónde salió el clic, el tipo de link, el origen de la
 * visita y si era celular (ver /privacidad).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noContent() {
  return new Response(null, { status: 204 });
}

/**
 * Lee el cuerpo con tope de bytes sin cargarlo entero: req.text() a secas
 * dejaría que alguien mande megas y los tengamos en memoria.
 */
async function readLimited(req: NextRequest, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  if (!req.body) return '';

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(req: NextRequest) {
  try {
    if (isBotUserAgent(req.headers.get('user-agent') ?? '')) return noContent();

    // El beacon sale del mismo sitio. Si el navegador avisa que el pedido
    // viene de otro dominio, es alguien inflando la tabla desde afuera.
    // (Safari antiguo no manda la cabecera: en ese caso se acepta.)
    const fetchSite = req.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin') return noContent();

    const text = await readLimited(req, MAX_CLICK_BODY_BYTES);
    if (text === null) return noContent();

    const click = parseClickBody(text);
    if (!click) return noContent();

    const admin = getSupabaseAdmin();
    if (!admin) return noContent();

    const { count, error: countError } = await admin
      .from('outbound_clicks')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', startOfChileDay(new Date()).toISOString());
    // Sin la tabla (migración 0015 sin aplicar) no hay nada que hacer.
    if (countError) {
      if (!isMissingSchemaError(countError)) console.error('[api/e] conteo diario:', countError.message);
      return noContent();
    }
    if ((count ?? 0) >= MAX_CLICKS_PER_DAY) return noContent();

    const { error } = await admin.from('outbound_clicks').insert({
      product_id: click.productId,
      placement: click.placement,
      link_mode: click.linkMode,
      src: click.src,
      is_mobile: click.mobile,
    });
    // 23503: el producto ya no existe (id válido pero borrado). No es un
    // problema del sitio, así que no ensucia los logs.
    if (error && !isMissingSchemaError(error) && error.code !== '23503') {
      console.error('[api/e] insert:', error.message);
    }
  } catch (e) {
    console.error('[api/e]', e instanceof Error ? e.message : e);
  }
  return noContent();
}
