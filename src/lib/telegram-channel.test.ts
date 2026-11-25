import { describe, expect, it, vi } from 'vitest';
import { isChannelName, messageText, parseChannelPreview, readChannel } from './telegram-channel';
import { parseDealNotice } from './social/deal-notice';

/*
 * La página pública de un canal, con la forma que tiene de verdad (leída el
 * 25-11-2026 de t.me/s/telegram): cada aviso es un bloque con data-post, su
 * texto y su hora. El contenido es el de un aviso del canal de afiliados.
 */

const emoji = (char: string) =>
  `<i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/F09F8EA7.png')"><b>${char}</b></i>`;
const link = (url: string) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;

function message(channel: string, id: number, datetime: string, body: string | null): string {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${channel}/${id}" data-view="abc">
<div class="tgme_widget_message_user"><a href="https://t.me/${channel}"><i class="tgme_widget_message_user_photo"></i></a></div>
<div class="tgme_widget_message_bubble">
<div class="tgme_widget_message_author accent_color"><a class="tgme_widget_message_owner_name" href="https://t.me/${channel}"><span dir="auto">Afiliados y Creadores</span></a></div>
${body === null ? '' : `<div class="tgme_widget_message_text js-message_text" dir="auto">${body}</div>`}
<div class="tgme_widget_message_footer compact js-message_footer"><div class="tgme_widget_message_info short js-message_info">
<span class="tgme_widget_message_views">7</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/${channel}/${id}"><time datetime="${datetime}" class="time">18:01</time></a></span>
</div></div></div></div></div>`;
}

const DEALS_BODY = [
  `Ojo con esta selección de <b>tecnología y gaming</b> que la gente busca todo el año ${emoji('🎮')}${emoji('📱')} ${emoji('👇')}`,
  '',
  `${emoji('🎧')} <b>Auriculares inalámbricos Pulse Elite Sony</b>`,
  `${emoji('💰')} Precio: <b>$109.990</b>`,
  `${emoji('👉')} ${link('https://tinyurl.com/3vvdnnpn')}`,
  '',
  `${emoji('🎮')} <b>Consola PlayStation 5 Digital Slim</b>`,
  `${emoji('💰')} Precio: <b>$709.990</b>`,
  `${emoji('👉')} ${link('https://tinyurl.com/yc8hrkdp')}`,
  '',
  `${emoji('💡')} TIP DE AFILIADO: Cuando compartas productos de ticket alto, destaca la seguridad de comprar en distribuidores autorizados. M&amp;M &#39;ok&#39;`,
].join('<br/>');

const PAGE = `<!DOCTYPE html><html><body><main><section class="tgme_channel_history js-message_history">
${message('canalafiliados', 120, '2026-11-25T15:30:00+00:00', `Recuerda revisar tus ganancias en <a href="https://t.me/canalafiliados/100" target="_blank">este aviso</a> y en <a href="?q=%23tips">#tips</a>.`)}
${message('canalafiliados', 121, '2026-11-25T18:00:00+00:00', null)}
${message('otrocanal', 77, '2026-11-25T19:00:00+00:00', 'Aviso reenviado de otro canal')}
${message('CanalAfiliados', 122, '2026-11-25T21:01:13+00:00', DEALS_BODY)}
</section></main></body></html>`;

describe('messageText', () => {
  it('deja saltos de línea, escribe los links de afuera enteros y quita el formato', () => {
    expect(messageText(`Hola <b>mundo</b><br/>${link('https://tinyurl.com/abc123')}<br><i>fin</i> &amp; listo&nbsp;ya`)).toBe(
      'Hola mundo\nhttps://tinyurl.com/abc123\nfin & listo ya'
    );
  });

  it('un link con otro texto se escribe como su dirección; los de Telegram se quedan con su texto', () => {
    expect(messageText('<a href="https://tinyurl.com/abc123?x=1&amp;y=2">ver oferta</a>')).toBe('https://tinyurl.com/abc123?x=1&y=2');
    expect(messageText('<a href="https://t.me/canal/5">el aviso anterior</a> y <a href="?q=%23tips">#tips</a>')).toBe(
      'el aviso anterior y #tips'
    );
  });
});

describe('parseChannelPreview', () => {
  it('lee los avisos con texto del canal pedido, del más antiguo al más nuevo', () => {
    const posts = parseChannelPreview(PAGE, 'canalafiliados');
    expect(posts.map((p) => p.id)).toEqual([120, 122]);
    expect(posts[0]).toEqual({
      id: 120,
      postedAt: '2026-11-25T15:30:00.000Z',
      text: 'Recuerda revisar tus ganancias en este aviso y en #tips.',
    });
    expect(posts[1].postedAt).toBe('2026-11-25T21:01:13.000Z');
    expect(posts[1].text.split('\n').slice(2, 5)).toEqual([
      '🎧 Auriculares inalámbricos Pulse Elite Sony',
      '💰 Precio: $109.990',
      '👉 https://tinyurl.com/3vvdnnpn',
    ]);
    expect(posts[1].text).toContain("M&M 'ok'");
  });

  it('el texto que sale se lee igual que un aviso pegado a mano', () => {
    const [, deals] = parseChannelPreview(PAGE, 'canalafiliados');
    const parsed = parseDealNotice(deals.text);
    expect(parsed.deals.map((d) => [d.name, d.price, d.link, d.conditional])).toEqual([
      ['Auriculares inalámbricos Pulse Elite Sony', 109_990, 'https://tinyurl.com/3vvdnnpn', false],
      ['Consola PlayStation 5 Digital Slim', 709_990, 'https://tinyurl.com/yc8hrkdp', false],
    ]);
  });

  it('una página sin avisos, o cualquier otra cosa, da una lista vacía', () => {
    expect(parseChannelPreview('<html><body>Canal sin publicaciones</body></html>', 'canalafiliados')).toEqual([]);
    expect(parseChannelPreview('', 'canalafiliados')).toEqual([]);
    expect(parseChannelPreview(PAGE, 'nadie_mas')).toEqual([]);
  });
});

describe('readChannel', () => {
  it('pide la vista pública del canal y devuelve sus avisos', async () => {
    const fetchImpl = vi.fn(async () => new Response(PAGE, { status: 200 }));
    const read = await readChannel('canalafiliados', fetchImpl);
    expect(read.status).toBe('ok');
    if (read.status === 'ok') expect(read.posts).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://t.me/s/canalafiliados');
    expect(init.redirect).toBe('manual');
  });

  it('un canal sin vista pública redirige: no hay nada que leer', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://t.me/canalprivado' } }));
    await expect(readChannel('canalprivado', fetchImpl)).resolves.toEqual({ status: 'sin_vista_publica' });
  });

  it('nunca lanza: un nombre raro, un error de Telegram o de red quedan como error', async () => {
    const never = vi.fn(async () => new Response('x', { status: 200 }));
    await expect(readChannel('../../otra-cosa', never)).resolves.toMatchObject({ status: 'error' });
    expect(never).not.toHaveBeenCalled();
    await expect(readChannel('canalafiliados', async () => new Response('caído', { status: 500 }))).resolves.toEqual({
      status: 'error',
      reason: 'Telegram respondió 500',
    });
    await expect(
      readChannel('canalafiliados', async () => {
        throw new Error('timeout');
      })
    ).resolves.toEqual({ status: 'error', reason: 'timeout' });
  });

  it('isChannelName acepta solo nombres públicos de Telegram', () => {
    expect(isChannelName('afiliados_ml')).toBe(true);
    expect(isChannelName('abc')).toBe(false);
    expect(isChannelName('+AbCdEf123')).toBe(false);
    expect(isChannelName(null)).toBe(false);
  });
});
