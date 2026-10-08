# Deploying ClinicalBrief

Frontend on **Vercel**, API on **Render**, database and sign-in on the existing **Supabase** project (Sydney).

**Live:** <https://clinicalbrief.vercel.app> (frontend) · <https://clinicalbrief.onrender.com> (API)
Everything below is done by the project owner in their own accounts; no secret goes into git.

```
browser ──> Vercel (Next.js)  ──>  Render (FastAPI, Singapore)  ──>  Supabase Postgres + Auth (Sydney)
                 └──────────── Supabase Auth (sign-in, publishable key only) ────────────┘
```

## 0. Before anything goes live (security)

1. **Reset the Supabase database password** (Supabase → Project Settings → Database → Reset database password).
   The current one was exposed earlier and must not be used for a public deployment. Put the new one in your
   local `clinicalbrief-backend/.env` and, in step 2, in Render.
2. **Roll the Supabase secret key** that was pasted in a chat earlier (Project Settings → API Keys). The app never
   uses a secret key; rolling it just retires the exposed one.
3. **Turn on leaked-password protection** if your plan has it (Authentication → Policies / Passwords).

## 1. GitHub (public repository)

1. Create an empty repository at <https://github.com/new>: name `clinicalbrief`, **Public**, no README, no
   .gitignore, no licence (the project already has them).
2. In the project folder:

```bash
git status                     # check: no .env, .env.local, *.db or uploads/ listed
git add -A
git commit -m "ClinicalBrief: clinical notes into a reviewed, searchable, FHIR-exportable record"
git branch -M main
git remote add origin https://github.com/krishi-chheda/clinicalbrief.git
git push -u origin main
```

The commit runs the secret scan; the push also runs the Postgres test suite and the frontend type check
(about a minute). Git asks you to sign in to GitHub the first time.

## 2. Render (API)

1. <https://dashboard.render.com> → **New** → **Blueprint** → connect the `clinicalbrief` repository.
   Render reads `render.yaml`: a free Python web service in Singapore, root `clinicalbrief-backend`.
2. Render asks for the three secrets:
   - `DATABASE_URL`: Supabase → Connect → **Session pooler** URI, with the **new** password.
   - `SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `CORS_ORIGINS`: put `http://localhost:3000` for now; you replace it in step 4.
   - Only if your Supabase project still uses the legacy shared JWT secret: add `JWT_SECRET` too (most new projects
     use signing keys, which the API fetches itself).
   - **Created the service by hand instead of from the Blueprint?** Then `render.yaml` is not applied: set Root Directory
     `clinicalbrief-backend`, the build and start commands from `render.yaml`, Health Check Path `/`, and every
     variable in its `envVars` (including `PYTHON_VERSION=3.12.10`; Render's default Python is newer). Symptom when it
     is missing: `Could not open requirements file: 'requirements.txt'`.
3. Wait for the deploy, then open `https://<service>.onrender.com/`. It should return `"status": "online"`.

## 3. Vercel (frontend)

1. <https://vercel.com/new> → import the `clinicalbrief` repository.
2. **Root Directory**: `clinicalbrief-frontend` (framework: Next.js, detected automatically).
3. Environment variables (all public values; never a secret key):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the `sb_publishable_…` key
   - `NEXT_PUBLIC_API_URL` = `https://<service>.onrender.com`
4. Deploy. Note the URL, e.g. `https://clinicalbrief.vercel.app`.

`NEXT_PUBLIC_` values are compiled into the JavaScript at build time: after adding or changing one, **Redeploy without
the build cache**. Check: the live bundle must contain the Render URL, not `localhost:8000`.

## 4. Connect them

1. **Render** → the service → Environment → set `CORS_ORIGINS` to the Vercel URL, exactly (no quotes, no trailing slash),
   then **Save, rebuild and deploy**. If the Vercel project is renamed, its URL changes: update this and Supabase.
2. **Supabase** → Authentication → URL Configuration: **Site URL** = the Vercel URL; add it to **Redirect URLs**.

## 5. Check it

- Open the Vercel URL: the landing page and public pages load without signing in.
- Sign in; open **System health** (admin or auditor): **Database: Working**, **Local AI model: Unavailable**
  (expected online, see below), the search index count matches the processed notes.

## 6. Public demo (optional)

1. **Supabase → SQL Editor:** run `clinicalbrief-backend/migrations/0012_public_demo.sql` (adds `patients.is_demo`, the
   `demo` role and the anonymous-sign-in trigger; existing roles keep exactly their access).
2. **Flag the patients** (dry run first, then apply):

```powershell
$env:CLINICALBRIEF_ALLOW_REMOTE_DB = "1"; py -3.12 -m app.cli flag-demo
$env:CLINICALBRIEF_ALLOW_REMOTE_DB = "1"; py -3.12 -m app.cli flag-demo --apply
```

3. **Supabase → Authentication → Rate Limits:** keep anonymous sign-ins low (about 30 per hour per IP).
4. **Supabase → Authentication → Sign In / Providers:** enable **anonymous sign-ins**.
5. **CAPTCHA (recommended, currently off on the live demo):** create a Cloudflare Turnstile widget (hostnames: the
   Vercel domain and `localhost`). Put the **secret** key in Supabase → Authentication → Attack Protection, and the
   **site** key in Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, then redeploy without the build cache. Turning CAPTCHA
   on without the site key in Vercel breaks "Try the demo" (Supabase refuses sign-ins without a token).
6. **Clean-up** (weekly, SQL Editor): `delete from auth.users where is_anonymous and created_at < now() - interval '7 days';`

## What is different online (and said so on the site)

- **Copilot** gives its labelled rule-based answers: the hosted API cannot reach a local model, and the app only
  ever sends evidence to a model on the same machine. Running locally with Ollama still gives model answers.
- **Free-tier sleep**: Render free services sleep after 15 minutes idle; the first request then takes ~30–60 s.
- **Latency**: Render's nearest region (Singapore) is ~100 ms from the Sydney database per round trip, so pages
  are slower than locally.
- **Uploaded files** are kept on the server's disk, which is wiped on redeploy. The note text itself is stored in
  the database, so processing, search and Copilot are unaffected.
- **System health** figures are per process and reset whenever the service restarts or wakes up.
