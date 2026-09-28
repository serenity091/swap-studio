// Run through: npm run test:rules (requires Firestore and Storage emulators).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';
let env: RulesTestEnvironment;
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const record = (uid: string, id: string) => ({ id, kind: 'identity', name: 'Test model', ownerId: uid, ownerName: 'Tester', createdAt: Date.now(), model: 'gemini-3-pro-image', resolution: '2K', promptVersion: 'workflow-v1', identityId: '', identityName: '', assets: Object.fromEntries(['front', 'back', 'referenceFront', 'referenceBack', 'identityFront', 'identityBack'].map(slot => [slot, { path: `users/${uid}/${id}/${slot}`, name: 'test.png', mimeType: 'image/png', width: 900, height: 1200 }])) });
describe.skipIf(!enabled)('Firebase shared-library rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-swap-studio', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firebase/firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: 9199, rules: readFileSync('firebase/storage.rules', 'utf8') } });
  });
  afterAll(async () => { await env?.cleanup(); });
  it('allows a creator to save and another member to read, but blocks outsiders and overwrites', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    const guest = env.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(alice, 'records', 'model-a'), record('alice', 'model-a')));
    await assertSucceeds(getDoc(doc(bob, 'records', 'model-a')));
    await assertFails(getDoc(doc(guest, 'records', 'model-a')));
    await assertFails(setDoc(doc(bob, 'records', 'model-a'), record('bob', 'model-a')));
    await assertFails(setDoc(doc(alice, 'records', 'spoofed'), record('bob', 'spoofed')));
    await assertFails(setDoc(doc(alice, 'records', 'secret'), { ...record('alice', 'secret'), apiKey: 'should-not-be-stored' }));
    await assertFails(setDoc(doc(alice, 'users', 'alice'), { password: 'should-not-be-stored' }));
  });
  it('rejects incomplete assets and references outside the creator path', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const incomplete = record('alice', 'incomplete');
    delete incomplete.assets.back;
    await assertFails(setDoc(doc(alice, 'records', 'incomplete'), incomplete));
    const badPath = record('alice', 'bad-path');
    badPath.assets.front.path = 'users/bob/other/front';
    await assertFails(setDoc(doc(alice, 'records', 'bad-path'), badPath));
  });
  it('validates saved clasp details and keeps legacy swaps compatible', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(alice, 'records', 'clasp-model'), record('alice', 'clasp-model')));
    const swap = { ...record('alice', 'clasp-swap'), kind: 'swap', identityId: 'clasp-model', promptVersion: 'swap-v4-clasp-detail' };
    delete swap.assets.identityFront; delete swap.assets.identityBack;
    await assertFails(setDoc(doc(alice, 'records', 'clasp-swap'), swap));
    swap.assets.claspBack = { ...swap.assets.back, path: 'users/alice/clasp-swap/claspBack' };
    await assertSucceeds(setDoc(doc(alice, 'records', 'clasp-swap'), swap));
    swap.assets.claspBack.path = 'users/bob/clasp-swap/claspBack';
    await assertFails(setDoc(doc(alice, 'records', 'clasp-swap'), swap));
    delete swap.assets.claspBack;
    await assertSucceeds(setDoc(doc(alice, 'records', 'clasp-swap'), { ...swap, promptVersion: 'swap-v3-product-fidelity' }));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await assertSucceeds(uploadBytes(ref(env.authenticatedContext('alice').storage(), 'users/alice/clasp-swap/claspBack'), bytes, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(), 'users/alice/clasp-swap/claspBack'), bytes, { contentType: 'image/png' }));
  });
  it('limits image reads to members and image writes to the uploader', async () => {
    const alice = env.authenticatedContext('alice').storage();
    const bob = env.authenticatedContext('bob').storage();
    const guest = env.unauthenticatedContext().storage();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await assertSucceeds(uploadBytes(ref(alice, 'users/alice/model-a/front'), bytes, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ref(bob, 'users/alice/model-a/front')));
    await assertFails(getBytes(ref(guest, 'users/alice/model-a/front')));
    await assertFails(uploadBytes(ref(bob, 'users/alice/model-a/front'), bytes, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(alice, 'users/alice/model-a/back'), bytes, { contentType: 'text/html' }));
  });
});
