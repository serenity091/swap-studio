import type { Content, Generation, ImageAsset, Part, Resolution } from './types';
import { getDimensions } from './images';
export const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3-pro-image';
const API = 'https://generativelanguage.googleapis.com/v1beta';
export function userContent(prompt: string, images: ImageAsset[], imageLabels?: string[]): Content {
  if (imageLabels && (imageLabels.length !== images.length || imageLabels.some(label => !label.trim()))) throw new Error('Each reference image must have a label.');
  return {
    role: 'user', parts: [{ text: prompt }, ...images.flatMap((image, index): Part[] => [
      ...(imageLabels ? [{ text: `Reference ${imageLabels[index]}:` }] : []),
      { inlineData: { mimeType: image.mimeType, data: image.data } },
    ])],
  };
}
export function extractImage(parts: Part[]) {
  return [...parts].reverse().find(p => !p.thought && p.inlineData?.mimeType.startsWith('image/'))?.inlineData;
}
function apiError(status: number, message?: string) {
  if (/prepayment credits.*depleted|prepaid.*(?:depleted|exhausted)|insufficient.*(?:credits|balance)/i.test(message || '')) return 'Your Google AI Studio API credits are depleted. Add credits in Google AI Studio, then retry. Your uploaded photos are kept.';
  if (status === 400 && message?.toLowerCase().includes('api key')) return 'The API key is invalid. Check it in API key settings.';
  if (status === 401 || status === 403) return 'This key does not have access. Check the key, API restrictions, and project billing in Google AI Studio.';
  if (status === 404) return `The configured model (${MODEL}) is unavailable for this key. Check model access in Google AI Studio.`;
  if (status === 429) return 'Google’s quota or rate limit was reached. Check your billing and usage, then retry the missing image.';
  if (status >= 500) return 'Google is temporarily unavailable. Your completed images are kept; try again shortly.';
  return message || `Google returned an error (${status}).`;
}
export async function validateKey(key: string) {
  if (!key.trim()) throw new Error('Enter your Google AI Studio API key.');
  const response = await fetch(`${API}/models/${encodeURIComponent(MODEL)}`, {
    headers: { 'x-goog-api-key': key.trim() }, signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(apiError(response.status, result.error?.message));
}
export async function generateImage(options: {
  key: string; prompt: string; images: ImageAsset[]; imageLabels?: string[]; resolution: Resolution; aspectRatio?: string; history?: Content[]; signal?: AbortSignal;
}): Promise<Generation> {
  if (!options.key) throw new Error('Connect your Google API key to generate images.');
  const contents = [...(options.history || []), userContent(options.prompt, options.images, options.imageLabels)];
  const body = JSON.stringify({ contents, generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: options.resolution, ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) },
  } });
  if (new Blob([body]).size > 19 * 1024 * 1024) throw new Error('These references are too large together. Use smaller image files (about 2 MB each) and try again.');
  let response: Response;
  try {
    response = await fetch(`${API}/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.key }, body,
      signal: AbortSignal.any([AbortSignal.timeout(300000), ...(options.signal ? [options.signal] : [])]),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new Error('Generation stopped. Completed images are kept. Google may still charge for a request already sent.');
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('Google took too long to respond. Your completed images are kept. Retry when ready; the earlier request may still be billed.');
    throw new Error('Could not reach Google. Check your connection and try again.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(apiError(response.status, result.error?.message));
  if (result.promptFeedback?.blockReason) throw new Error(`Google could not process this request (${result.promptFeedback.blockReason}). Review your references and try again.`);
  const candidate = result.candidates?.[0];
  const parts: Part[] = candidate?.content?.parts || [];
  const output = extractImage(parts);
  if (!output) {
    const explanation = parts.filter(p => !p.thought && p.text).map(p => p.text).join(' ').slice(0, 500);
    throw new Error(explanation || `Google returned no image${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}. Try another reference or retry.`);
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.mimeType)) throw new Error('Google returned an unsupported image format.');
  const dimensions = await getDimensions(`data:${output.mimeType};base64,${output.data}`);
  return {
    image: { ...output, ...dimensions, name: 'generated-image' },
    // Preserve every model part, including opaque thought signatures, for the companion back-view request.
    history: [...contents, { role: 'model', parts }],
  };
}
