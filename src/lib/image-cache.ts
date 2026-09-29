import type { StoredImage } from './types';

// Only saved image blobs live here. Account keys and drafts never enter this database.
export const IMAGE_CACHE_BYTES = 200 * 1024 * 1024;
export const IMAGE_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
type Entry = { key: string; uid: string; blob: Blob; touched: number; expires: number };
let database: Promise<IDBDatabase> | undefined;
export const imageCacheKey = (uid: string, image: StoredImage) => JSON.stringify([uid, image.path, image.version || '']);
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('swap-studio-image-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'key' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  return database;
}
// Cache failures (private browsing, quota, eviction) must never block the library.
async function transaction<T>(action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      let value: T | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error);
      action(tx.objectStore('images'), result => { value = result; });
    });
  } catch { database = undefined; return undefined; }
}
export async function getCachedImage(uid: string, image: StoredImage): Promise<Blob | undefined> {
  return transaction<Blob>((store, result) => {
    const request = store.get(imageCacheKey(uid, image));
    request.onsuccess = () => {
      const entry = request.result as Entry | undefined;
      if (!entry) return;
      if (entry.expires <= Date.now()) { store.delete(entry.key); return; }
      store.put({ ...entry, touched: Date.now() });
      result(entry.blob);
    };
  });
}
export async function putCachedImage(uid: string, image: StoredImage, blob: Blob): Promise<void> {
  if (!blob.size || blob.size > IMAGE_CACHE_BYTES) return;
  await transaction<void>(store => {
    const now = Date.now();
    const key = imageCacheKey(uid, image);
    const entries: { key: string; touched: number; bytes: number }[] = [];
    let bytes = blob.size;
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (current) {
        const entry = current.value as Entry;
        if (entry.expires <= now) current.delete();
        else if (entry.key !== key) { bytes += entry.blob.size; entries.push({ key: entry.key, touched: entry.touched, bytes: entry.blob.size }); }
        current.continue();
      } else {
        // Evict least recently used images across accounts to bound disk usage.
        entries.sort((a, b) => a.touched - b.touched);
        for (const entry of entries) {
          if (bytes <= IMAGE_CACHE_BYTES) break;
          bytes -= entry.bytes;
          store.delete(entry.key);
        }
        store.put({ key, uid, blob, touched: now, expires: now + IMAGE_CACHE_AGE_MS } satisfies Entry);
      }
    };
  });
}
export async function removeCachedImage(image: StoredImage): Promise<void> {
  await transaction<void>(store => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const [, path, version] = JSON.parse((current.value as Entry).key) as string[];
      if (path === image.path && version === (image.version || '')) current.delete();
      current.continue();
    };
  });
}
export async function pruneImageCache(uid: string, images: StoredImage[]): Promise<void> {
  const allowed = new Set(images.map(image => imageCacheKey(uid, image)));
  await transaction<void>(store => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const entry = current.value as Entry;
      if (entry.expires <= Date.now() || (entry.uid === uid && !allowed.has(entry.key))) current.delete();
      current.continue();
    };
  });
}
