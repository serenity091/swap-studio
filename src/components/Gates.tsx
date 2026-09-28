import { useState, type FormEvent, type ReactNode } from 'react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { auth, configError, isPreview } from '../lib/firebase';
import { validateKey } from '../lib/gemini';
export function Brand() { return <div className="brand">Bra swap</div>; }
export function GateLayout({ children }: { children: ReactNode }) {
  return <div className="gate"><main className="gate-content"><section className="gate-card">{children}</section></main></div>;
}
export function SetupGate() {
  return <GateLayout><span className="eyebrow">WORKSPACE SETUP</span><h2>Connect your studio.</h2><p>The app is ready for a Firebase project. Add the web app configuration, enable email sign-in, and publish the included database and storage rules.</p><div className="note">{configError || 'Firebase is not connected yet.'}<br />Follow the setup guide in the project’s README.</div>{import.meta.env.DEV && <a className="button primary full" href="?preview=1">Preview the workspace <ArrowRight size={17} /></a>}<p className="small muted">Firebase handles accounts and the shared library. Each user supplies their own Google AI Studio API key.</p></GateLayout>;
}
export function AuthGate() {
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!auth) return; setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email, password);
      else { await sendPasswordResetEmail(auth, email); setNotice('If an account exists, a reset link has been sent.'); }
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'auth/invalid-credential' ? 'The email or password is incorrect.' : code === 'auth/too-many-requests' ? 'Too many attempts. Please try again later.' : 'Could not sign in. Check your email, password, and connection.');
    } finally { setBusy(false); }
  }
  return <GateLayout>
    <h2>{mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
    <p>{mode === 'reset' ? 'Enter your account email.' : 'Private workspace.'}</p>
    <form onSubmit={submit}>
      <label className="field-label">Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} /></label>
      {mode !== 'reset' && <label className="field-label">Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
      <button className="primary full" disabled={busy}>{busy && <LoaderCircle className="spin" size={18} />}{mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
    </form>
    <div className="gate-links"><button disabled={busy} onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setError(''); setNotice(''); }}>{mode === 'login' ? 'Forgot password?' : 'Back to sign in'}</button></div>
  </GateLayout>;
}
export function KeyForm({ initialKey = '', onConnect, onCancel }: { initialKey?: string; onConnect: (key: string, remember: boolean) => void; onCancel?: () => void }) {
  const [key, setKey] = useState(initialKey); const [remember, setRemember] = useState(true); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await validateKey(key); onConnect(key.trim(), remember); }
    catch (e) { setError((e as Error).name === 'TimeoutError' ? 'Could not verify this key. Check your connection and retry.' : (e as Error).message); }
    finally { setBusy(false); }
  }
  return <><span className="gate-icon"><KeyRound size={22} /></span><span className="eyebrow">GOOGLE AI STUDIO</span><h2>Connect your API key.</h2><p>Your key powers image generation with Nano Banana Pro. Generated images are billed to your Google project.</p><form onSubmit={submit}><label className="field-label">API key<div className="password-field"><input type={show ? 'text' : 'password'} aria-label="Google API key" value={key} onChange={e => setKey(e.target.value)} placeholder="Enter your Google API key" autoComplete="off" spellCheck={false} required disabled={busy} /><button type="button" className="icon-button" aria-label={show ? 'Hide API key' : 'Show API key'} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label><label className="check-row"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Remember on this browser</span></label><p className="small muted">Saved only on this device, never in the shared library. Use this on a trusted device.</p>{error && <p role="alert" className="error">{error}</p>}<button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}{busy ? 'Checking access…' : 'Connect & open studio'}</button></form><a className="text-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a key in Google AI Studio ↗</a>{onCancel && <button className="text-button full" onClick={onCancel}>Cancel</button>}{isPreview && !onCancel && <button className="text-button full" onClick={() => onConnect('', false)}>Explore without generating</button>}</>;
}
