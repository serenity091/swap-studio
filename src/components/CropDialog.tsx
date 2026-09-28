import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { cropImage, cropPixels, type CropBox } from '../lib/crop';
import { imageSrc } from '../lib/images';
import type { ImageAsset } from '../lib/types';
export function CropDialog({ image, detail, onSave, close }: { image: ImageAsset; detail: boolean; onSave: (image: ImageAsset) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) };
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const end = point(e);
    setBox({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(start.current.x - end.x), height: Math.abs(start.current.y - end.y) });
  }
  let pixels: CropBox | undefined;
  try { pixels = cropPixels(box, image.width, image.height); } catch { /* Empty or too small selection. */ }
  async function save() {
    setBusy(true); setError('');
    try { onSave(await cropImage(image, box, detail ? 'clasp' : 'crop')); close(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <dialog ref={dialog} className="crop-dialog" aria-label={detail ? 'Select clasp detail' : 'Crop photo'} onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <div className="dialog-toolbar"><h2>{detail ? 'Select clasp detail' : 'Crop photo'}</h2><button className="icon-button" aria-label="Close crop" disabled={busy} onClick={close}><X size={20} /></button></div>
    <p>{detail ? 'Draw a box around the whole clasp, with a little band on either side.' : 'Draw a box around the bra. Keep all straps, hardware, and the full band.'}</p>
    <div className="crop-stage"><div className="crop-surface" aria-label="Draw crop selection" onPointerDown={e => { if (busy || e.button !== 0) return; e.preventDefault(); start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); setBox({ ...start.current, width: 0, height: 0 }); }} onPointerMove={move} onPointerUp={e => { move(e); start.current = undefined; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { start.current = undefined; }}>
      <img src={imageSrc(image)} alt={detail ? "Original mannequin photo for clasp selection" : "Photo for cropping"} draggable={false} />
      {box.width > 0 && box.height > 0 && <div className="crop-selection" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />}
    </div></div>
    <details className="crop-numbers"><summary>Adjust selection</summary><div>{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]} %<input type="number" min="0" max="100" step="0.1" aria-label={`Crop ${key} percent`} value={Math.round(box[key] * 1000) / 10} disabled={busy} onChange={e => setBox(b => ({ ...b, [key]: Math.max(0, Math.min(100, Number(e.target.value))) / 100 }))} /></label>)}</div></details>
    <p className="small muted">{pixels ? `${pixels.width} × ${pixels.height} original pixels. ` : ''}Processed on this device. No AI generation.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="crop-actions"><button className="secondary" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={!pixels || busy} onClick={() => void save()}>{busy && <LoaderCircle className="spin" size={16} />}{detail ? 'Use clasp detail' : 'Apply crop'}</button></div>
  </dialog>;
}
