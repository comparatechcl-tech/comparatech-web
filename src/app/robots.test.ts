import { describe, expect, it } from 'vitest';
import robots from './robots';

/**
 * robots.txt: los robots que solo entrenan IA no entran; los buscadores y los
 * que buscan en vivo para ChatGPT, Perplexity y Claude siguen entrando igual.
 */
describe('robots.txt', () => {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const agents = (r: (typeof list)[number]) => (Array.isArray(r.userAgent) ? r.userAgent : [r.userAgent]);

  it('cierra todo el sitio a los robots que solo entrenan IA', () => {
    const training = list.find((r) => agents(r).includes('GPTBot'));
    expect(training).toBeDefined();
    expect(agents(training!)).toEqual(['GPTBot', 'ClaudeBot', 'CCBot', 'Bytespider', 'meta-externalagent']);
    expect(training!.disallow).toBe('/');
    expect(training!.allow).toBeUndefined();
  });

  it('no nombra a los que buscan en vivo ni a los buscadores (les vale la regla general)', () => {
    const named = list.flatMap(agents);
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User', 'Googlebot', 'Bingbot']) {
      expect(named).not.toContain(bot);
    }
  });

  it('la regla general sigue abierta, sin el admin ni la API', () => {
    const general = list.find((r) => agents(r).includes('*'));
    expect(general?.allow).toBe('/');
    expect(general?.disallow).toEqual(expect.arrayContaining(['/admin', '/admin/', '/api/']));
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
