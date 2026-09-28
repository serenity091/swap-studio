import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/images', () => ({ getDimensions: vi.fn().mockResolvedValue({ width: 1000, height: 1400 }) }));
import { generateImage, extractImage, validateKey } from '../src/lib/gemini';
const options = { key: 'TEST_ONLY_KEY', prompt: 'Generate a test image', images: [], resolution: '2K' as const };
afterEach(() => vi.unstubAllGlobals());
describe('Gemini response handling', () => {
  it('places each role label directly before its matching image in the API request', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'output' } }] } }] })));
    vi.stubGlobal('fetch', mock);
    const images = ['base', 'product'].map(data => ({ name: data, data, mimeType: 'image/png', width: 900, height: 1200 }));
    await generateImage({ ...options, images, imageLabels: ['MODEL_BASE', 'BRA_BACK'] });
    expect(JSON.parse(mock.mock.calls[0][1].body).contents).toEqual([{ role: 'user', parts: [
      { text: options.prompt }, { text: 'Reference MODEL_BASE:' }, { inlineData: { mimeType: 'image/png', data: 'base' } },
      { text: 'Reference BRA_BACK:' }, { inlineData: { mimeType: 'image/png', data: 'product' } },
    ] }]);
    await expect(generateImage({ ...options, images, imageLabels: ['MODEL_BASE'] })).rejects.toThrow('Each reference');
    expect(mock).toHaveBeenCalledTimes(1);
  });
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
  it('reports exhausted prepaid credits clearly without retrying', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Your prepayment credits are depleted. Please go to AI Studio to manage billing.' } }), { status: 400 }));
    vi.stubGlobal('fetch', mock);
    await expect(generateImage(options)).rejects.toThrow('Your Google AI Studio API credits are depleted.');
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
