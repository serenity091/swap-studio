import { expect, it } from 'vitest';
import { assertSwapShape, swapOutputSettings, matchIdentityDimensions } from '../src/lib/swap-sizing';
it('locks shape and generation resolution to each identity image, not the clasp', () => {
  expect(swapOutputSettings({ width: 1792, height: 2390 })).toEqual({ aspectRatio: '3:4', resolution: '2K' });
  expect(swapOutputSettings({ width: 896, height: 1194 })).toEqual({ aspectRatio: '3:4', resolution: '1K' });
  expect(swapOutputSettings({ width: 3584, height: 4800 })).toEqual({ aspectRatio: '3:4', resolution: '4K' });
});
it('rejects the reported landscape failure, tolerates preset rounding, and preserves exact matches', async () => {
  const base = { name: 'base', mimeType: 'image/png', data: 'pixels', width: 1792, height: 2390 };
  expect(() => assertSwapShape({ width: 2816, height: 1536 }, base)).toThrow('not accepted');
  expect(() => assertSwapShape({ width: 2494, height: 1696 }, base)).toThrow('not accepted');
  expect(() => assertSwapShape({ width: 1792, height: 2400 }, base)).not.toThrow();
  expect(await matchIdentityDimensions(base, base)).toBe(base);
});
