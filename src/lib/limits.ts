import type { StudioRecord } from './types';
// Mirrored in Firebase rules: 240 × (16 MiB original + 128 KiB preview) < 3.78 GiB.
export const LIBRARY_LIMITS = { identity: 20, swap: 100 } as const;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 128 * 1024;
export const isReady = (record: StudioRecord) => !record.state || record.state === 'ready';
export const fullMessage = (kind: StudioRecord['kind']) => `${kind === 'identity' ? 'Identity' : 'Swap'} library is full (${LIBRARY_LIMITS[kind]}). Delete an item before generating or saving another.`;
