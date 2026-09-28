import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/images', () => ({ getDimensions: vi.fn().mockResolvedValue({ width: 1000, height: 1400 }) }));
import { generateImage, extractImage, validateKey } from '../src/lib/gemini';
const options = { key: 'TEST_ONLY_KEY', prompt: 'Generate a test image', images: [], resolution: '2K' as const };
afterEach(() => vi.unstubAllGlobals());
describe('Gemini response handling', () => {
  it('ignores thought images and carries opaque signatures unchanged', async () => {
    const parts = [{ thought: true, inlineData: { mimeType: 'image/png', data: 'draft' } }, { inlineData: { mimeType: 'image/png', data: 'final' }, thoughtSignature: 'signature-123' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateImage(options);
    expect(result.image.data).toBe('final');
    expect(result.history.at(-1)?.parts).toEqual(parts);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).not.toContain('TEST_ONLY_KEY');
    expect(request[1].headers['x-goog-api-key']).toBe('TEST_ONLY_KEY');
    expect(JSON.parse(request[1].body).generationConfig.imageConfig.imageSize).toBe('2K');
    expect(extractImage([{ thought: true, inlineData: { mimeType: 'image/png', data: 'only-thought' } }])).toBeUndefined();
  });
  it('shows model refusals instead of treating them as images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Cannot process this reference.' }] }, finishReason: 'SAFETY' }] }))));
    await expect(generateImage(options)).rejects.toThrow('Cannot process');
  });
  it('reports quota failures without automatically repeating paid requests', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }));
    vi.stubGlobal('fetch', mock);
    await expect(generateImage(options)).rejects.toThrow('quota');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('checks the API key through model metadata without generating an image', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'models/gemini-3-pro-image' })));
    vi.stubGlobal('fetch', mock);
    await validateKey('TEST_ONLY_KEY');
    expect(mock.mock.calls[0][0]).not.toContain(':generateContent');
    expect(mock.mock.calls[0][1].method).toBeUndefined();
  });
});
