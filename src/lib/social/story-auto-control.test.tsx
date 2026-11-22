import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/admin/historias/auto-actions', () => ({ setStoryAutoPause: vi.fn() }));

import { StoryAutoControl } from '@/app/admin/historias/StoryAutoControl';

/** El control de la historia automática en /admin/historias, dibujado en cada estado. */
describe('StoryAutoControl', () => {
  it('encendida: dice cuándo sale y ofrece pausar', () => {
    const html = renderToStaticMarkup(<StoryAutoControl status={{ pause: 'activa', today: null }} />);
    expect(html).toContain('Sale sola a las 12:40');
    expect(html).toContain('Pausar hoy');
    expect(html).toContain('Pausar hasta encenderla');
    expect(html).not.toContain('>Encender<');
  });

  it('en pausa: lo dice y ofrece encender', () => {
    const today = renderToStaticMarkup(<StoryAutoControl status={{ pause: 'hoy', today: null }} />);
    expect(today).toContain('En pausa por hoy. Mañana vuelve sola.');
    expect(today).toContain('>Encender<');
    const always = renderToStaticMarkup(<StoryAutoControl status={{ pause: 'indefinida', today: null }} />);
    expect(always).toContain('En pausa hasta que la enciendas.');
    expect(always).not.toContain('Pausar hoy');
  });

  it('dice qué pasó hoy, y pide mirar la cuenta si Instagram no respondió', () => {
    const done = renderToStaticMarkup(
      <StoryAutoControl status={{ pause: 'activa', today: { name: 'Moto G86', status: 'publicado', permalink: null } }} />
    );
    expect(done).toContain('Hoy salió: Moto G86.');
    const failed = renderToStaticMarkup(<StoryAutoControl status={{ pause: 'activa', today: { name: 'x', status: 'error', permalink: null } }} />);
    expect(failed).toContain('Se intenta de nuevo a las 15:40');
    const unsure = renderToStaticMarkup(<StoryAutoControl status={{ pause: 'activa', today: { name: 'x', status: 'incierto', permalink: null } }} />);
    expect(unsure).toContain('Mira la cuenta antes de subir otra');
  });
});
