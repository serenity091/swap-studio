import { collection, doc, getDocs, onSnapshot, orderBy, query, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getBlob, deleteObject } from 'firebase/storage';
import { auth, db, storage, isPreview } from './firebase';
import { getDimensions, imageBlob, readImage } from './images';
import { localGet, localSet, localDelete } from './local';
import type { ImageAsset, SaveInput, StoredImage, StudioRecord } from './types';
import { LIBRARY_LIMITS, MAX_IMAGE_BYTES, fullMessage } from './limits';
import { getCachedImage, imageCacheKey, pruneImageCache, putCachedImage, removeCachedImage } from './image-cache';
import { createThumbnail } from './thumbnail';
const cacheKey = (image: StoredImage) => imageCacheKey(isPreview ? 'preview' : auth?.currentUser?.uid || '', image);
const cache = new Map<string, Promise<ImageAsset>>();
let validImages: Set<string> | undefined;
const recordImages = (record: StudioRecord) => Object.values(record.assets).flatMap(image => image.thumbnail ? [image, image.thumbnail] : [image]);
const PREVIEW_EVENT = 'swap-preview-library';
export function clearImageCache() { cache.clear(); validImages = undefined; }
export function watchLibrary(onData: (records: StudioRecord[]) => void, onError: (error: Error) => void) {
  if (isPreview) {
    let active = true;
    const read = () => { void localGet<StudioRecord[]>('preview-records').then(data => { if (active) onData(data || []); }).catch(onError); };
    read(); window.addEventListener(PREVIEW_EVENT, read);
    return () => { active = false; window.removeEventListener(PREVIEW_EVENT, read); };
  }
  if (!db) { onError(new Error('Firebase is not configured.')); return () => {}; }
  const uid = auth?.currentUser?.uid;
  return onSnapshot(query(collection(db, 'records'), orderBy('createdAt', 'desc')), { includeMetadataChanges: true }, snapshot => {
    const records = snapshot.docs.map(document => ({ ...document.data(), id: document.id } as StudioRecord));
    if (uid && auth?.currentUser?.uid === uid && !snapshot.metadata.fromCache) {
      const images = records.filter(record => record.state !== 'deleting').flatMap(recordImages);
      validImages = new Set(images.map(cacheKey));
      for (const key of cache.keys()) if (!validImages.has(key)) cache.delete(key);
      void pruneImageCache(uid, images);
    }
    onData(records);
  }, () => onError(new Error('Could not load the shared library. Check your connection and Firebase rules.')));
}
function notifyPreview() { window.dispatchEvent(new Event(PREVIEW_EVENT)); }
function plannedRecord(input: SaveInput, slot: string, thumbnails: Record<string, ImageAsset> = {}): StudioRecord {
  const assets: Record<string, StoredImage> = {};
  for (const view of ['front', 'back'] as const) {
    const image = input.assets[view];
    if (!image) throw new Error('Both final images are required.');
    const { data: _data, ...metadata } = image;
    const bytes = imageBlob(image).size;
    if (!bytes || bytes > MAX_IMAGE_BYTES) throw new Error(`The ${view} image exceeds the 16 MiB storage limit. Download this result to keep it. No images were uploaded.`);
    assets[view] = { ...metadata, path: `library/${slot}/${view}`, version: input.id, bytes };
    const thumbnail = thumbnails[view];
    if (thumbnail) {
      const { data: _previewData, ...previewMetadata } = thumbnail;
      assets[view].thumbnail = { ...previewMetadata, path: `library/${slot}/${view}-thumb`, version: input.id, bytes: imageBlob(thumbnail).size };
    }
  }
  return { ...input, assets, slot, state: 'saving' };
}
export async function checkCapacity(kind: StudioRecord['kind'], id: string) {
  const records = isPreview ? await localGet<StudioRecord[]>('preview-records') || []
    : (await getDocs(collection(db!, 'records'))).docs.map(d => d.data() as StudioRecord);
  if (!records.some(r => r.id === id) && records.filter(r => r.kind === kind).length >= LIBRARY_LIMITS[kind]) throw new Error(fullMessage(kind));
}
async function reserveRecord(input: SaveInput, thumbnails: Record<string, ImageAsset>): Promise<StudioRecord> {
  // Validate bytes before reserving anything. Fixed physical slots bound even partial uploads.
  plannedRecord(input, `${input.kind}-0`, thumbnails);
  if (isPreview) {
    const records = await localGet<StudioRecord[]>('preview-records') || [];
    const existing = records.find(r => r.id === input.id);
    if (existing) return existing;
    const slot = Array.from({ length: LIBRARY_LIMITS[input.kind] }, (_, i) => `${input.kind}-${i}`).find(s => !records.some(r => r.slot === s));
    if (!slot) throw new Error(fullMessage(input.kind));
    const record = plannedRecord(input, slot, thumbnails);
    await localSet('preview-records', [record, ...records]); notifyPreview();
    return record;
  }
  const occupied = await getDocs(collection(db!, 'librarySlots'));
  const used = new Set(occupied.docs.map(d => d.id));
  const existingSlot = occupied.docs.find(d => d.data().recordId === input.id)?.id;
  const candidates = existingSlot ? [existingSlot] : Array.from({ length: LIBRARY_LIMITS[input.kind] }, (_, i) => `${input.kind}-${i}`).filter(s => !used.has(s));
  for (const slot of candidates) {
    const result = await runTransaction(db!, async tx => {
      const recordRef = doc(db!, 'records', input.id);
      const slotRef = doc(db!, 'librarySlots', slot);
      const [existing, reserved] = await Promise.all([tx.get(recordRef), tx.get(slotRef)]);
      if (existing.exists()) {
        const record = existing.data() as StudioRecord;
        if (record.ownerId !== input.ownerId || record.state === 'deleting') throw new Error('This item cannot be saved. Start a new draft or finish deleting it.');
        return record;
      }
      if (reserved.exists()) return undefined; // Another device won this slot; try the next.
      const record = plannedRecord(input, slot, thumbnails);
      tx.set(slotRef, { recordId: input.id, ownerId: input.ownerId, kind: input.kind });
      tx.set(recordRef, record);
      return record;
    });
    if (result) return result;
  }
  throw new Error(fullMessage(input.kind));
}
export async function saveRecord(input: SaveInput): Promise<void> {
  if (!isPreview && (!storage || !db)) throw new Error('Firebase is not configured.');
  plannedRecord(input, `${input.kind}-0`); // Reject oversized originals before preparing previews.
  const thumbnails: Record<string, ImageAsset> = isPreview ? {} : {
    front: await createThumbnail(input.assets.front), back: await createThumbnail(input.assets.back),
  };
  const record = await reserveRecord(input, thumbnails);
  if (record.state === 'ready') return;
  // A failed save remains visible as an unfinished item. Retrying uses the same slot.
  for (const view of ['front', 'back'] as const) {
    const image = input.assets[view];
    const stored = record.assets[view];
    if (stored.bytes !== imageBlob(image).size || stored.width !== image.width || stored.height !== image.height || stored.mimeType !== image.mimeType) throw new Error('This draft changed after its save started. Delete the unfinished library item, then save again.');
    if (isPreview) await localSet(`preview-image:${stored.path}`, image);
    else {
      await uploadBytes(ref(storage!, stored.path), imageBlob(image), { contentType: image.mimeType, cacheControl: 'private, no-store', customMetadata: { recordId: record.id } });
      if (stored.thumbnail) {
        const thumbnail = thumbnails[view];
        if (imageBlob(thumbnail).size !== stored.thumbnail.bytes) throw new Error('This preview changed after saving started. Delete the unfinished item and save again.');
        await uploadBytes(ref(storage!, stored.thumbnail.path), imageBlob(thumbnail), { contentType: thumbnail.mimeType, cacheControl: 'private, no-store', customMetadata: { recordId: record.id } });
        cache.set(cacheKey(stored.thumbnail), Promise.resolve(thumbnail));
        await putCachedImage(input.ownerId, stored.thumbnail, imageBlob(thumbnail));
      }
      await putCachedImage(input.ownerId, stored, imageBlob(image));
    }
    cache.set(cacheKey(stored), Promise.resolve(image));
  }
  if (isPreview) {
    const records = await localGet<StudioRecord[]>('preview-records') || [];
    await localSet('preview-records', records.map(r => r.id === record.id ? { ...r, state: 'ready' } : r)); notifyPreview();
  } else await runTransaction(db!, async tx => {
    const recordRef = doc(db!, 'records', record.id);
    const current = await tx.get(recordRef);
    if (!current.exists() || current.data().state === 'deleting') throw new Error('This item was deleted while saving.');
    tx.update(recordRef, { state: 'ready' });
  });
}
export async function deleteRecord(record: StudioRecord, uid: string): Promise<void> {
  if (record.ownerId !== uid) throw new Error('Only the creator can delete this item.');
  if (!isPreview) {
    if (!db || !storage) throw new Error('Firebase is not configured.');
    // Keep the slot occupied and deny new uploads until all objects have been removed.
    await runTransaction(db, async tx => {
      const recordRef = doc(db!, 'records', record.id);
      const current = await tx.get(recordRef);
      if (current.exists()) tx.update(recordRef, { state: 'deleting' });
    });
  }
  const deletionImages = recordImages(record);
  if (record.slot && !isPreview) for (const view of ['front', 'back']) {
    if (!record.assets[view].thumbnail) deletionImages.push({ ...record.assets[view], path: `library/${record.slot}/${view}-thumb` });
  }
  for (const image of deletionImages) {
    if (isPreview) await localDelete(`preview-image:${image.path}`);
    else try { await deleteObject(ref(storage!, image.path)); }
    catch (error) { if ((error as { code?: string }).code !== 'storage/object-not-found') throw new Error('Deletion was interrupted. Click Delete again to finish removing the images and free the space.'); }
    cache.delete(cacheKey(image));
    if (!isPreview) await removeCachedImage(image);
  }
  if (isPreview) {
    const records = await localGet<StudioRecord[]>('preview-records') || [];
    await localSet('preview-records', records.filter(r => r.id !== record.id)); notifyPreview();
  } else await runTransaction(db!, async tx => {
    const recordRef = doc(db!, 'records', record.id);
    const current = await tx.get(recordRef);
    if (!current.exists()) return;
    const slot = current.data().slot as string;
    tx.delete(recordRef);
    tx.delete(doc(db!, 'librarySlots', slot));
  });
}
export function loadImage(image: StoredImage): Promise<ImageAsset> {
  const uid = auth?.currentUser?.uid;
  if (!isPreview && !uid) return Promise.reject(new Error('Sign in to view library images.'));
  const key = cacheKey(image);
  const stillAllowed = () => auth?.currentUser?.uid === uid && (!validImages || validImages.has(key));
  if (!isPreview && !stillAllowed()) return Promise.reject(new Error('This library image has been removed.'));
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      if (isPreview) {
        const result = await localGet<ImageAsset>(`preview-image:${image.path}`);
        if (!result) throw new Error('This preview image is no longer stored in this browser.');
        return result;
      }
      if (!storage) throw new Error('Firebase is not configured.');
      // Authenticated blob requests honor Storage rules; no public download-token URLs are stored.
      const cached = await getCachedImage(uid!, image);
      if (!stillAllowed()) throw new Error('This image is no longer available in this session.');
      if (cached) {
        try {
          const result = { ...await readStoredBlob(cached), name: image.name };
          if (!stillAllowed()) throw new Error('This image is no longer available in this session.');
          return result;
        } catch {
          await removeCachedImage(image);
          if (!stillAllowed()) throw new Error('This image is no longer available in this session.');
        }
      }
      const blob = await getBlob(ref(storage, image.path), 30 * 1024 * 1024);
      // Firebase's size-limited getBlob uses Blob.slice(), which drops the MIME type.
      const typedBlob = blob.type ? blob : blob.slice(0, blob.size, image.mimeType);
      const result = { ...await readStoredBlob(typedBlob), name: image.name };
      if (!stillAllowed()) throw new Error('This image is no longer available in this session.');
      await putCachedImage(uid!, image, typedBlob);
      if (!stillAllowed()) { await removeCachedImage(image); throw new Error('This image is no longer available in this session.'); }
      return result;
    })();
    // Bound decoded/base64 memory separately from the on-disk image cache.
    if (cache.size >= 24) cache.delete(cache.keys().next().value!);
    cache.set(key, pending);
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return pending;
}
export const loadThumbnail = (image: StoredImage) => loadImage(image.thumbnail || image);
async function readStoredBlob(blob: Blob): Promise<ImageAsset> {
  // Generated 4K files may exceed the 10 MB limit that applies only to uploads.
  if (blob.size <= 10 * 1024 * 1024) return readImage(blob);
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
  return { name: 'saved-image', mimeType: blob.type, data: dataUrl.split(',')[1], ...await getDimensions(dataUrl) };
}
