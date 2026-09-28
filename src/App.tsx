import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleUserRound, FolderOpen, KeyRound, LoaderCircle, LogOut, Plus, RefreshCw, Shirt, Sparkles, Trash2, X } from 'lucide-react';
import { auth, configError, isPreview } from './lib/firebase';
import { AuthGate, Brand, GateLayout, KeyForm, SetupGate } from './components/Gates';
import { BackgroundDialog } from './components/BackgroundDialog';
import { CropDialog } from './components/CropDialog';
import { imageSrc } from './lib/images';
import { ImageFrame, ImageModal, StoredThumbnail } from './components/Images';
import { clearImageCache, loadImage, saveRecord, watchLibrary, deleteRecord, checkCapacity } from './lib/library';
import { localGet, localSet, clearLegacyDrafts } from './lib/local';
import { generateIdentity, prepareBases, identityRecord, generateSwap, swapRecord } from './lib/workflow';
import { completePair, newIdentity, newSwap, type IdentityDraft, type SwapDraft, type ImageAsset, type Pair, type Resolution, type StudioRecord, type StudioUser } from './lib/types';
import { getAccountKey, saveAccountKey } from './lib/account-key';
import { LIBRARY_LIMITS, fullMessage, isReady } from './lib/limits';
import { PROMPTS } from './prompts';

type Drafts = { identity: IdentityDraft; swap: SwapDraft };
export default function App() {
  const [user, setUser] = useState<StudioUser | null>(isPreview ? { uid: 'local-preview', email: 'preview@studio.local' } : null);
  const [loading, setLoading] = useState(Boolean(auth) && !isPreview);
  useEffect(() => {
    if (!auth || isPreview) return;
    return onAuthStateChanged(auth, next => { clearImageCache(); setUser(next); setLoading(false); });
  }, []);
  if (loading) return <div className="loading-screen"><Brand /><LoaderCircle className="spin" /><p>Opening your studio…</p></div>;
  if ((!auth || configError) && !isPreview) return <SetupGate />;
  if (!user) return <AuthGate />;
  return <ConnectedStudio key={user.uid} user={user} />;
}
function ConnectedStudio({ user }: { user: StudioUser }) {
  const [apiKey, setApiKey] = useState('');
  const [entered, setEntered] = useState(false);
  const [loadingKey, setLoadingKey] = useState(!isPreview);
  const [keySettings, setKeySettings] = useState(false);
  const [keyError, setKeyError] = useState('');
  useEffect(() => {
    let active = true;
    // Remove the previous browser-only key. Never silently upload it.
    try { localStorage.removeItem(`swap-studio:gemini:${user.uid}`); } catch { /* Browser storage may be disabled. */ }
    if (!isPreview) void clearLegacyDrafts().catch(e => { if (active) setKeyError((e as Error).message); });
    if (!isPreview) void getAccountKey(user.uid).then(key => {
      if (active) { setApiKey(key); setEntered(Boolean(key)); }
    }).catch(() => { if (active) setKeyError('Could not load your account key. Check your connection and reload, or enter your key below.'); }).finally(() => { if (active) setLoadingKey(false); });
    return () => { active = false; };
  }, [user.uid]);
  async function connect(key: string) {
    await saveAccountKey(user.uid, key);
    setKeyError(''); setApiKey(key); setEntered(true); setKeySettings(false);
  }
  async function forgetKey() {
    try { await saveAccountKey(user.uid, ''); setApiKey(''); setEntered(false); setKeySettings(false); setKeyError(''); }
    catch (e) { setKeyError((e as Error).message); }
  }
  async function logout() {
    if (isPreview) { location.href = location.pathname; return; }
    if (auth) await signOut(auth);
  }
  if (loadingKey) return <div className="loading-screen"><LoaderCircle className="spin" /><p>Loading your account…</p></div>;
  if (!entered) return <GateLayout>{keyError && <p role="alert" className="error">{keyError}</p>}<KeyForm onConnect={connect} /><button className="text-button full" onClick={() => void logout()}>Sign out</button></GateLayout>;
  return <>{keyError && <p role="alert" className="notice error">{keyError}</p>}<Workspace user={user} apiKey={apiKey} onKeySettings={() => setKeySettings(true)} logout={logout} initialNotice="" />{keySettings && <Modal label="API key settings" close={() => setKeySettings(false)}><KeyForm initialKey={apiKey} onConnect={connect} onCancel={() => setKeySettings(false)} />{keyError && <p role="alert" className="error">{keyError}</p>}<button className="text-button full danger" onClick={() => void forgetKey()}>Remove key from my account</button></Modal>}</>;

}
function Modal({ children, close, label }: { children: ReactNode; close: () => void; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="form-dialog" aria-label={label} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><button className="modal-close icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button>{children}</dialog>;
}
function Workspace({ user, apiKey, onKeySettings, logout, initialNotice }: { user: StudioUser; apiKey: string; onKeySettings: () => void; logout: () => Promise<void>; initialNotice: string }) {
  const [tab, setTab] = useState<'identity' | 'swap'>('identity');
  const [draft, setDraft] = useState<IdentityDraft>(newIdentity);
  const [swap, setSwap] = useState<SwapDraft>(newSwap);
  const [hydrated, setHydrated] = useState(false);
  const [records, setRecords] = useState<StudioRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [draftError, setDraftError] = useState('');
  const [approvedIdentity, setApprovedIdentity] = useState(false);
  const [approvedBases, setApprovedBases] = useState(false);
  const [approvedSwap, setApprovedSwap] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  const [comparisonBases, setComparisonBases] = useState<Pair>({});
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState<{ image: ImageAsset; label: string }>();
  const [crop, setCrop] = useState<{ view: 'front' | 'back'; detail: boolean }>();
  const cropSource = crop && (crop.detail ? swap.originals?.[crop.view] || swap.references[crop.view] : swap.references[crop.view]);
  const [backgroundView, setBackgroundView] = useState<'front' | 'back'>();
  const backgroundSource = backgroundView && swap.references[backgroundView];
  const controller = useRef<AbortController | undefined>(undefined);
  const saving = useRef(false);
  const draftKey = `drafts:${user.uid}`;
  useEffect(() => {
    let active = true;
    if (!isPreview) { setHydrated(true); return () => { controller.current?.abort(); }; }
    void localGet<Drafts>(draftKey).then(saved => { if (active && saved) { setDraft(saved.identity); setSwap(saved.swap); } }).catch(() => { if (active) setDraftError('Preview draft recovery is unavailable.'); }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; controller.current?.abort(); };
  }, [draftKey]);
  useEffect(() => { if (isPreview && hydrated) void localSet(draftKey, { identity: draft, swap }).catch(e => setDraftError((e as Error).message)); }, [draft, swap, hydrated, draftKey]);
  useEffect(() => watchLibrary(data => { setRecords(data); setLibraryLoading(false); setLibraryError(''); }, e => { setLibraryError(e.message); setLibraryLoading(false); }), []);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (busy || (!draft.savedId && Boolean(draft.references.front || draft.references.back)) || (!swap.savedId && Boolean(swap.references.front || swap.references.back))) { e.preventDefault(); } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy, draft, swap]);
  const identityRecords = records.filter(r => r.kind === 'identity');
  const identities = identityRecords.filter(isReady);
  const identityFull = identityRecords.length >= LIBRARY_LIMITS.identity && !identityRecords.some(r => r.id === draft.id);
  const swapFull = records.filter(r => r.kind === 'swap').length >= LIBRARY_LIMITS.swap && !records.some(r => r.id === swap.id);
  const swaps = records.filter(r => r.kind === 'swap');
  const selected = identities.find(r => r.id === swap.identityId);
  useEffect(() => {
    let active = true; setComparisonBases({});
    if (selected) void Promise.all([loadImage(selected.assets.front), loadImage(selected.assets.back)]).then(([front, back]) => { if (active) setComparisonBases({ front, back }); }).catch(() => { if (active) setError('Could not load identity images for comparison.'); });
    return () => { active = false; };
  }, [selected?.id]);
  useEffect(() => { setApprovedSwap(false); }, [swap.generated.front, swap.generated.back, swap.id]);
  async function run(action: (signal: AbortSignal) => Promise<unknown>, requiresKey = true) {
    if (saving.current) return;
    if (requiresKey && !apiKey) { onKeySettings(); return; }
    saving.current = true; controller.current = new AbortController(); setError(''); setNotice(''); setShowSource(false); setShowIdentity(false); setBusy('Preparing…');
    try { if (requiresKey) { if (libraryLoading || libraryError) throw new Error('Wait for the library to load before generating.'); await checkCapacity(tab === 'identity' ? 'identity' : 'swap', tab === 'identity' ? draft.id : swap.id); } await action(controller.current.signal); }
    catch (e) { setError((e as Error).message || 'Something went wrong. Your completed images are kept.'); }
    finally { saving.current = false; controller.current = undefined; setBusy(''); }
  }
  const changeTab = (next: 'identity' | 'swap') => { setTab(next); setShowSource(false); setError(''); setNotice(''); };
  const resetIdentity = () => {
    if ((draft.references.front || draft.references.back) && !draft.savedId && !window.confirm('Start a new identity? The current unsaved draft will be removed from this browser.')) return;
    setDraft(newIdentity()); setApprovedIdentity(false); setApprovedBases(false); setShowSource(false); setError(''); setNotice('');
  };
  const resetSwap = () => {
    if ((swap.references.front || swap.references.back) && !swap.savedId && !window.confirm('Start a new swap? The current unsaved draft will be removed from this browser.')) return;
    setSwap({ ...newSwap(), identityId: swap.identityId }); setShowSource(false); setError(''); setNotice('');
  };
  function useIdentity(record: StudioRecord) {
    if ((swap.generated.front || swap.generated.back) && !swap.savedId && !window.confirm('Replace the current unsaved swap with this identity?')) return;
    setSwap({ ...newSwap(), identityId: record.id }); changeTab('swap'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function saveIdentity() {
    await run(async () => {
      setBusy('Saving the approved identity to the shared library…');
      await saveRecord(identityRecord(draft, user, approvedBases));
      setDraft(d => ({ ...d, step: 3, savedId: d.id, frontHistory: undefined }));
      setNotice(isPreview ? 'Identity saved in this browser’s preview library.' : 'Identity saved. Ready for bra swaps.');
    }, false);
  }
  async function performSwap(signal: AbortSignal) {
    if (!selected) throw new Error('Choose an identity from the library first.');
    await generateSwap(swap, selected, apiKey, setSwap, setBusy, signal);
    setNotice('Review both views against the saved identity before saving.');
  }
  async function saveSwap() {
    if (!selected) return;
    await run(async () => {
      setBusy('Saving the approved pair…');
      await saveRecord(swapRecord(swap, selected, user, approvedSwap));
      setSwap(s => ({ ...s, savedId: s.id, frontHistory: undefined }));
      setNotice('Both approved views are saved to the shared library.');
    }, false);
  }
  async function removeRecord(record: StudioRecord) {
    if (!window.confirm(`Permanently delete “${record.name}” and its saved images?${record.kind === 'identity' ? ' Existing swaps will remain, but this identity cannot be used again.' : ''} Download anything you want to keep first.`)) return;
    await run(async () => {
      setBusy('Deleting images…'); await deleteRecord(record, user.uid);
      if (record.id === draft.savedId) { setDraft(newIdentity()); setApprovedIdentity(false); setApprovedBases(false); }
      if (record.id === swap.savedId) setSwap({ ...newSwap(), identityId: swap.identityId });
      if (record.kind === 'identity' && record.id === swap.identityId) setSwap(newSwap());
      setNotice('Deleted. Library space is available again.');
    }, false);
  }
  function retrySwap() {
    setSwap(s => ({ ...newSwap(), identityId: s.identityId, name: s.name, references: s.references, originals: s.originals, beforeBackground: s.beforeBackground, clasp: s.clasp }));
    setApprovedSwap(false); setShowSource(false); setShowIdentity(false); setError(''); setNotice('Ready to generate again using the same photos.');
  }
  const identityPair = draft.step === 0 || showSource ? (draft.step === 2 || draft.step === 3 ? draft.generated : draft.references) : draft.step === 1 ? draft.generated : draft.bases;
  const swapHasOutput = Boolean(swap.generated.front || swap.rejected?.front || swap.rejected?.back);
  const swapPair = showIdentity ? comparisonBases : showSource || !swapHasOutput ? swap.references : { ...swap.generated, ...Object.fromEntries(Object.entries(swap.rejected || {}).filter(([, value]) => value)) };
  if (!hydrated) return <div className="loading-screen"><Brand /><LoaderCircle className="spin" /><p>Restoring your workspace…</p></div>;
  return <div className="studio">
    {isPreview && <div className="preview-banner">LOCAL PREVIEW <span>Accounts and shared storage connect after Firebase setup. Preview saves stay in this browser.</span></div>}
    <header className="topbar"><Brand /><div className="topbar-right"><span className="model-tag"><span className="status-dot" /> Nano Banana Pro</span><button className="header-button" disabled={Boolean(busy)} onClick={onKeySettings}><KeyRound size={15} />{apiKey ? 'API key connected' : 'Connect API key'}</button><span className="header-divider" /><span className="avatar" title={user.email || ''}>{(user.email || 'S')[0].toUpperCase()}</span><button className="icon-button" aria-label="Sign out" title="Sign out" disabled={Boolean(busy)} onClick={() => void logout().catch(() => setError('Could not sign out. Please try again.'))}><LogOut size={16} /></button></div></header>
    <nav className="tabbar" aria-label="Workspace tabs"><div role="tablist" aria-label="Studio tools"><button role="tab" id="identity-tab" aria-controls="identity-panel" aria-selected={tab === 'identity'} className={tab === 'identity' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => changeTab('identity')}><CircleUserRound size={18} />Create identities</button><button role="tab" id="swap-tab" aria-controls="swap-panel" aria-selected={tab === 'swap'} className={tab === 'swap' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => changeTab('swap')}><Shirt size={18} />Bra swap</button></div></nav>
    <main>
      {draftError && <div role="status" className="notice warning">{draftError}</div>}
      {libraryError && <div role="alert" className="notice warning">{libraryError}</div>}
      {error && tab === 'identity' && <div className="notice error" role="alert"><span>{error}</span><button aria-label="Dismiss error" className="icon-button" onClick={() => setError('')}><X size={18} /></button></div>}
      {notice && <div className="notice success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="Dismiss notification" className="icon-button" onClick={() => setNotice('')}><X size={18} /></button></div>}
      {tab === 'identity' ? <section role="tabpanel" id="identity-panel" aria-labelledby="identity-tab">
        <div className="page-heading"><div><h1>Create identity</h1><p>Upload, review, and save a model. Unsaved work is lost when you leave.</p></div><button className="secondary" onClick={resetIdentity} disabled={Boolean(busy)}><Plus size={17} />New identity</button></div>
        {identityFull && <p className="notice error" role="alert">{fullMessage('identity')}</p>}<div className="steps">{['Upload references', 'Review identity', 'Prepare & review bases', 'Save to library'].map((label, i) => <div key={label} className={`step ${draft.step === i ? 'current' : ''} ${draft.step > i ? 'done' : ''}`}><span>{draft.step > i || draft.savedId ? <Check size={14} /> : `0${i + 1}`}</span><p>{label}</p></div>)}</div>
        <div className="workspace-grid"><aside className="control-panel"><span className="eyebrow">{draft.savedId ? 'READY TO USE' : `STEP 0${draft.step + 1}`}</span><h2>{['Start with a reference.', 'Meet your new model.', 'Make it a clean canvas.', 'Added to your library.'][draft.step]}</h2><p className="control-description">{['Upload front and back photos of the same adult model. The new identity will keep the pose and photographic style.', 'Compare both views with the references. Check that this is a different person, and the front and back match.', 'Check the neutral gray front and bare back. The approved face, hair, pose, and lighting should stay consistent.', 'This identity is ready for garment swaps and available in the studio library.'][draft.step]}</p>
          <fieldset disabled={Boolean(busy) || Boolean(draft.savedId)}><label className="field-label">Identity name<input maxLength={80} placeholder="e.g. Studio model 01" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label><ResolutionField value={draft.resolution} disabled={draft.step > 0} onChange={resolution => setDraft(d => ({ ...d, resolution }))} /></fieldset>
          {draft.step === 0 && <button className="primary full" disabled={Boolean(busy) || identityFull || libraryLoading || !completePair(draft.references) || !draft.name.trim()} onClick={() => void run(signal => generateIdentity(draft, apiKey, setDraft, setBusy, signal))}><Sparkles size={17} />Generate identity <ArrowRight size={17} /></button>}
          {draft.step === 1 && <>{completePair(draft.generated) ? <><label className="approval"><input type="checkbox" checked={approvedIdentity} onChange={e => setApprovedIdentity(e.target.checked)} disabled={Boolean(busy)} /><span>I approve this different fictional identity and its matching front and back views.</span></label><button className="primary full" disabled={!approvedIdentity || Boolean(busy)} onClick={() => void run(signal => prepareBases({ ...draft, identityApproved: true }, apiKey, setDraft, setBusy, signal))}>Approve & prepare bases <ArrowRight size={17} /></button></> : <button className="primary full" disabled={Boolean(busy)} onClick={() => void run(signal => generateIdentity(draft, apiKey, setDraft, setBusy, signal))}><RefreshCw size={16} />Complete identity pair</button>}<button className="secondary full" disabled={Boolean(busy)} onClick={() => { setApprovedIdentity(false); void run(signal => generateIdentity({ ...draft, generated: {}, frontHistory: undefined }, apiKey, setDraft, setBusy, signal)); }}><RefreshCw size={16} />Regenerate both views</button></>}
          {draft.step === 2 && <>{completePair(draft.bases) ? <><label className="approval"><input type="checkbox" checked={approvedBases} onChange={e => setApprovedBases(e.target.checked)} disabled={Boolean(busy)} /><span>I approve these bases. The model identity and pose are preserved.</span></label><button className="primary full" disabled={!approvedBases || !draft.name.trim() || Boolean(busy) || identityFull} onClick={() => void saveIdentity()}><Check size={17} />Approve & save identity</button></> : <button className="primary full" disabled={Boolean(busy)} onClick={() => void run(signal => prepareBases(draft, apiKey, setDraft, setBusy, signal))}><RefreshCw size={16} />Complete base pair</button>}<button className="secondary full" disabled={Boolean(busy)} onClick={() => { setApprovedBases(false); void run(signal => prepareBases({ ...draft, bases: {} }, apiKey, setDraft, setBusy, signal)); }}><RefreshCw size={16} />Regenerate bases</button></>}
          {draft.savedId && <><div className="saved-status"><CheckCircle2 size={20} />Identity saved</div><button className="primary full" onClick={() => { const record = identities.find(r => r.id === draft.savedId); if (record) useIdentity(record); }} disabled={!identities.some(r => r.id === draft.savedId)}>Use in a bra swap <ArrowRight size={17} /></button></>}
          <PromptDetails kind="identity" />
        </aside><div className="canvas-panel"><div className="canvas-header"><div><span className="eyebrow">{draft.step === 0 ? 'MODEL REFERENCES' : showSource ? (draft.step >= 2 ? 'APPROVED IDENTITY' : 'ORIGINAL REFERENCES') : draft.step === 1 ? 'NEW IDENTITY' : 'GARMENT BASES'}</span><span className="canvas-subtitle">Front & back</span></div>{draft.step > 0 && <ViewToggle value={showSource} onChange={setShowSource} sourceLabel={draft.step >= 2 ? 'Identity' : 'References'} />}</div>
          <div className="image-pair">{(['front', 'back'] as const).map(view => <ImageFrame key={view} label={`${view === 'front' ? 'Front' : 'Back'} view`} image={identityPair[view]} hint={draft.step === 0 ? `Reference ${view}` : !showSource && draft.step >= 2 ? (view === 'front' ? 'Neutral gray base' : 'Bare-back base') : undefined} onUpload={draft.step === 0 ? image => setDraft(d => ({ ...d, references: { ...d.references, [view]: image } })) : undefined} disabled={Boolean(busy)} loading={Boolean(busy) && !showSource && !identityPair[view]} onError={setError} />)}</div>
          <CanvasStatus busy={busy} canCancel={!busy.startsWith('Saving') && !busy.startsWith('Deleting')} onCancel={() => controller.current?.abort()} label={draft.step === 0 ? 'Upload both views to begin. Your references stay unchanged.' : draft.savedId ? 'Approved and saved to the library.' : 'Select an image to inspect it at full size.'} />
        </div></div>
        <Library title="Identity library" subtitle="Only the approved front and back are saved." records={identityRecords} limit={LIBRARY_LIMITS.identity} uid={user.uid} onDelete={record => void removeRecord(record)} loading={libraryLoading} onOpen={(image, label) => setZoom({ image, label })} onUse={useIdentity} disabled={Boolean(busy)} empty="Your first approved identity will appear here." />
      </section> : <section role="tabpanel" id="swap-panel" aria-labelledby="swap-tab">
        <div className="page-heading"><div><h1>Bra swap</h1><p>Choose a model and upload both views of your bra.</p></div><button className="secondary" disabled={Boolean(busy)} onClick={resetSwap}><Plus size={17} />New swap</button></div>
        {swapFull && <p className="notice error" role="alert">{fullMessage('swap')}</p>}<section className="identity-picker" aria-label="Choose an identity"><h2>1. Choose a model</h2>
          {libraryLoading ? <p role="status">Loading identities…</p> : identities.length ? <div className="identity-options">{identities.map(record => <div key={record.id} className={`identity-option ${record.id === swap.identityId ? 'is-selected' : ''}`}><StoredThumbnail asset={record.assets.front} label={record.name} actionLabel={`Select ${record.name}`} selected={record.id === swap.identityId} disabled={Boolean(busy) || Boolean(swap.generated.front)} onOpen={() => setSwap(s => ({ ...s, identityId: record.id }))} /><div className="identity-option-label"><span>{record.name}</span>{record.id === swap.identityId && <Check size={16} aria-label="Selected" />}</div></div>)}</div> : <p>No identities yet. <button className="text-button" onClick={() => changeTab('identity')}>Create one</button></p>}
        </section>
        <div className="workspace-grid swap-grid"><aside className="control-panel"><h2>{selected?.name || 'Selected model'}</h2>
          {selected ? <div className="identity-mini-pair"><StoredThumbnail asset={selected.assets.front} label={`${selected.name} front base`} onOpen={image => setZoom({ image, label: `${selected.name} · Front base` })} /><StoredThumbnail asset={selected.assets.back} label={`${selected.name} back base`} onOpen={image => setZoom({ image, label: `${selected.name} · Back base` })} /></div> : <div className="no-identity"><CircleUserRound size={25} /><p>{identities.length ? 'Click a model photo above.' : 'Create and approve an identity first.'}</p>{!identities.length && <button className="text-button" onClick={() => changeTab('identity')}><ArrowLeft size={14} />Create an identity</button>}</div>}
          <fieldset disabled={Boolean(busy) || Boolean(swap.generated.front)}><label className="field-label">Bra name (optional)<input maxLength={80} placeholder="e.g. Red lace bra" value={swap.name} onChange={e => setSwap(s => ({ ...s, name: e.target.value }))} /></label><p className="save-note">Output dimensions match the identity.{selected && <><br />Front: {selected.assets.front.width} × {selected.assets.front.height}<br />Back: {selected.assets.back.width} × {selected.assets.back.height}</>}</p></fieldset>
          {!swap.savedId && !completePair(swap.generated) && <button className="primary full" disabled={Boolean(busy) || swapFull || libraryLoading || !selected || !completePair(swap.references) || !swap.clasp} onClick={() => void run(performSwap)}>{busy ? <><LoaderCircle className="spin" size={17} />Working…</> : <><Sparkles size={17} />{swap.generated.front ? 'Complete back view' : 'Generate bra swap'}<ArrowRight size={17} /></>}</button>}
          {!swap.savedId && completePair(swap.generated) && <><label className="approval"><input type="checkbox" checked={approvedSwap} onChange={e => setApprovedSwap(e.target.checked)} disabled={Boolean(busy)} /><span>I checked both views: identity, pose, framing, and bra are correct.</span></label><button className="primary full" disabled={!approvedSwap || Boolean(busy) || swapFull} onClick={() => void saveSwap()}><Check size={17} />Approve & save swap</button></>}
          {swapHasOutput && <button className="secondary full" disabled={Boolean(busy)} onClick={retrySwap}>Try again with these photos</button>}
          {!swap.savedId && !completePair(swap.generated) && !swap.clasp && <p className="save-note">Select a clasp detail below before generating.</p>}
          {error && <div className="notice error swap-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" className="icon-button" onClick={() => setError('')}><X size={18} /></button></div>}
          {busy && <p className="save-note" role="status">{busy}</p>}
          {swap.savedId && <div className="saved-status"><CheckCircle2 size={20} />Both views saved</div>}
          <p className="save-note">Review both views before saving. Unsaved work is lost when you leave.</p><PromptDetails kind="swap" />
        </aside><div className="canvas-panel"><div className="canvas-header"><div><span className="eyebrow">{showIdentity ? 'Saved identity' : swapHasOutput && !showSource ? (swap.savedId ? 'Saved result' : 'Result · review required') : '2. Upload your bra'}</span><span className="canvas-subtitle">Front & back</span></div>{swapHasOutput && <div className="swap-compare-controls"><button className="text-button" aria-pressed={showIdentity} disabled={!completePair(comparisonBases)} onClick={() => { setShowIdentity(v => !v); setShowSource(false); }}>Compare identity</button><ViewToggle inactive={showIdentity} value={showSource} onChange={value => { setShowSource(value); setShowIdentity(false); }} sourceLabel="References" /></div>}</div>
          <div className="image-pair">{(['front', 'back'] as const).map(view => <ImageFrame key={view} label={`${view === 'front' ? 'Front' : 'Back'} view`} image={swapPair[view]} hint={showIdentity ? 'Saved identity · unchanged' : !showSource && swap.rejected?.[view] ? 'Rejected framing · not saved' : !swapHasOutput || showSource ? `Bra on mannequin · ${view}` : selected?.name} onUpload={!swapHasOutput ? image => setSwap(s => ({ ...s, references: { ...s.references, [view]: image }, originals: { ...s.originals, [view]: image }, beforeBackground: { ...s.beforeBackground, [view]: undefined }, clasp: s.clasp?.view === view ? undefined : s.clasp })) : undefined} onCrop={!swapHasOutput && swap.references[view] ? () => setCrop({ view, detail: false }) : undefined} onClasp={!completePair(swap.generated) && (!swap.generated.front || showSource) && swap.references[view] ? () => setCrop({ view, detail: true }) : undefined} onRemoveBackground={!swapHasOutput && swap.references[view] ? () => setBackgroundView(view) : undefined} onUndoBackground={!swapHasOutput && swap.beforeBackground?.[view] ? () => setSwap(s => ({ ...s, references: { ...s.references, [view]: s.beforeBackground?.[view] }, beforeBackground: { ...s.beforeBackground, [view]: undefined } })) : undefined} onRestore={!swapHasOutput && swap.originals?.[view] && swap.originals[view] !== swap.references[view] ? () => setSwap(s => ({ ...s, references: { ...s.references, [view]: s.originals?.[view] }, beforeBackground: { ...s.beforeBackground, [view]: undefined } })) : undefined} onError={setError} disabled={Boolean(busy)} loading={Boolean(busy) && !showSource && !swapPair[view]} />)}</div>
          <div className="clasp-detail"><div><h3>3. Clasp detail <span className="small muted">Required</span></h3><p className="small muted">Select the whole closure from the front or back photo, including a little band on both sides.</p></div>{swap.clasp && <button className="clasp-preview" aria-label="Enlarge clasp detail" onClick={() => setZoom({ image: swap.clasp!.image, label: `Clasp detail · ${swap.clasp!.view}` })}><img src={imageSrc(swap.clasp.image)} alt={`Clasp detail from ${swap.clasp.view} photo`} /></button>}</div>
          <CanvasStatus busy={busy} canCancel={!busy.startsWith('Saving') && !busy.startsWith('Deleting')} onCancel={() => controller.current?.abort()} label={swap.savedId ? 'Both views are saved. Download or start a new garment.' : 'Use clear mannequin photos of the same bra from both sides.'} />
        </div></div><Library title="Swap library" subtitle="Only final front and back images are saved." records={swaps} limit={LIBRARY_LIMITS.swap} uid={user.uid} onDelete={record => void removeRecord(record)} loading={libraryLoading} onOpen={(image, label) => setZoom({ image, label })} disabled={Boolean(busy)} empty="Your completed bra swaps will appear here." />
      </section>}
    </main>
    {backgroundView && backgroundSource && <BackgroundDialog image={backgroundSource} close={() => setBackgroundView(undefined)} onSave={image => setSwap(s => ({ ...s, originals: { ...s.originals, [backgroundView]: s.originals?.[backgroundView] || backgroundSource }, beforeBackground: { ...s.beforeBackground, [backgroundView]: backgroundSource }, references: { ...s.references, [backgroundView]: image } }))} />}
    {crop && cropSource && <CropDialog image={cropSource} detail={crop.detail} close={() => setCrop(undefined)} onSave={image => setSwap(s => crop.detail ? { ...s, clasp: { image, view: crop.view } } : { ...s, originals: { ...s.originals, [crop.view]: s.originals?.[crop.view] || cropSource }, references: { ...s.references, [crop.view]: image } })} />}
    {zoom && <ImageModal image={zoom.image} label={zoom.label} close={() => setZoom(undefined)} />}
  </div>;
}
function ResolutionField({ value, onChange, disabled }: { value: Resolution; onChange: (v: Resolution) => void; disabled?: boolean }) {
  return <label className="field-label">Output size<div className="select-wrap"><select value={value} onChange={e => onChange(e.target.value as Resolution)} disabled={disabled}><option value="1K">1K · Standard</option><option value="2K">2K · High detail</option><option value="4K">4K · Maximum detail</option></select><ChevronDown size={16} /></div></label>;
}
function ViewToggle({ value, onChange, sourceLabel, inactive = false }: { value: boolean; onChange: (v: boolean) => void; sourceLabel: string; inactive?: boolean }) {
  return <div className="view-toggle" aria-label="Compare images"><button aria-pressed={!value && !inactive} className={!value && !inactive ? 'selected' : ''} onClick={() => onChange(false)}>Generated</button><button aria-pressed={value && !inactive} className={value && !inactive ? 'selected' : ''} onClick={() => onChange(true)}>{sourceLabel}</button></div>;
}
function CanvasStatus({ busy, label, onCancel, canCancel }: { busy: string; label: string; onCancel: () => void; canCancel: boolean }) {
  return <div className={`canvas-status ${busy ? 'working' : ''}`} role="status" aria-live="polite">{busy ? <><LoaderCircle className="spin" size={17} /><span>{busy}<small>This can take a few minutes. Keep this tab open.</small></span>{canCancel && <button className="text-button" onClick={onCancel}>Stop</button>}</> : <><span className="status-dot" /><span>{label}</span></>}</div>;
}
function PromptDetails({ kind }: { kind: 'identity' | 'swap' }) {
  const options = kind === 'identity' ? [{ key: 'identityFront', label: 'Identity · Front' }, { key: 'identityBack', label: 'Identity · Back' }, { key: 'neutralBase', label: 'Neutral front base' }, { key: 'bareBack', label: 'Bare-back base' }] : [{ key: 'swapFront', label: 'Bra swap · Front' }, { key: 'swapBack', label: 'Bra swap · Back' }];
  const [key, setKey] = useState(options[0].key);
  return <details className="prompt-details"><summary>View workflow prompts <ChevronDown size={14} /></summary><select aria-label="Prompt to inspect" value={key} onChange={e => setKey(e.target.value)}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select><p className="small muted">{kind === 'identity' ? 'From your BRA SWAP WORKFLOW document.' : 'Garment transfer prompts for this workflow.'}</p><pre>{PROMPTS[key as keyof typeof PROMPTS]}</pre></details>;
}
function Library({ title, subtitle, records, limit, uid, loading, onOpen, onUse, onDelete, empty, disabled }: { title: string; subtitle: string; records: StudioRecord[]; limit: number; uid: string; loading: boolean; onOpen: (image: ImageAsset, label: string) => void; onUse?: (record: StudioRecord) => void; onDelete: (record: StudioRecord) => void; empty: string; disabled: boolean }) {
  return <section className="library"><div className="library-heading"><div><h2>{title}<span className="count">{records.length} / {limit}</span></h2><p>{subtitle} Delete an item when full.</p></div></div>{loading ? <div className="empty-library"><LoaderCircle className="spin" /><p>Loading the library…</p></div> : !records.length ? <div className="empty-library"><FolderOpen size={24} strokeWidth={1.3} /><p>{empty}</p></div> : <div className="library-grid">{records.map(record => <article className="library-card" key={record.id}>
    {isReady(record) ? <div className="library-pair">{(['front', 'back'] as const).map(view => <div key={view}><StoredThumbnail asset={record.assets[view]} label={`${record.name} ${view}`} onOpen={image => onOpen(image, `${record.name} · ${view}`)} /><span>{view.toUpperCase()}</span></div>)}</div> : <div className="empty-library"><p>{record.state === 'deleting' ? 'Deletion unfinished. Click Delete to finish.' : 'Save unfinished. Retry from the open draft, or delete to free this space.'}</p></div>}
    <div className="library-card-info"><div><h3>{record.name}</h3><p>{record.identityName ? `${record.identityName} · ` : ''}{record.resolution} · {new Date(record.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p><span className="small muted">By {record.ownerName}</span></div><div className="library-actions">{onUse && isReady(record) && <button className="icon-button use-identity" aria-label={`Use ${record.name} in a bra swap`} disabled={disabled} onClick={() => onUse(record)}><ArrowRight size={18} /></button>}{record.ownerId === uid && <button className="icon-button danger" aria-label={`Delete ${record.name}`} title="Delete permanently" disabled={disabled} onClick={() => onDelete(record)}><Trash2 size={18} /></button>}</div></div></article>)}</div>}</section>;
}
