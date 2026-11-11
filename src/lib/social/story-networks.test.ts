import { describe, expect, it } from 'vitest';
import { STORY_NETWORKS, STORY_NETWORK_LABELS, anyMarked, isStoryNetwork, storyMissingLine } from './story-networks';

describe('las redes de las historias', () => {
  it('son Instagram (que la pasa sola a Facebook) y TikTok; YouTube ya no tiene historias', () => {
    expect(STORY_NETWORKS).toEqual(['instagram', 'tiktok']);
    expect(STORY_NETWORK_LABELS.instagram).toBe('Instagram y Facebook');
    expect(isStoryNetwork('tiktok')).toBe(true);
    for (const other of ['facebook', 'youtube', 'telegram', '', null, undefined]) expect(isStoryNetwork(other)).toBe(false);
  });

  it('dice qué falta solo cuando hay alguna marcada y no todas', () => {
    expect(storyMissingLine({})).toBeNull();
    expect(storyMissingLine({ instagram: 1 })).toBe('Ya está en Instagram y Facebook. Falta: TikTok.');
    expect(storyMissingLine({ tiktok: 2 })).toBe('Ya está en TikTok. Falta: Instagram y Facebook.');
    expect(storyMissingLine({ instagram: 1, tiktok: 2 })).toBeNull();
  });

  it('anyMarked', () => {
    expect(anyMarked(undefined)).toBe(false);
    expect(anyMarked({})).toBe(false);
    expect(anyMarked({ tiktok: 3 })).toBe(true);
  });
});
