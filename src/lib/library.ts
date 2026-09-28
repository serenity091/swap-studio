import { collection, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBlob } from 'firebase/storage';
import { db, storage, isPreview } from './firebase';
import { getDimensions, imageBlob, readImage } from './images';
import { localGet, localSet } from './local';
import type { ImageAsset, SaveInput, StoredImage, StudioRecord } from './types';
const cache = new Map<string, Promise<ImageAsset>>();
const PREVIEW_EVENT = 'swap-preview-library';
export function clearImageCache() { cache.clear(); }
export function watchLibrary(onData: (records: StudioRecord[]) => void, onError: (error: Error) => void) {
  if (isPreview) {
    let active = true;
    const read = () => { void localGet<StudioRecord[]>('preview-records').then(data => { if (active) onData(data || []); }).catch(onError); };
    read(); window.addEventListener(PREVIEW_EVENT, read);
    return () => { active = false; window.removeEventListener(PREVIEW_EVENT, read); };
  }
  if (!db) { onError(new Error('Firebase is not configured.')); return () => {}; }
  return onSnapshot(query(collection(db, 'records'), orderBy('createdAt', 'desc')), snapshot => {
    onData(snapshot.docs.map(document => ({ ...document.data(), id: document.id } as StudioRecord)));
  }, () => onError(new Error('Could not load the shared library. Check your connection and Firebase rules.')));
}
export async function saveRecord(input: SaveInput): Promise<void> {
  if (!isPreview && (!storage || !db)) throw new Error('Firebase is not configured.');
  const assets: Record<string, StoredImage> = {};
  // Stable record IDs and paths make save retries idempotent, without charging for regeneration.
  for (const [slot, image] of Object.entries(input.assets)) {
    const path = `users/${input.ownerId}/${input.id}/${slot}`;
    const { data: _data, ...metadata } = image;
    if (isPreview) await localSet(`preview-image:${path}`, image);
    else await uploadBytes(ref(storage!, path), imageBlob(image), { contentType: image.mimeType });
    assets[slot] = { ...metadata, path };
    cache.set(path, Promise.resolve(image));
  }
  const record: StudioRecord = { ...input, assets };
  if (isPreview) {
    const records = await localGet<StudioRecord[]>('preview-records') || [];
    await localSet('preview-records', [record, ...records.filter(r => r.id !== record.id)]);
    window.dispatchEvent(new Event(PREVIEW_EVENT));
  } else await setDoc(doc(db!, 'records', input.id), record);
}
export function loadImage(image: StoredImage): Promise<ImageAsset> {
  let pending = cache.get(image.path);
  if (!pending) {
    pending = (async () => {
      if (isPreview) {
        const result = await localGet<ImageAsset>(`preview-image:${image.path}`);
        if (!result) throw new Error('This preview image is no longer stored in this browser.');
        return result;
      }
      if (!storage) throw new Error('Firebase is not configured.');
      // Authenticated blob requests honor Storage rules; no public download-token URLs are stored.
      const blob = await getBlob(ref(storage, image.path), 30 * 1024 * 1024);
      // Firebase's size-limited getBlob uses Blob.slice(), which drops the MIME type.
      const typedBlob = blob.type ? blob : blob.slice(0, blob.size, image.mimeType);
      return { ...await readStoredBlob(typedBlob), name: image.name };
    })();
    cache.set(image.path, pending);
    pending.catch(() => cache.delete(image.path));
  }
  return pending;
}
async function readStoredBlob(blob: Blob): Promise<ImageAsset> {
  // Generated 4K files may exceed the 10 MB limit that applies only to uploads.
  if (blob.size <= 10 * 1024 * 1024) return readImage(blob);
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
  return { name: 'saved-image', mimeType: blob.type, data: dataUrl.split(',')[1], ...await getDimensions(dataUrl) };
}
