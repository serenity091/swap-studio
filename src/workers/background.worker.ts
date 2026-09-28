import { removeBackground } from '@imgly/background-removal';
self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const foreground = await removeBackground(event.data, {
      model: 'isnet_fp16', device: 'cpu', rescale: true, proxyToWorker: false,
      publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/',
      output: { format: 'image/png', quality: 1 },
      progress: (key, current, total) => self.postMessage({ type: 'progress', message: key.startsWith('compute:') ? 'Removing background…' : `Downloading removal tools… ${total ? Math.round(current / total * 100) : 0}%` }),
    });
    const bitmap = await createImageBitmap(foreground);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ type: 'result', blob });
  } catch {
    self.postMessage({ type: 'error', message: 'Background removal could not finish. Check your connection and try again, or try a smaller crop in a recent browser. Your photo is unchanged.' });
  }
};
