// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/background', () => ({ removePhotoBackground: vi.fn() }));
import { removePhotoBackground } from '../src/lib/background';
import { BackgroundDialog } from '../src/components/BackgroundDialog';
const image = { name: 'original.png', mimeType: 'image/png', data: 'AA==', width: 100, height: 100 };
beforeEach(() => { vi.mocked(removePhotoBackground).mockReset(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });
afterEach(cleanup);
it('does not apply a failed removal and lets the user retry', async () => {
  vi.mocked(removePhotoBackground).mockRejectedValueOnce(new Error('Download failed')).mockResolvedValueOnce({ ...image, data: 'RESULT' });
  const save = vi.fn();
  render(<BackgroundDialog image={image} onSave={save} close={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Download failed');
  expect((screen.getByRole('button', { name: 'Use result' }) as HTMLButtonElement).disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('img', { name: 'Background removal preview' });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use result' }));
  expect(save).toHaveBeenCalledWith({ ...image, data: 'RESULT' });
});
it('aborts an in-progress removal when closed without applying any image', () => {
  vi.mocked(removePhotoBackground).mockImplementation(() => new Promise(() => {}));
  const save = vi.fn();
  const view = render(<BackgroundDialog image={image} onSave={save} close={vi.fn()} />);
  const signal = vi.mocked(removePhotoBackground).mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
