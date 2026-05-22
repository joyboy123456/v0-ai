# Firebase backend foundation research

## Sources

- Firebase pricing: https://firebase.google.com/pricing
- Firebase Authentication overview: https://firebase.google.com/docs/auth
- Cloud Storage for Firebase web setup: https://firebase.google.com/docs/storage/web/start
- Firebase Security Rules and Authentication: https://firebase.google.com/docs/rules/rules-and-auth
- Firebase App Hosting overview: https://firebase.google.com/docs/app-hosting
- Google AI Pro subscription benefits: https://gemini.google/us/subscriptions/

## Takeaways

- Firebase Authentication can replace custom login/signup/session identity flows for email/password, Google sign-in, anonymous auth, and other common providers. The app can still verify Firebase ID tokens inside custom Next.js API routes when server-side business logic is required.
- Cloud Storage for Firebase is suitable for user-uploaded and generated images, but creating a default bucket currently requires the Firebase project to be on the pay-as-you-go Blaze plan. Storage rules should be auth-scoped before production use.
- Firebase Security Rules can bind Firestore and Storage access to `request.auth.uid`, which fits this app's future per-user assets and tasks model.
- Firebase App Hosting supports dynamic Next.js apps and deploys through Google Cloud resources such as Cloud Build, Cloud Run, Artifact Registry, Cloud CDN, and Secret Manager. It requires a Blaze-enabled Firebase project.
- Google AI Pro is useful for Gemini/Gemini CLI/Code Assist/Antigravity/Jules and Google account storage, but it is not the same thing as Firebase billing. Firebase infrastructure still uses Firebase/Google Cloud plan limits and billing.

## Fit for this repo

Current repo facts:

- The app is a Next.js 16 App Router project.
- Uploads currently go through `app/api/assets/upload/route.ts`, then `createAsset()` stores records through `lib/server/task-store.ts`.
- `lib/server/task-store.ts` currently uses an in-process Map plus persisted JSON under `data/fashion-mvp-store.json`, and writes uploaded/generated images under `public/generated/**`.
- Existing task APIs run AI workflows, provider routing, retries, throttling, and partial result persistence. Those routes cannot be safely deleted just because Firebase is added.
- There is no existing Firebase config, `.firebaserc`, `firebase.json`, or Firebase dependency.

## Recommended phased approach

1. Foundation only:
   - Add Firebase client config and env keys.
   - Add Auth provider state on the frontend.
   - Gate the workbench behind Google sign-in or anonymous sign-in.
   - Keep existing Next.js API routes for AI generation.

2. Storage migration:
   - Move user uploads and generated result images to Cloud Storage paths scoped by `users/{uid}/...`.
   - Keep API uploads initially so the server can validate image size/type and preserve current asset contracts.
   - Add Storage rules restricting writes to the owning user.

3. Metadata migration:
   - Move assets/tasks metadata from local JSON to Firestore collections scoped by user ID.
   - Update API route handlers to verify Firebase ID tokens and query by `uid`.

4. Deployment:
   - Deploy Next.js with Firebase App Hosting if Blaze billing is acceptable.
   - Store external provider keys in Secret Manager/App Hosting secrets, not public env vars.

## Risks

- Blaze billing is required for App Hosting and Cloud Storage setup in current Firebase docs. Even with free allowances, it requires a billing account.
- Direct client upload to Storage is convenient, but this app has image preflight rules and AI provider size constraints. A server-mediated upload path is safer for MVP.
- Existing demo data is not user-scoped. Adding auth without migrating records can expose mixed-user history unless every list/get route is scoped.
- Long-running AI tasks may be fragile on purely request/response hosting. Existing background `void runTask(taskId)` should be revisited before production deployment.
