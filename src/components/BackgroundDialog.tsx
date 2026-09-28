import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { removePhotoBackground } from '../lib/background';
import { imageSrc } from '../lib/images';
import type { ImageAsset } from '../lib/types';
export function BackgroundDialog({ image, onSave, close }: { image: ImageAsset; onSave: (image: ImageAsset) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<ImageAsset>();
  const [message, setMessage] = useState('Loading removal tools…');
  const [error, setError] = useState('');
  const [original, setOriginal] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setResult(undefined); setMessage('Loading removal tools…');
    void removePhotoBackground(image, text => { if (!controller.signal.aborted) setMessage(text); }, controller.signal)
      .then(next => { if (!controller.signal.aborted) setResult(next); })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [image, attempt]);
  return <dialog ref={dialog} className="crop-dialog background-dialog" aria-label="Remove background" onCancel={close}>
    <div className="dialog-toolbar"><h2>Remove background</h2><button className="icon-button" aria-label="Close background removal" onClick={close}><X size={20} /></button></div>
    <p>{result ? 'Check that the mannequin, bra, and straps are intact.' : 'Keeping the mannequin and bra together. The first use downloads removal tools.'}</p>
    {result && <div className="view-toggle"><button className={original ? 'selected' : ''} aria-pressed={original} onClick={() => setOriginal(true)}>Original photo</button><button className={!original ? 'selected' : ''} aria-pressed={!original} onClick={() => setOriginal(false)}>White background</button></div>}
    <div className="background-preview"><img src={imageSrc(original || !result ? image : result)} alt={original || !result ? 'Photo before background removal' : 'Background removal preview'} /></div>
    {!result && !error && <p role="status" className="background-progress"><LoaderCircle className="spin" size={17} />{message}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    <p className="small muted">Processed on this device. No image generation or API charge.</p>
    <div className="crop-actions"><button className="secondary" onClick={close}>{result ? 'Keep original' : 'Cancel'}</button>{error && <button className="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</button>}<button className="primary" disabled={!result} onClick={() => { if (result) { onSave(result); close(); } }}>Use result</button></div>
    <p className="small muted background-credit">Background removal by IMG.LY · <a href="https://github.com/serenity091/swap-studio" target="_blank" rel="noreferrer">Source & licenses</a></p>
  </dialog>;
}
