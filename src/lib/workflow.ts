import { PROMPTS, PROMPT_VERSION, SWAP_PROMPT_VERSION } from '../prompts';
import { generateImage, MODEL } from './gemini';
import { completePair, type IdentityDraft, type SwapDraft, type StudioRecord, type StudioUser, type SaveInput } from './types';
import { loadImage } from './library';
export async function generateIdentity(draft: IdentityDraft, key: string, update: (d: IdentityDraft) => void, progress: (s: string) => void, signal?: AbortSignal) {
  if (!completePair(draft.references)) throw new Error('Upload both model reference views first.');
  if (draft.identityApproved) throw new Error('Start a new identity to change an approved model.');
  let next = { ...draft, step: 1 as const };
  update(next);
  if (!next.generated.front) {
    progress('Generating the new front-view identity…');
    const result = await generateImage({ key, prompt: PROMPTS.identityFront, images: [draft.references.front], resolution: draft.resolution, signal });
    next = { ...next, generated: { front: result.image }, frontHistory: result.history }; update(next);
  }
  if (!next.generated.back) {
    progress('Matching the back view to the new identity…');
    if (!next.frontHistory) throw new Error('The front-view context is missing. Regenerate the identity pair.');
    const result = await generateImage({ key, prompt: PROMPTS.identityBack, images: [draft.references.back], history: next.frontHistory, resolution: draft.resolution, signal });
    next = { ...next, generated: { ...next.generated, back: result.image } }; update(next);
  }
  return next;
}
export async function prepareBases(draft: IdentityDraft, key: string, update: (d: IdentityDraft) => void, progress: (s: string) => void, signal?: AbortSignal) {
  if (!draft.identityApproved || !completePair(draft.generated)) throw new Error('Approve a complete identity pair before preparing bases.');
  let next = { ...draft, step: 2 as const }; update(next);
  if (!next.bases.front) {
    progress('Preparing the neutral front base…');
    const result = await generateImage({ key, prompt: PROMPTS.neutralBase, images: [draft.generated.front], resolution: draft.resolution, signal });
    next = { ...next, bases: { ...next.bases, front: result.image } }; update(next);
  }
  if (!next.bases.back) {
    progress('Preparing the bare-back base…');
    const result = await generateImage({ key, prompt: PROMPTS.bareBack, images: [draft.generated.back], resolution: draft.resolution, signal });
    next = { ...next, bases: { ...next.bases, back: result.image } }; update(next);
  }
  return next;
}
export function identityRecord(d: IdentityDraft, user: StudioUser, basesApproved: boolean): SaveInput {
  if (!d.identityApproved || !basesApproved || !completePair(d.generated) || !completePair(d.bases) || !completePair(d.references)) throw new Error('Both approval steps and all images are required before saving.');
  if (!d.name.trim()) throw new Error('Give this identity a name before saving.');
  return { id: d.id, kind: 'identity', name: d.name.trim(), ownerId: user.uid, ownerName: user.email?.split('@')[0] || 'Studio member', createdAt: Date.now(), model: MODEL, resolution: d.resolution, promptVersion: PROMPT_VERSION, identityId: '', identityName: '', assets: { front: d.bases.front, back: d.bases.back, identityFront: d.generated.front, identityBack: d.generated.back, referenceFront: d.references.front, referenceBack: d.references.back } };
}
export async function generateSwap(draft: SwapDraft, identity: StudioRecord, key: string, update: (d: SwapDraft) => void, progress: (s: string) => void, signal?: AbortSignal) {
  if (identity.kind !== 'identity' || identity.id !== draft.identityId) throw new Error('Choose a saved identity first.');
  if (!completePair(draft.references)) throw new Error('Upload both mannequin views first.');
  if (!completePair(draft.generated) && !draft.clasp) throw new Error('Select a clasp detail before generating.');
  const detailPrompt = draft.clasp ? `\nCLASP_DETAIL is a crop from BRA_${draft.clasp.view.toUpperCase()} of this same product.` : '';
  let next = { ...draft };
  if (!next.generated.front) {
    progress('Loading the approved identity…');
    const base = await loadImage(identity.assets.front);
    progress('Fitting the bra to the front view…');
    const result = await generateImage({ key, prompt: PROMPTS.swapFront + detailPrompt, images: [base, draft.references.front, draft.references.back, draft.clasp!.image], imageLabels: ['MODEL_BASE', 'BRA_FRONT', 'BRA_BACK', 'CLASP_DETAIL'], resolution: draft.resolution, signal });
    next = { ...next, generated: { front: result.image }, frontHistory: undefined, promptVersion: SWAP_PROMPT_VERSION }; update(next);
  }
  if (!next.generated.back) {
    progress('Loading the back-view identity…');
    const base = await loadImage(identity.assets.back);
    progress('Fitting the back and matching the front…');
    // A fresh edit has one unambiguous base and avoids resending the entire front conversation.
    // The generated front remains a visual reference for the garment's appearance only.
    const result = await generateImage({ key, prompt: PROMPTS.swapBack + detailPrompt, images: [base, draft.references.back, draft.references.front, next.generated.front!, draft.clasp!.image], imageLabels: ['MODEL_BASE', 'BRA_BACK', 'BRA_FRONT', 'FRONT_RESULT', 'CLASP_DETAIL'], resolution: draft.resolution, signal });
    next = { ...next, generated: { ...next.generated, back: result.image }, frontHistory: undefined, promptVersion: next.promptVersion === SWAP_PROMPT_VERSION ? SWAP_PROMPT_VERSION : `${next.promptVersion || PROMPT_VERSION}-front+swap-v4-back` }; update(next);
  }
  return next;
}
export function swapRecord(d: SwapDraft, identity: StudioRecord, user: StudioUser): SaveInput {
  if (!completePair(d.generated) || !completePair(d.references)) throw new Error('A complete front and back pair is required before saving.');
  if (identity.kind !== 'identity' || identity.id !== d.identityId) throw new Error('The selected identity does not match this swap.');
  if (d.promptVersion?.includes('swap-v4') && !d.clasp) throw new Error('Clasp detail is required for this swap.');
  return { id: d.id, kind: 'swap', name: d.name.trim() || `${identity.name} · Bra swap`, ownerId: user.uid, ownerName: user.email?.split('@')[0] || 'Studio member', createdAt: Date.now(), model: MODEL, resolution: d.resolution, promptVersion: d.promptVersion || PROMPT_VERSION, identityId: identity.id, identityName: identity.name, assets: { front: d.generated.front, back: d.generated.back, referenceFront: d.references.front, referenceBack: d.references.back, ...(d.clasp ? { [d.clasp.view === 'front' ? 'claspFront' : 'claspBack']: d.clasp.image } : {}) } };
}
