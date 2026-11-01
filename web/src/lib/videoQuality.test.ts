import { describe, expect, it } from 'vitest';
import { available, urlFor } from './videoQuality';

describe('video quality', () => {
  const link = { url: 'orig', expiresIn: 1, variants: { '720': 'v720', '480': 'v480' } };
  it('offers only the sizes that exist', () => {
    expect(available(link)).toEqual(['original', '720', '480']);
    expect(available({ url: 'orig', expiresIn: 1 })).toEqual(['original']);
    expect(available(null)).toEqual([]);
  });
  it('falls back to the original while a size is not made yet', () => {
    expect(urlFor(link, '480')).toEqual({ url: 'v480', quality: '480' });
    expect(urlFor({ url: 'orig', expiresIn: 1, variants: {} }, '720')).toEqual({ url: 'orig', quality: 'original' });
  });
});
