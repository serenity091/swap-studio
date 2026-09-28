import { imageSrc } from './images';
import type { ImageAsset } from './types';
export type CropBox = { x: number; y: number; width: number; height: number };
export function cropPixels(box: CropBox, width: number, height: number): CropBox {
  if (![box.x, box.y, box.width, box.height, width, height].every(Number.isFinite) || width < 1 || height < 1 || box.width <= 0 || box.height <= 0) throw new Error('Select a crop area first.');
  const x = Math.max(0, Math.min(width - 1, Math.floor(box.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(box.y * height)));
  const right = Math.max(x, Math.min(width, Math.ceil((box.x + box.width) * width - 1e-7)));
  const bottom = Math.max(y, Math.min(height, Math.ceil((box.y + box.height) * height - 1e-7)));
  if (right - x < 16 || bottom - y < 16) throw new Error('Select a larger area that includes the full detail.');
  return { x, y, width: right - x, height: bottom - y };
}
export async function cropImage(source: ImageAsset, box: CropBox, suffix: string): Promise<ImageAsset> {
  const image = new Image();
  image.src = imageSrc(source);
  await image.decode();
  const region = cropPixels(box, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = region.width; canvas.height = region.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image cropping is unavailable in this browser.');
  // Copy original pixels at 1:1 scale. No upscaling, sharpening, or generated detail.
  context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  const data = canvas.toDataURL('image/png').split(',')[1];
  if (data.length * .75 > 10 * 1024 * 1024) throw new Error('This crop is larger than 10 MB. Select a smaller area.');
  return { name: `${source.name.replace(/\.[^.]+$/, '').slice(0, 200)}-${suffix}.png`, mimeType: 'image/png', width: region.width, height: region.height, data };
}
