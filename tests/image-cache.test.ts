import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { getCachedImage, putCachedImage, removeCachedImage, pruneImageCache, IMAGE_CACHE_AGE_MS } from '../src/lib/image-cache';
const asset = (version: string, path = 'library/identity-0/front') => ({ path, version, name: 'model.jpg', mimeType: 'image/jpeg', width: 900, height: 1200 });
afterEach(() => vi.restoreAllMocks());
it('persists exact bytes across module reloads and separates users and replaced slots', async () => {
  const image = asset('persist');
  const blob = new Blob(['exact original bytes'], { type: 'image/jpeg' });
  await putCachedImage('alice', image, blob);
  vi.resetModules();
  const reloaded = await import('../src/lib/image-cache');
  expect(await (await reloaded.getCachedImage('alice', image))?.text()).toBe('exact original bytes');
  expect(await reloaded.getCachedImage('bob', image)).toBeUndefined();
  expect(await reloaded.getCachedImage('alice', asset('reused-slot'))).toBeUndefined();
});
it('expires old copies and purges images removed from the shared library', async () => {
  const kept = asset('kept'); const deleted = asset('deleted', 'library/swap-0/front');
  const blob = new Blob(['image'], { type: 'image/jpeg' });
  await putCachedImage('prune-user', kept, blob);
  await putCachedImage('prune-user', deleted, blob);
  await pruneImageCache('prune-user', [kept]);
  expect(await getCachedImage('prune-user', deleted)).toBeUndefined();
  expect(await getCachedImage('prune-user', kept)).toBeDefined();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + IMAGE_CACHE_AGE_MS + 1);
  expect(await getCachedImage('prune-user', kept)).toBeUndefined();
});
it('deletes copies of an image from every account on this browser', async () => {
  const image = asset('delete'); const blob = new Blob(['image']);
  await putCachedImage('alice', image, blob); await putCachedImage('bob', image, blob);
  await removeCachedImage(image);
  expect(await getCachedImage('alice', image)).toBeUndefined();
  expect(await getCachedImage('bob', image)).toBeUndefined();
});
it('evicts least recently used blobs at 200 MiB', async () => {
  const blob = new Blob([new Uint8Array(80 * 1024 * 1024)]);
  const first = asset('lru-first'); const second = asset('lru-second'); const third = asset('lru-third');
  const time = vi.spyOn(Date, 'now').mockReturnValue(1000);
  await putCachedImage('lru', first, blob);
  time.mockReturnValue(2000); await putCachedImage('lru', second, blob);
  time.mockReturnValue(3000); await getCachedImage('lru', first);
  time.mockReturnValue(4000); await putCachedImage('lru', third, blob);
  expect(await getCachedImage('lru', first)).toBeDefined();
  expect(await getCachedImage('lru', second)).toBeUndefined();
  expect(await getCachedImage('lru', third)).toBeDefined();
});
it('treats unavailable browser storage as a cache miss', async () => {
  vi.resetModules();
  vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('Storage blocked'); });
  const isolated = await import('../src/lib/image-cache');
  expect(await isolated.getCachedImage('alice', asset('disabled'))).toBeUndefined();
  await expect(isolated.putCachedImage('alice', asset('disabled'), new Blob(['image']))).resolves.toBeUndefined();
});
