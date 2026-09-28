import { expect, it } from 'vitest';
import { cropPixels } from '../src/lib/crop';
it('crops in original-image pixels and clips selection to its bounds', () => {
  expect(cropPixels({ x: .4, y: .5, width: .2, height: .1 }, 1000, 1500)).toEqual({ x: 400, y: 750, width: 200, height: 150 });
  expect(cropPixels({ x: .9, y: .9, width: .3, height: .3 }, 1000, 1500)).toEqual({ x: 900, y: 1350, width: 100, height: 150 });
  expect(() => cropPixels({ x: 0, y: 0, width: 0, height: 0 }, 1000, 1500)).toThrow();
  expect(() => cropPixels({ x: 0, y: 0, width: .001, height: .001 }, 1000, 1500)).toThrow();
});
