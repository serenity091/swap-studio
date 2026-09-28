import type { ImageAsset } from './types';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const imageSrc = (image: ImageAsset) => `data:${image.mimeType};base64,${image.data}`;
export async function readImage(file: Blob & { name?: string }): Promise<ImageAsset> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new Error('Each reference must be smaller than 10 MB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('This image could not be read. Please choose it again.'));
    reader.readAsDataURL(file);
  });
  const dimensions = await getDimensions(dataUrl);
  // Keep the uploaded pixels intact; large combined API payloads are checked before sending.
  return { name: file.name || 'image', mimeType: file.type, data: dataUrl.split(',')[1], ...dimensions };
}
export function getDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image file could not be decoded.'));
    image.src = src;
  });
}
export function imageBlob(image: ImageAsset): Blob {
  const binary = atob(image.data);
  return new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], { type: image.mimeType });
}
export function downloadImage(image: ImageAsset, name: string) {
  const url = URL.createObjectURL(imageBlob(image));
  const a = document.createElement('a');
  a.href = url;
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
  a.download = `${name.replace(/[^a-z0-9_-]/gi, '-')}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
