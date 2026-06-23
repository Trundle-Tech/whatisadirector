# Deploying "What is a Director" to the web (GitHub + Netlify)

The app is already a Vite + React build, so it runs on the web as-is. The Electron
files (`main.cjs`, `preload.js`, `renderer.js`) stay in the repo but are ignored by
the web build. AI calls that need the secret key are proxied through a Netlify
serverless function so the key never ships to the browser.

What was added for the web:
- `netlify.toml` — build config, SPA routing, `/api/*` → functions redirect
- `netlify/functions/vertex.mjs` — server-side Gemini proxy (embed + chat)
- `src/lib/vertex-fallback.ts` — browser bridge now calls `/api/vertex` (mock fallback)
- `.gitignore` — excludes `node_modules/`, `dist/`, and `.env`

A first commit already exists on the `main` branch.

---

## Step 0 (one-time): clear a leftover git lock

The repo was initialized in a sandbox that left a stale lock file. On your Mac:

```bash
cd ~/Desktop/whatisadirector
rm -f .git/index.lock
git status          # should show a clean tree on branch main
```

## Step 1: create the GitHub repo and push (SSH)

**Option A — using the GitHub CLI (simplest):**

```bash
cd ~/Desktop/whatisadirector
gh repo create whatisadirector --public --source=. --remote=origin --push
```

**Option B — manual:** create an empty public repo named `whatisadirector` at
https://github.com/new (do NOT add a README/.gitignore), then:

```bash
cd ~/Desktop/whatisadirector
git remote add origin git@github.com:<your-github-username>/whatisadirector.git
git push -u origin main
```

## Step 2: deploy on Netlify

1. Go to https://app.netlify.com → **Add new site → Import an existing project**.
2. Connect **GitHub** and pick the `whatisadirector` repo.
3. Netlify auto-detects `netlify.toml`, so settings are already correct:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Before the first deploy, add an environment variable:
   - **Site configuration → Environment variables → Add a variable**
   - Key: `VERTEX_API_KEY`
   - Value: *(your Google Gemini/Vertex key — the one from your local `.env`)*
5. Deploy. Netlify gives you a `https://<name>.netlify.app` URL.

## How AI works on the web

- `getSimilarity` and `getVectorGraph` run entirely in the browser (pure math, no key).
- `generateEmbedding` and `chat` POST to `/api/vertex`, which runs server-side with
  `VERTEX_API_KEY`. If that key is missing or the call fails, the app falls back to the
  built-in deterministic mock so it never hard-crashes.

## Notes

- Firebase config is public by design (client SDK) and is already wired with fallbacks.
- Add your Netlify domain to **Firebase Console → Authentication → Settings →
  Authorized domains** so Google/email sign-in works on the live site.
- `.env` is gitignored — your secret key is not in the repo.
