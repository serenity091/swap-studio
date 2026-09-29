// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/library', () => ({ loadImage: vi.fn(), loadThumbnail: vi.fn() }));
import { loadImage, loadThumbnail } from '../src/lib/library';
import { StoredThumbnail } from '../src/components/Images';
const preview = { name: 'preview', mimeType: 'image/jpeg', data: 'AA==', width: 360, height: 480 };
const original = { ...preview, name: 'original', data: 'AQ==', width: 1800, height: 2400 };
const asset = { ...original, path: 'library/swap-0/front', version: 'a' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadThumbnail).mockResolvedValue(preview);
  vi.mocked(loadImage).mockResolvedValue(original);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); } disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('browses with a preview, then opens the original, never the thumbnail', async () => {
  const onOpen = vi.fn();
  render(<StoredThumbnail asset={asset} label="Saved swap" onOpen={onOpen} />);
  const button = await screen.findByRole('button', { name: 'View Saved swap' });
  expect(loadImage).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(original));
  expect(loadImage).toHaveBeenCalledWith(asset);
});
it('selects an identity without downloading an original', async () => {
  const onSelect = vi.fn();
  render(<StoredThumbnail asset={asset} label="Model" onSelect={onSelect} actionLabel="Select Model" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Select Model' }));
  expect(onSelect).toHaveBeenCalledOnce(); expect(loadImage).not.toHaveBeenCalled();
});
it('keeps the preview and allows retry after an original download fails', async () => {
  vi.mocked(loadImage).mockRejectedValueOnce(new Error('Offline'));
  const onOpen = vi.fn();
  render(<StoredThumbnail asset={asset} label="Swap" onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Swap' }));
  await screen.findByRole('alert');
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View Swap' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(original));
});
