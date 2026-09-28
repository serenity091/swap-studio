import { imageBlob, readImage, MAX_UPLOAD_BYTES } from './images';
import type { ImageAsset } from './types';
export async function removePhotoBackground(image: ImageAsset, progress: (message: string) => void, signal: AbortSignal): Promise<ImageAsset> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('Background removal needs a recent browser with image processing support. Try Chrome, Edge, or Safari.');
  const worker = new Worker(new URL('../workers/background.worker.ts', import.meta.url), { type: 'module' });
  const blob = await new Promise<Blob>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate(); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const cancel = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timeout = setTimeout(() => fail('Background removal took too long. Try a smaller crop. Your photo is unchanged.'), 240_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => fail('Background removal could not start. Reload and try again. Your photo is unchanged.');
    worker.onmessage = event => {
      if (event.data.type === 'progress') progress(event.data.message);
      else if (event.data.type === 'error') fail(event.data.message);
      else if (event.data.type === 'result') { cleanup(); resolve(event.data.blob); }
    };
    try { worker.postMessage(imageBlob(image)); } catch { fail('This photo could not be processed. Your photo is unchanged.'); }
  });
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The processed photo is larger than 10 MB. Crop the photo more tightly and try again. Your photo is unchanged.');
  const result = await readImage(blob);
  return { ...result, name: `${image.name.replace(/\.[^.]+$/, '').slice(0, 190)}-white-background.png` };
}
