import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/gemini', () => ({ generateImage: vi.fn(), MODEL: 'gemini-3-pro-image' }));
vi.mock('../src/lib/library', () => ({ loadImage: vi.fn() }));
import { generateImage } from '../src/lib/gemini';
import { loadImage } from '../src/lib/library';
import { generateIdentity, prepareBases, generateSwap, identityRecord, swapRecord } from '../src/lib/workflow';
import { newIdentity, newSwap, type ImageAsset, type IdentityDraft, type StudioRecord } from '../src/lib/types';
import { PROMPTS, SWAP_PROMPT_VERSION } from '../src/prompts';
const img = (name: string): ImageAsset => ({ name, mimeType: 'image/png', data: name, width: 900, height: 1200 });
const user = { uid: 'alice', email: 'alice@example.test' };
const signedHistory = [{ role: 'model' as const, parts: [{ inlineData: { mimeType: 'image/png', data: 'front' }, thoughtSignature: 'opaque-signature' }] }];
beforeEach(() => vi.resetAllMocks());
describe('identity workflow', () => {
  it('carries the front conversation into the back request, in reference order', async () => {
    const d = { ...newIdentity(), references: { front: img('ref-front'), back: img('ref-back') } };
    vi.mocked(generateImage).mockResolvedValueOnce({ image: img('new-front'), history: signedHistory }).mockResolvedValueOnce({ image: img('new-back'), history: [] });
    const result = await generateIdentity(d, 'key', vi.fn(), vi.fn());
    expect(generateImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ prompt: PROMPTS.identityFront, images: [d.references.front] }));
    expect(generateImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ prompt: PROMPTS.identityBack, images: [d.references.back], history: signedHistory }));
    expect(result.generated.back?.data).toBe('new-back');
    expect(result.identityApproved).toBe(false);
  });
  it('does not prepare bases or save without explicit approvals', async () => {
    const d = { ...newIdentity(), name: 'Model', references: { front: img('ref-f'), back: img('ref-b') }, generated: { front: img('f'), back: img('b') }, bases: { front: img('bf'), back: img('bb') } };
    await expect(prepareBases(d, 'key', vi.fn(), vi.fn())).rejects.toThrow('Approve');
    expect(generateImage).not.toHaveBeenCalled();
    expect(() => identityRecord(d, user, true)).toThrow('approval');
    expect(() => identityRecord({ ...d, identityApproved: true }, user, false)).toThrow('approval');
    expect(identityRecord({ ...d, identityApproved: true }, user, true).assets.front.data).toBe('bf');
  });
  it('keeps a completed front when the back fails and only retries the back', async () => {
    const d = { ...newIdentity(), references: { front: img('ref-f'), back: img('ref-b') } };
    let saved: IdentityDraft = d;
    const update = (next: IdentityDraft) => { saved = next; };
    vi.mocked(generateImage).mockResolvedValueOnce({ image: img('front'), history: signedHistory }).mockRejectedValueOnce(new Error('quota'));
    await expect(generateIdentity(d, 'key', update, vi.fn())).rejects.toThrow('quota');
    expect(saved.generated.front?.data).toBe('front');
    vi.mocked(generateImage).mockResolvedValueOnce({ image: img('back'), history: [] });
    await generateIdentity(saved, 'key', update, vi.fn());
    expect(generateImage).toHaveBeenCalledTimes(3);
    expect(vi.mocked(generateImage).mock.calls[2][0].prompt).toBe(PROMPTS.identityBack);
  });
  it('prepares bases only from approved generated images, never source people', async () => {
    const d = { ...newIdentity(), identityApproved: true, references: { front: img('source-f'), back: img('source-b') }, generated: { front: img('fictional-f'), back: img('fictional-b') } };
    vi.mocked(generateImage).mockResolvedValue({ image: img('base'), history: [] });
    await prepareBases(d, 'key', vi.fn(), vi.fn());
    expect(generateImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ prompt: PROMPTS.neutralBase, images: [d.generated.front] }));
    expect(generateImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ prompt: PROMPTS.bareBack, images: [d.generated.back] }));
  });
});
describe('garment swaps', () => {
  const identity = { id: 'identity-1', kind: 'identity', name: 'Model one', assets: { front: { path: 'base-f' }, back: { path: 'base-b' } } } as unknown as StudioRecord;
  it('sends matching base and mannequin views in the order specified by the prompts', async () => {
    vi.mocked(loadImage).mockResolvedValueOnce(img('base-f')).mockResolvedValueOnce(img('base-b'));
    vi.mocked(generateImage).mockResolvedValueOnce({ image: img('result-f'), history: signedHistory }).mockResolvedValueOnce({ image: img('result-b'), history: [] });
    const d = { ...newSwap(), identityId: identity.id, references: { front: img('mannequin-f'), back: img('mannequin-b') } };
    const result = await generateSwap(d, identity, 'key', vi.fn(), vi.fn());
    const calls = vi.mocked(generateImage).mock.calls;
    expect(calls[0][0].images.map(i => i.name)).toEqual(['base-f', 'mannequin-f', 'mannequin-b']);
    expect(calls[0][0].imageLabels).toEqual(['MODEL_BASE', 'BRA_FRONT', 'BRA_BACK']);
    expect(calls[1][0].images.map(i => i.name)).toEqual(['base-b', 'mannequin-b', 'mannequin-f', 'result-f']);
    expect(calls[1][0].imageLabels).toEqual(['MODEL_BASE', 'BRA_BACK', 'BRA_FRONT', 'FRONT_RESULT']);
    expect(calls[1][0].history).toBeUndefined();
    expect(result.frontHistory).toBeUndefined();
    expect(swapRecord(result, identity, user).identityId).toBe('identity-1');
    expect(swapRecord(result, identity, user).promptVersion).toBe(SWAP_PROMPT_VERSION);
  });
  it('resumes a legacy front without resending its conversation or regenerating it', async () => {
    vi.mocked(loadImage).mockResolvedValue(img('base-b'));
    vi.mocked(generateImage).mockResolvedValue({ image: img('result-b'), history: [] });
    const d = { ...newSwap(), identityId: identity.id, references: { front: img('mannequin-f'), back: img('mannequin-b') }, generated: { front: img('kept-front') }, frontHistory: signedHistory };
    const result = await generateSwap(d, identity, 'key', vi.fn(), vi.fn());
    expect(generateImage).toHaveBeenCalledTimes(1);
    const request = vi.mocked(generateImage).mock.calls[0][0];
    expect(request.history).toBeUndefined();
    expect(request.images.map(i => i.name)).toEqual(['base-b', 'mannequin-b', 'mannequin-f', 'kept-front']);
    expect(result.generated.front).toBe(d.generated.front);
    expect(swapRecord(result, identity, user).promptVersion).toBe('workflow-v1-front+swap-v3-back');
  });
  it('refuses incomplete pairs and mismatched identities', async () => {
    const d = { ...newSwap(), identityId: 'another-identity' };
    await expect(generateSwap(d, identity, 'key', vi.fn(), vi.fn())).rejects.toThrow('Choose');
    expect(() => swapRecord(d, identity, user)).toThrow('complete');
    expect(generateImage).not.toHaveBeenCalled();
  });
});
