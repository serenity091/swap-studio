# Swap Studio

Live site: https://serenity091.github.io/swap-studio/

This deployment uses the public configuration in `firebase/web-config.json` for project `swap-8444c`. `VITE_FIREBASE_CONFIG` can override it. Analytics is not enabled.

A GitHub Pages app for creating fictional adult model identities and swapping bras from mannequin photos onto those identities. React, TypeScript, Vite, Google Gemini API (Nano Banana Pro), and Firebase. No application server is required: users supply their own Google API keys in the browser.

## Workflow

1. Sign in with an account created by the owner in Firebase Authentication.
2. Enter a Google AI Studio API key with access to the configured image model and paid API billing. The app verifies model access without generating a paid image. Verification does not guarantee available billing or quota.
3. **Create identities:** name the identity and upload front/back reference photos. Generate the front first, then the matching back in the same API conversation, including the model's original thought signatures.
4. Review the pair and confirm that the new fictional identity is different and consistent. Only then run the neutral gray front and bare-back prompts.
5. Approve both bases and save the identity. Its reference, identity, and base images are uploaded together. Only approved identities enter the shared identity library.
6. **Bra swap:** select a saved identity and upload the bra's front and back mannequin photos. Optionally use **Crop photo** to tighten framing while retaining all straps and band. **Select clasp** from the front or back is required before generation: include the whole closure and a little band on each side. Generate both views, compare them against the identity, and explicitly approve before saving only the final front/back pair. **Try again with these photos** preserves uploads and starts a fresh draft.

Images are saved as files in Firebase Storage. Firestore holds names, image paths, model/resolution metadata, creator identifiers, and identity links. All signed-in members can see and use the shared library; only a record's creator can write that record or its images. Account passwords are handled by Firebase Authentication, never stored as Firestore documents.

Photo and clasp crops use browser Canvas to copy original pixels into lossless PNGs, without AI generation or upscaling. Originals are retained in the in-memory draft for re-cropping and restoration; clasp selection always uses the original upload. Replacing its source photo clears the old clasp selection. Optional **Remove background** runs IMG.LY ISNet segmentation in a local worker and composites the mannequin and bra onto white at the input resolution. Preview and explicitly apply the result; use **Undo background removal** or **Restore original** to revert. Clasp selection always uses the untouched original upload. Model/runtime assets download from staticimgly.com on first use; image pixels stay on the device during removal. No Gemini request is made. Crop after removal operates on the cleaned photo. Existing completed drafts can still retry saving without regeneration.

Production drafts and conversation context stay in memory only and are lost on reload, sign-out, or closing the tab. The app removes the previous browser-stored key and drafts when you open it. A failed back-view request keeps the finished front and lets the user retry only the missing view. Save retries use the same record ID and file paths; they do not regenerate paid images. Incomplete swap pairs stay as in-memory drafts until both views are ready. Regeneration replaces the current unsaved draft; rejected variants are not archived in the shared library.

## 1. Run locally

Use Node.js 22 or newer.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open the URL printed by Vite. Without Firebase configuration, the setup screen offers **Preview the workspace**. This development-only preview uses a local IndexedDB library and no real accounts. It can use a real Gemini key if you choose to generate, but otherwise lets you inspect the app without API calls. The preview does not exist in production builds.

## 2. Create Firebase services

1. Create a project in [Firebase Console](https://console.firebase.google.com/).
2. Add a **Web app** in Project settings. Copy the public `firebaseConfig` object's values into `VITE_FIREBASE_CONFIG` in `.env.local`, using valid JSON (quoted keys, no `const`, no trailing semicolon).
3. In **Authentication → Sign-in method**, enable **Email/Password**. Firebase manages password hashing and account sessions. Do not create a passwords collection.
4. In **Authentication → Settings → Authorized domains**, add `YOUR_GITHUB_USERNAME.github.io`, your custom domain if used, and `localhost` / `127.0.0.1` for local development. Use only the hostname, not the repository path.
5. Create **Cloud Firestore** in production mode, then publish `firebase/firestore.rules` in its Rules editor.
6. Create **Cloud Storage**, then publish `firebase/storage.rules` in its Rules editor. Cloud Storage currently requires the **Blaze pay-as-you-go plan**, even though some usage may be free. Set a billing budget appropriate to your expected image volume.
7. Configure Storage CORS using the next section. This is required for signed-in image reads.

The Firebase web configuration is public app configuration, safe to include in this client app. It is different from a Gemini key or a Firebase service-account private key. Rules and Firebase Authentication control access. Never include service-account credentials or a shared Gemini key in the repository, build variables, or browser bundle.

**Private access:** public sign-up is disabled in both the UI and the live Firebase project (`client.permissions.disabledUserSignup: true`). Create accounts manually in [Firebase Authentication → Users → Add user](https://console.firebase.google.com/project/swap-8444c/authentication/users). Existing accounts retain access. Every signed-in account can use the shared library. For another Firebase project, set the same [client signup restriction](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config#Permissions); hiding the form alone does not restrict the API. The login page and website source remain publicly served by GitHub Pages, while library data and images require authentication.

### Authenticated Storage downloads and CORS

This app uses Firebase's authenticated `getBlob` requests. It does not publish permanent tokenized image URLs in Firestore.

Copy `firebase/cors.example.json` to `firebase/cors.json` and replace the GitHub origin. An origin has a scheme and hostname, with no `/repository/` suffix. Add your custom domain if applicable. In [Google Cloud Shell](https://shell.cloud.google.com/) or an installed Google Cloud CLI:

```sh
gcloud storage buckets update gs://YOUR_PROJECT.firebasestorage.app --cors-file=firebase/cors.json
```

You can alternatively publish the rules with the Firebase CLI after signing in:

```sh
npx firebase-tools deploy --only firestore:rules,storage --project YOUR_PROJECT_ID
```

## 3. Publish to GitHub Pages

1. Create a repository and push this project to its `main` branch. The existing root-level model photos are ignored and are not bundled or published. Do not commit `node_modules`, `.env.local`, or temporary PDF renders.
2. In the repository, open **Settings → Secrets and variables → Actions → Variables**. Create a repository variable named `FIREBASE_WEB_CONFIG` with the Firebase public config as one JSON object. This contains Firebase's public web API key, **not your Google AI Studio generation key**.
3. Optionally set `GEMINI_MODEL` if Google changes the supported Nano Banana Pro model ID. The default is `gemini-3-pro-image`.
4. In **Settings → Pages**, choose **GitHub Actions** as the source.
5. Push a commit or run **Publish Swap Studio to GitHub Pages** from Actions. The workflow checks the config, runs unit tests, builds, and deploys `dist/`.
6. Open the deployed URL. Sign in with an account created by the owner, connect your personal Gemini key, and test a front/back pair.

Vite uses relative asset paths, so the app works at `https://USERNAME.github.io/REPOSITORY/` as well as a custom domain. There is no server route fallback requirement.

GitHub Pages supports public repos on GitHub Free. Pages from private repos requires an eligible paid plan. GitHub Pages is intended for personal/project sites and has restrictions on commercial SaaS and ecommerce hosting; use another static host if this becomes a commercial service.

## Prompts and Google API behavior

- `src/prompts/identity-front.txt`, `identity-back.txt`, `bare-back.txt`, and `neutral-base.txt` are transcribed from the supplied **BRA SWAP WORKFLOW.pdf**, with whitespace normalized.
- The PDF's sourcing instructions and external Drive link are reference material, not automated actions. The app uses images supplied by the user.
- `swap-front.txt` and `swap-back.txt` were written for this app because the PDF did not contain garment-transfer prompts. Version `swap-v5-identity-framing` assigns each reference one explicit role and spells out closure geometry, visible hardware counts, overlap, flap outline, and stitching. The identity base has priority for the person and composition; mannequin photos control only the bra, following [Google's Nano Banana Pro prompting guidance](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/). This also follows Google's [high-fidelity detail preservation guidance](https://ai.google.dev/gemini-api/docs/image-generation#high-fidelity-detail-preservation). Product fidelity and background preservation are prompting constraints, not pixel masks or guarantees; inspect generated images before use. Use clear original product photos so small hardware is readable. The prompt reads clasp counts from each reference; it does not impose a fixed two-hook design on every bra.
- Prompts are inspectable in the UI and editable as text files in the project.
- All image requests use Google's `generateContent` REST endpoint. Identity creation preserves the returned model parts and thought signatures when continuing from front to back. Bra swaps use separately labeled references (`MODEL_BASE`, `BRA_FRONT`, `BRA_BACK`); the back is a fresh edit with the saved identity front included as `IDENTITY_FRONT`, for identity only. Both requests also include the required `CLASP_DETAIL` crop, labeled with its source view. The front request has four image parts and the back request has five, without prior conversation history. Both swap prompts keep the model base as the sole source of the person, lighting, and plain background. Base preparation edits the approved generated images, not the original person.
- Input pixels are preserved. JPG, PNG, and WebP uploads up to 10 MB each are accepted; combined inline API requests are capped under Google's 20 MB limit. Smaller references may be needed for the multi-turn back view. Generated 4K images may be larger than uploaded references.
- Swap requests explicitly set the aspect ratio and select the generation size from the corresponding identity base. Results with more than 2% aspect-ratio deviation are rejected, retained locally for inspection, and never passed to the next generation or saved. Accepted images are resized to the exact base pixel dimensions to handle preset rounding; this does not verify facial identity. The app requires human approval before saving. Firebase also validates exact output dimensions for v5 swaps.
- Requests have a five-minute timeout. There are no automatic generation retries, since retrying can create additional charges. Stopping a request cannot guarantee cancellation or refund at Google.
- Human approval is required; the app does not claim to automatically verify identity difference or garment fidelity.

## Key storage

Each user's Google key is stored only in `privateKeys/{Firebase uid}`, with owner-only get/write/delete rules and collection listing denied. After sign-in, the app fetches it directly from Firestore (`getDocFromServer`), holds it in memory, and sends generation requests to Google. Keys are not persisted to localStorage, sessionStorage, or IndexedDB. Enter the key once after this update, then other devices load it from your account. **API key connected → Remove key from my account** deletes it from Firebase.

Firebase encrypts stored data at rest; this is not end-to-end encryption. Firebase project administrators can access database contents. The key is never part of shared library records or the public repo. Passwords remain managed by Firebase Authentication. Normal Firebase sign-in persistence is separate from API-key and image storage.

## Library limits and deletion

- Shared limits: **20 identities and 100 swaps**, two final images each, **16 MiB per image** maximum. Larger images are rejected before upload without downsampling; download the result to keep it.
- Maximum live library image bytes: `120 × 2 × 16 MiB = 3.75 GiB`. This leaves room below the bucket's 5 GB-month free allowance. No references, intermediate identities, mannequin photos, or clasp crops are archived.
- Limits are enforced using fixed `librarySlots` reservations and Storage paths (`library/{slot}/{front|back}`). Allocation and record creation are atomic; simultaneous clients cannot claim the same slot. Record IDs remain unique, so a reused slot never changes historical identity links.
- Failed uploads remain visible as unfinished items and occupy a slot. Retry saving the same open draft, or delete the unfinished item. Deletion marks the item first, removes both objects, then atomically removes its record and slot. Failed deletion can be retried. Fixed paths bound orphaned live objects too.
- Creator-only Delete buttons remove records and image files. Download any desired copies first. Deleting an identity leaves existing swaps intact, but that identity cannot be used for new swaps.
- The deployed `US-EAST1` bucket has soft delete disabled so deleted/overwritten images do not accumulate seven days of billable backups. Deletion is permanent. Objects soft-deleted before this setting changed keep their original retention period.
- Firebase Storage **requires Blaze**. The [Cloud Storage free allowance](https://cloud.google.com/storage/pricing#cloud-storage-always-free) is 5 GB-month storage, 5,000 Class A and 50,000 Class B operations/month, and eligible transfer allowances. These are shared regional/project usage allowances; library caps cannot guarantee a $0 bill for download traffic, operations, other data, or Google image generation. Budget alerts are not spending caps.
- New projects must deploy both rulesets and grant the Storage rules service agent permission to read Firestore when prompted by Firebase CLI. Keep bucket object versioning disabled and disable soft delete if permanent deletion is intended.

## Verification

```sh
npm test
npm run build
```

The tests use fake API responses and do not incur Google charges. They check approval gates, reference ordering, conversation continuity, partial-failure retries, and image parsing. The Firebase emulator tests check signed-in reads, creator-only writes, denied anonymous access, and allowed file types. Run them with Java 21 or newer installed:

```sh
npm run test:rules
```

The rule tests use a local `demo-swap-studio` project and do not access your real Firebase project. A live paid generation and a real Firebase sign-in/upload require your configured projects; those cannot be verified before setup.

## References

- [Gemini image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Firebase email/password authentication](https://firebase.google.com/docs/auth/web/password-auth)
- [Firebase authenticated downloads and CORS](https://firebase.google.com/docs/storage/web/download-files)
- [Firebase Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Background removal licensing

This app integrates `@imgly/background-removal` 1.7.0 (IMG.LY, AGPL-3.0). Its license is distributed in `public/licenses/imgly-AGPL-3.0.txt`; upstream source is at https://github.com/imgly/background-removal-js. Complete application source and build instructions are available in this public repository: https://github.com/serenity091/swap-studio. ONNX Runtime is MIT licensed; see `public/licenses/onnxruntime-LICENSE.txt`.
