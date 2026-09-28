import { collection, doc, getDocs, onSnapshot, orderBy, query, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getBlob, deleteObject } from 'firebase/storage';
import { db, storage, isPreview } from './firebase';
import { getDimensions, imageBlob, readImage } from './images';
import { localGet, localSet, localDelete } from './local';
import type { ImageAsset, SaveInput, StoredImage, StudioRecord } from './types';
import { LIBRARY_LIMITS, MAX_IMAGE_BYTES, fullMessage } from './limits';
const cacheKey = (image: StoredImage) => `${image.path}:${image.version || ''}`;
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
function notifyPreview() { window.dispatchEvent(new Event(PREVIEW_EVENT)); }
function plannedRecord(input: SaveInput, slot: string): StudioRecord {
  const assets: Record<string, StoredImage> = {};
  for (const view of ['front', 'back'] as const) {
    const image = input.assets[view];
    if (!image) throw new Error('Both final images are required.');
    const { data: _data, ...metadata } = image;
    const bytes = imageBlob(image).size;
    if (!bytes || bytes > MAX_IMAGE_BYTES) throw new Error(`The ${view} image exceeds the 16 MiB storage limit. Download this result to keep it. No images were uploaded.`);
    assets[view] = { ...metadata, path: `library/${slot}/${view}`, version: input.id, bytes };
  }
  return { ...input, assets, slot, state: 'saving' };
}
export async function checkCapacity(kind: StudioRecord['kind'], id: string) {
  const records = isPreview ? await localGet<StudioRecord[]>('preview-records') || []
    : (await getDocs(collection(db!, 'records'))).docs.map(d => d.data() as StudioRecord);
  if (!records.some(r => r.id === id) && records.filter(r => r.kind === kind).length >= LIBRARY_LIMITS[kind]) throw new Error(fullMessage(kind));
}
async function reserveRecord(input: SaveInput): Promise<StudioRecord> {
  // Validate bytes before reserving anything. Fixed physical slots bound even partial uploads.
  plannedRecord(input, `${input.kind}-0`);
  if (isPreview) {
    const records = await localGet<StudioRecord[]>('preview-records') || [];
    const existing = records.find(r => r.id === input.id);
    if (existing) return existing;
    const slot = Array.from({ length: LIBRARY_LIMITS[input.kind] }, (_, i) => `${input.kind}-${i}`).find(s => !records.some(r => r.slot === s));
    if (!slot) throw new Error(fullMessage(input.kind));
    const record = plannedRecord(input, slot);
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
      const record = plannedRecord(input, slot);
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
  const record = await reserveRecord(input);
  if (record.state === 'ready') return;
  // A failed save remains visible as an unfinished item. Retrying uses the same slot.
  for (const view of ['front', 'back'] as const) {
    const image = input.assets[view];
    const stored = record.assets[view];
    if (stored.bytes !== imageBlob(image).size || stored.width !== image.width || stored.height !== image.height || stored.mimeType !== image.mimeType) throw new Error('This draft changed after its save started. Delete the unfinished library item, then save again.');
    if (isPreview) await localSet(`preview-image:${stored.path}`, image);
    else await uploadBytes(ref(storage!, stored.path), imageBlob(image), { contentType: image.mimeType, cacheControl: 'private, no-store', customMetadata: { recordId: record.id } });
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
  for (const image of Object.values(record.assets)) {
    if (isPreview) await localDelete(`preview-image:${image.path}`);
    else try { await deleteObject(ref(storage!, image.path)); }
    catch (error) { if ((error as { code?: string }).code !== 'storage/object-not-found') throw new Error('Deletion was interrupted. Click Delete again to finish removing the images and free the space.'); }
    cache.delete(cacheKey(image));
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
  let pending = cache.get(cacheKey(image));
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
    cache.set(cacheKey(image), pending);
    pending.catch(() => cache.delete(cacheKey(image)));
  }
  return pending;
}
async function readStoredBlob(blob: Blob): Promise<ImageAsset> {
  // Generated 4K files may exceed the 10 MB limit that applies only to uploads.
  if (blob.size <= 10 * 1024 * 1024) return readImage(blob);
  const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(blob); });
  return { name: 'saved-image', mimeType: blob.type, data: dataUrl.split(',')[1], ...await getDimensions(dataUrl) };
}
