// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
vi.mock('../src/lib/firebase', () => ({ storage: {}, db: {}, isPreview: false }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(() => ({})), uploadBytes: vi.fn(), getBlob: vi.fn() }));
vi.mock('../src/lib/images', () => ({
  readImage: vi.fn(async (blob: Blob) => {
    if (blob.type !== 'image/jpeg') throw new Error('Choose a JPG, PNG, or WebP image.');
    return { name: 'image', mimeType: blob.type, data: 'AA==', width: 896, height: 1194 };
  }), getDimensions: vi.fn(), imageBlob: vi.fn(),
}));
import { getBlob } from 'firebase/storage';
import { readImage } from '../src/lib/images';
import { loadImage } from '../src/lib/library';
it('restores the stored MIME type after Firebase slices a downloaded blob', async () => {
  const downloaded = new Blob(['image bytes'], { type: 'image/jpeg' }).slice(0, 30 * 1024 * 1024);
  expect(downloaded.type).toBe('');
  vi.mocked(getBlob).mockResolvedValue(downloaded);
  const result = await loadImage({ path: 'users/studio-import/imported-identity-1/front', name: '1.jpg', mimeType: 'image/jpeg', width: 896, height: 1194 });
  expect(result.name).toBe('1.jpg');
  expect(result.mimeType).toBe('image/jpeg');
  expect(vi.mocked(readImage).mock.calls[0][0].type).toBe('image/jpeg');
});
