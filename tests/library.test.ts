// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: { uid: 'alice' } }, storage: {}, db: {}, isPreview: false }));
vi.mock('firebase/storage', () => ({ ref: vi.fn((_storage, path) => ({ path })), uploadBytes: vi.fn(), getBlob: vi.fn(), deleteObject: vi.fn() }));
vi.mock('../src/lib/images', () => ({
  readImage: vi.fn(async (blob: Blob) => {
    if (blob.type !== 'image/jpeg') throw new Error('Choose a JPG, PNG, or WebP image.');
    return { name: 'image', mimeType: blob.type, data: 'AA==', width: 896, height: 1194 };
  }), getDimensions: vi.fn(), imageBlob: vi.fn(),
}));
vi.mock('../src/lib/image-cache', () => {
  const images = new Map<string, Blob>();
  const key = (uid: string, image: { path: string; version?: string }) => JSON.stringify([uid, image.path, image.version || '']);
  return { imageCacheKey: key, getCachedImage: vi.fn(async (uid, image) => images.get(key(uid, image))), putCachedImage: vi.fn(async (uid, image, blob) => { images.set(key(uid, image), blob); }), removeCachedImage: vi.fn(), pruneImageCache: vi.fn() };
});
import { auth } from '../src/lib/firebase';
import { getBlob } from 'firebase/storage';
import { readImage } from '../src/lib/images';
import { clearImageCache, loadImage, loadThumbnail } from '../src/lib/library';
beforeEach(() => { clearImageCache(); vi.clearAllMocks(); Object.assign(auth!, { currentUser: { uid: 'alice' } }); });
it('restores the stored MIME type after Firebase slices a downloaded blob', async () => {
  const downloaded = new Blob(['image bytes'], { type: 'image/jpeg' }).slice(0, 30 * 1024 * 1024);
  expect(downloaded.type).toBe('');
  vi.mocked(getBlob).mockResolvedValue(downloaded);
  const result = await loadImage({ path: 'users/studio-import/imported-identity-1/front', name: '1.jpg', mimeType: 'image/jpeg', width: 896, height: 1194 });
  expect(result.name).toBe('1.jpg');
  expect(result.mimeType).toBe('image/jpeg');
  expect(vi.mocked(readImage).mock.calls[0][0].type).toBe('image/jpeg');
});

it('reuses a downloaded image after a memory reset but never across accounts or slot versions', async () => {
  const asset = { path: 'library/identity-0/front', version: 'first', name: 'original.jpg', mimeType: 'image/jpeg', width: 896, height: 1194 };
  vi.mocked(getBlob).mockResolvedValue(new Blob(['original'], { type: 'image/jpeg' }));
  await loadImage(asset);
  clearImageCache();
  await loadImage(asset);
  expect(getBlob).toHaveBeenCalledTimes(1);
  Object.assign(auth!, { currentUser: { uid: 'bob' } });
  clearImageCache();
  await loadImage(asset);
  expect(getBlob).toHaveBeenCalledTimes(2);
  await loadImage({ ...asset, version: 'replacement' });
  expect(getBlob).toHaveBeenCalledTimes(3);
  Object.assign(auth!, { currentUser: null });
  await expect(loadImage(asset)).rejects.toThrow('Sign in');
  expect(getBlob).toHaveBeenCalledTimes(3);
});
it('downloads only the thumbnail for previews and fetches the original separately', async () => {
  const thumbnail = { path: 'library/swap-2/front-thumb', version: 'swap', name: 'preview.jpg', mimeType: 'image/jpeg', width: 360, height: 480 };
  const asset = { ...thumbnail, path: 'library/swap-2/front', width: 1800, height: 2400, thumbnail };
  vi.mocked(getBlob).mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
  await loadThumbnail(asset);
  expect(getBlob).toHaveBeenCalledTimes(1);
  expect(getBlob).toHaveBeenLastCalledWith({ path: thumbnail.path }, expect.any(Number));
  await loadImage(asset);
  expect(getBlob).toHaveBeenCalledTimes(2);
  expect(getBlob).toHaveBeenLastCalledWith({ path: asset.path }, expect.any(Number));
});
it('discards a download that finishes after sign-out', async () => {
  const asset = { path: 'library/swap-3/back', version: 'swap', name: 'back.jpg', mimeType: 'image/jpeg', width: 900, height: 1200 };
  vi.mocked(getBlob).mockImplementationOnce(async () => {
    Object.assign(auth!, { currentUser: null });
    return new Blob(['image'], { type: 'image/jpeg' });
  });
  await expect(loadImage(asset)).rejects.toThrow('no longer available');
});
