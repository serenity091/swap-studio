import { imageSrc } from './images';
import type { ImageAsset, Resolution } from './types';
// Nano Banana Pro's supported shapes. Dimensions below are its 1K presets.
const presets = [
  ['1:1', 1024, 1024], ['2:3', 848, 1264], ['3:2', 1264, 848],
  ['3:4', 896, 1200], ['4:3', 1200, 896], ['4:5', 928, 1152],
  ['5:4', 1152, 928], ['9:16', 768, 1376], ['16:9', 1376, 768], ['21:9', 1584, 672],
] as const;
export function swapOutputSettings(base: Pick<ImageAsset, 'width' | 'height'>) {
  if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) throw new Error('The identity image has invalid dimensions.');
  const ratio = base.width / base.height;
  const preset = [...presets].sort((a, b) => Math.abs(Math.log(ratio / (a[1] / a[2]))) - Math.abs(Math.log(ratio / (b[1] / b[2]))))[0];
  if (Math.abs(ratio / (preset[1] / preset[2]) - 1) > .02) throw new Error('This identity has an unsupported image shape. Use an identity with a standard portrait or landscape ratio.');
  const scale = Math.sqrt(base.width * base.height / (preset[1] * preset[2]));
  const resolution: Resolution = scale > 2.5 ? '4K' : scale > 1.25 ? '2K' : '1K';
  return { aspectRatio: preset[0], resolution };
}
export function assertSwapShape(image: Pick<ImageAsset, 'width' | 'height'>, base: Pick<ImageAsset, 'width' | 'height'>) {
  if (image.width <= 0 || image.height <= 0 || !Number.isFinite(image.width / image.height) || Math.abs((image.width / image.height) / (base.width / base.height) - 1) > .02) {
    throw new Error(`Google returned ${image.width} × ${image.height}, which does not match the identity's ${base.width} × ${base.height} framing. This result was not accepted or saved. Review it below before retrying; a retry is another paid request.`);
  }
}
export async function matchIdentityDimensions(image: ImageAsset, base: ImageAsset): Promise<ImageAsset> {
  assertSwapShape(image, base);
  if (image.width === base.width && image.height === base.height) return image;
  // Only near-matching shapes reach here. Never stretch a landscape failure into a portrait.
  const bitmap = new Image(); bitmap.src = imageSrc(image); await bitmap.decode();
  const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not match the identity image dimensions.');
  context.drawImage(bitmap, 0, 0, base.width, base.height);
  return { ...image, width: base.width, height: base.height, mimeType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
}
