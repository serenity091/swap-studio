import { PROMPTS, PROMPT_VERSION, SWAP_PROMPT_VERSION } from '../prompts';
import { generateImage, MODEL } from './gemini';
import { completePair, type IdentityDraft, type SwapDraft, type StudioRecord, type StudioUser, type SaveInput } from './types';
import { swapOutputSettings, matchIdentityDimensions } from './swap-sizing';
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
  if (completePair(draft.generated)) return draft;
  const detailPrompt = `\nCLASP_DETAIL is a crop from BRA_${draft.clasp!.view.toUpperCase()} of this same product.`;
  progress('Loading the approved identity…');
  const frontBase = await loadImage(identity.assets.front);
  const backBase = await loadImage(identity.assets.back);
  const frontSettings = swapOutputSettings(frontBase);
  const backSettings = swapOutputSettings(backBase);
  let next = { ...draft };
  for (const view of ['front', 'back'] as const) {
    if (next.generated[view]) continue;
    const base = view === 'front' ? frontBase : backBase;
    const settings = view === 'front' ? frontSettings : backSettings;
    next = { ...next, rejected: { ...next.rejected, [view]: undefined } }; update(next);
    progress(`Fitting the bra to the ${view} view…`);
    const framing = `\nEdit MODEL_BASE itself. Its canvas is ${base.width} × ${base.height}, aspect ratio ${settings.aspectRatio}. Preserve the exact same person, expression, head position, hair silhouette, arm positions, body proportions, subject scale, camera distance, and image boundaries. Only replace the bra. The clasp crop's shape must never determine the output framing.`;
    const result = await generateImage({ key, prompt: (view === 'front' ? PROMPTS.swapFront : PROMPTS.swapBack) + detailPrompt + framing,
      images: view === 'front' ? [base, draft.references.front, draft.references.back, draft.clasp!.image] : [base, draft.references.back, draft.references.front, frontBase, draft.clasp!.image],
      imageLabels: view === 'front' ? ['MODEL_BASE', 'BRA_FRONT', 'BRA_BACK', 'CLASP_DETAIL'] : ['MODEL_BASE', 'BRA_BACK', 'BRA_FRONT', 'IDENTITY_FRONT', 'CLASP_DETAIL'],
      ...settings, signal });
    let image;
    try { image = await matchIdentityDimensions(result.image, base); }
    catch (error) { next = { ...next, rejected: { ...next.rejected, [view]: result.image } }; update(next); throw error; }
    next = { ...next, generated: { ...next.generated, [view]: image }, frontHistory: undefined, resolution: frontSettings.resolution,
      promptVersion: view === 'front' || next.promptVersion === SWAP_PROMPT_VERSION ? SWAP_PROMPT_VERSION : `${next.promptVersion || PROMPT_VERSION}-front+swap-v5-back` }; update(next);
  }
  return next;
}
export function swapRecord(d: SwapDraft, identity: StudioRecord, user: StudioUser, approved = false): SaveInput {
  if (!approved) throw new Error('Review and approve the identity, pose, framing, and garment before saving.');
  if (!completePair(d.generated) || !completePair(d.references)) throw new Error('A complete front and back pair is required before saving.');
  if (identity.kind !== 'identity' || identity.id !== d.identityId) throw new Error('The selected identity does not match this swap.');
  if ((d.promptVersion?.includes('swap-v4') || d.promptVersion?.includes('swap-v5')) && !d.clasp) throw new Error('Clasp detail is required for this swap.');
  return { id: d.id, kind: 'swap', name: d.name.trim() || `${identity.name} · Bra swap`, ownerId: user.uid, ownerName: user.email?.split('@')[0] || 'Studio member', createdAt: Date.now(), model: MODEL, resolution: d.resolution, promptVersion: d.promptVersion || PROMPT_VERSION, identityId: identity.id, identityName: identity.name, assets: { front: d.generated.front, back: d.generated.back, referenceFront: d.references.front, referenceBack: d.references.back, ...(d.clasp ? { [d.clasp.view === 'front' ? 'claspFront' : 'claspBack']: d.clasp.image } : {}) } };
}
