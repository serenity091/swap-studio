import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, ImagePlus, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { downloadImage, imageSrc, readImage } from '../lib/images';
import { loadImage } from '../lib/library';
import type { ImageAsset, StoredImage } from '../lib/types';
export function ImageFrame({ label, hint, image, onUpload, disabled, loading, onError }: {
  label: string; hint?: string; image?: ImageAsset; onUpload?: (image: ImageAsset) => void;
  disabled?: boolean; loading?: boolean; onError?: (error: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [drag, setDrag] = useState(false);
  async function upload(file?: File) {
    if (!file || disabled || !onUpload) return;
    setReading(true);
    try { onUpload(await readImage(file)); } catch (e) { onError?.((e as Error).message); }
    finally { setReading(false); if (input.current) input.current.value = ''; }
  }
  return <div className={`image-frame ${drag ? 'dragging' : ''}`}>
    <div className="frame-heading"><span>{label}</span><span className="small muted">{image ? `${image.width} × ${image.height}` : 'Awaiting image'}</span></div>
    <div className={`image-well ${image ? 'has-image' : ''}`}
      onDragOver={onUpload ? (e) => { e.preventDefault(); if (!disabled) setDrag(true); } : undefined}
      onDragLeave={() => setDrag(false)} onDrop={onUpload ? (e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files[0]); } : undefined}>
      {image ? <button className="image-zoom" onClick={() => setZoom(true)} aria-label={`Enlarge ${label.toLowerCase()}`}><img src={imageSrc(image)} alt={label} /><span className="zoom-affordance"><ArrowUpRight size={17} /></span></button>
      : <button className="upload-placeholder" disabled={disabled || !onUpload || reading} onClick={() => input.current?.click()}>
        <span className="upload-symbol"><ImagePlus size={24} strokeWidth={1.3} /></span>
        <strong>{onUpload ? `Upload ${label.toLowerCase()}` : label}</strong><span>{hint || (onUpload ? 'Drop an image or browse files' : 'Your image will appear here')}</span>
        {onUpload && <small>JPG, PNG, WebP · up to 10 MB</small>}
      </button>}
      {(reading || loading) && <div className="image-loading"><LoaderCircle className="spin" size={27} /><span>{reading ? 'Reading image' : 'Generating'}</span></div>}
    </div>
    {image && <div className="frame-footer"><span className="truncate small muted">{hint || image.name}</span><div className="icon-actions">{onUpload && <button className="icon-button" aria-label={`Replace ${label.toLowerCase()}`} onClick={() => input.current?.click()} disabled={disabled}><RefreshCw size={16} /></button>}<button className="icon-button" aria-label={`Download ${label.toLowerCase()}`} onClick={() => downloadImage(image, label)}><Download size={16} /></button></div></div>}
    {onUpload && <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label={`Upload ${label.toLowerCase()}`} onChange={e => void upload(e.target.files?.[0])} disabled={disabled} />}
    {zoom && image && <ImageModal image={image} label={label} close={() => setZoom(false)} />}
  </div>;
}
export function ImageModal({ image, label, close }: { image: ImageAsset; label: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="image-dialog" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }} aria-label={label}>
    <div className="dialog-toolbar"><span>{label}</span><div className="icon-actions"><button className="icon-button" aria-label="Download full-size image" onClick={() => downloadImage(image, label)}><Download size={20} /></button><button className="icon-button" aria-label="Close image" onClick={close}><X size={22} /></button></div></div><img src={imageSrc(image)} alt={label} />
  </dialog>;
}
export function StoredThumbnail({ asset, label, onOpen, actionLabel, selected, disabled }: { asset: StoredImage; label: string; onOpen?: (image: ImageAsset) => void; actionLabel?: string; selected?: boolean; disabled?: boolean }) {
  const [image, setImage] = useState<ImageAsset>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true; setError(false); setImage(undefined);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        observer.disconnect();
        void loadImage(asset).then(result => { if (active) setImage(result); }).catch(() => { if (active) setError(true); });
      }
    });
    if (container.current) observer.observe(container.current);
    return () => { active = false; observer.disconnect(); };
  }, [asset.path, attempt]);
  return <div className="stored-image" ref={container}>{image ? <button onClick={() => onOpen?.(image)} disabled={disabled || !onOpen} aria-label={actionLabel || `View ${label}`} aria-pressed={selected}><img src={imageSrc(image)} alt={label} loading="lazy" /></button> : error ? <button className="thumb-error" onClick={() => setAttempt(n => n + 1)}>Image unavailable<br /><small>Click to retry</small></button> : <LoaderCircle className="spin muted" size={20} />}</div>;
}
