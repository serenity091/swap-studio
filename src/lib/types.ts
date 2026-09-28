export type View = 'front' | 'back';
export type Resolution = '1K' | '2K' | '4K';
export type ImageAsset = { name: string; mimeType: string; data: string; width: number; height: number };
export type Pair = Partial<Record<View, ImageAsset>>;
export type Part = { text?: string; inlineData?: { mimeType: string; data: string }; thought?: boolean; thoughtSignature?: string; [key: string]: unknown };
export type Content = { role: 'user' | 'model'; parts: Part[] };
export type Generation = { image: ImageAsset; history: Content[] };
export type StoredImage = Omit<ImageAsset, 'data'> & { path: string };
export type StudioRecord = {
  id: string; kind: 'identity' | 'swap'; name: string; ownerId: string; ownerName: string;
  createdAt: number; model: string; resolution: Resolution; promptVersion: string;
  assets: Record<string, StoredImage>; identityId: string; identityName: string;
};
export type SaveInput = Omit<StudioRecord, 'assets'> & { assets: Record<string, ImageAsset> };
export type StudioUser = { uid: string; email: string | null };
export type IdentityDraft = {
  id: string; name: string; references: Pair; generated: Pair; bases: Pair;
  frontHistory?: Content[]; step: 0 | 1 | 2 | 3; resolution: Resolution;
  identityApproved: boolean; savedId?: string;
};
export type SwapDraft = {
  id: string; identityId: string; name: string; references: Pair; generated: Pair;
  frontHistory?: Content[]; resolution: Resolution; savedId?: string; promptVersion?: string;
};
export function newIdentity(): IdentityDraft {
  return { id: crypto.randomUUID(), name: '', references: {}, generated: {}, bases: {}, step: 0, resolution: '2K', identityApproved: false };
}
export function newSwap(): SwapDraft {
  return { id: crypto.randomUUID(), identityId: '', name: '', references: {}, generated: {}, resolution: '2K' };
}
export const completePair = (p: Pair): p is Record<View, ImageAsset> => Boolean(p.front && p.back);
