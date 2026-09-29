import { imageSrc, readImage } from './images';
import { MAX_THUMBNAIL_BYTES } from './limits';
import type { ImageAsset } from './types';

export async function createThumbnail(image: ImageAsset): Promise<ImageAsset> {
  const source = new Image();
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new Error('Could not prepare the library preview. Please retry saving.'));
    source.src = imageSrc(image);
  });
  const scale = Math.min(1, 480 / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the library preview. Please retry saving.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.4]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_THUMBNAIL_BYTES) return { ...await readImage(blob), name: `${image.name.slice(0, 240)}-preview.jpg` };
  }
  throw new Error('Could not fit the library preview within its size limit. Please retry saving.');
}
