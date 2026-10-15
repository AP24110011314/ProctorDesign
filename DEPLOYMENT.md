# ProctoX Production Deployment (Render + Vercel, free tiers)

Target: Django API on Render (Gunicorn + PostgreSQL), React SPA on Vercel.
No code changes are needed at deploy time — everything is env-driven.
Deployment-only additions in this change: WhiteNoise, `dj-database-url`,
Cloudinary storage, `render.yaml`, `ensure_admin` + `auto_submit_expired`
management commands, the CRON-gated sweep endpoint, and lazy deadline
enforcement (Celery stays working locally; production does not need it).

## 0. What the free tier means (read first)

- **No Render Shell** → the admin is created by `python manage.py ensure_admin`
  during the build (reads `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD`,
  skips if the user exists). Re-running is safe.
- **No background worker** → Celery/beat do NOT run in production
  (`CELERY_ENABLED=False`). The exam deadline still holds server-side
  (SRS NFR-14) two ways: (a) every student touch of an attempt (fetch,
  autosave, submit, results, flag ingest, reference photo) lazily
  auto-submits past `end_time`; (b) `POST /api/system/sweep/auto-submit/`
  (secret-gated) is pinged every minute by cron-job.org as a backstop.
- **Ephemeral disk** → reference photos + proctoring thumbnails go to
  Cloudinary in production (free tier is enough; thumbnails stay ≤ 2 MB,
  stills only, never video per NFR-10). Local disk is dev-only (`DEBUG=True`).
- **Sleep on idle** → the free web service spins down after ~15 min idle;
  the first request takes ~30–60 s (cold start). This is normal — see the
  smoke test below. `GET /api/health/` is the wake-up + monitor URL
  (public, no auth, no DB query).

## 1. Push to GitHub

```bash
git add -A && git commit -m "..." && git push origin main
```

## 2. Render backend (via Blueprint)

1. Render dashboard → **New → Blueprint** → select the `ProctorDesign` repo
   (uses `render.yaml` at the repo root).
2. It creates **`proctox-db`** (Postgres, free) and **`proctox-backend`**
   (Python web service, `Root Directory = backend`):
   - Build: `pip install -r requirements.txt && python manage.py
     collectstatic --noinput && python manage.py migrate && python manage.py ensure_admin`
   - Start: `gunicorn config.wsgi:application`
   - Health check: `/api/health/`
3. Set the `sync: false` (secret/manual) env vars in the dashboard —
   first deploy first, Vercel URL later (step 4):

| Var | Where the value comes from | Example |
| --- | --- | --- |
| `SECRET_KEY` | Auto-generated (`generateValue`) — leave it | — |
| `DEBUG` | Fixed `False` in Blueprint | `False` |
| `DATABASE_URL` | Auto-wired from `proctox-db` — leave it | — |
| `CORS_ALLOWED_ORIGINS` | **Your Vercel URL** (step 4), no trailing slash | `https://proctox.vercel.app` |
| `CSRF_TRUSTED_ORIGINS` | **Same Vercel URL**, no trailing slash | `https://proctox.vercel.app` |
| `CRON_SECRET` | Auto-generated — **copy it** for step 5 | `openssl rand -hex 32` equivalent |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary dashboard (free account) → API keys | — |
| `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Pick them (e.g. `admin@example.edu` + strong password) | — |
| `ALLOWED_HOSTS` | Leave empty — Render hostname auto-accepted | — |
| `CELERY_ENABLED` | Fixed `False` | `False` |

4. Deploy. Open `https://<your-service>.onrender.com/api/health/` → expect
   `{"status": "healthy", ...}` (first hit may take ~60 s: cold start).

Dashboard alternative (no Blueprint): same values by hand — Root Directory
`backend`, build/start commands as above, add a Postgres instance and copy
its Internal Connection String into `DATABASE_URL`.

## 3. Vercel frontend

1. Vercel → **Add New Project** → import the repo → **Root Directory =
   `frontend`**, Framework Preset **Vite**, Build `npm run build`, Output `dist`
   (defaults — `frontend/vercel.json` already handles SPA routing).
2. Environment variable (Production + Preview):
   - `VITE_API_BASE_URL=https://<your-service>.onrender.com/api`
     (your Render URL + `/api`, **no trailing slash**).
3. Deploy → note the URL, e.g. `https://proctox.vercel.app`.

## 4. Point the backend at the frontend (CORS/CSRF)

Back in the Render service → Environment → set **both** to the exact Vercel
URL with **no trailing slash**, then Save (triggers redeploy):

```
CORS_ALLOWED_ORIGINS=https://proctox.vercel.app
CSRF_TRUSTED_ORIGINS=https://proctox.vercel.app
```

Mismatches to avoid: trailing `/` (rejected), `http://` instead of
`https://`, or the Render URL itself (that is the API, not the origin).

## 5. External pinger for the sweep (cron-job.org, free)

Without a worker, the lazy check covers active students; the pinger covers
abandoned attempts (student closes the tab at expiry).

1. cron-job.org → Create cronjob:
   - URL: `https://<your-service>.onrender.com/api/system/sweep/auto-submit/`
   - Schedule: **every 1 minute**. Request method: **POST**.
   - Request header: `X-CRON-SECRET: <your CRON_SECRET from step 2>`
     (or append `?secret=<CRON_SECRET>` to the URL instead).
2. Expected response: `200 {"auto_submitted": <n>}`. `403` means the secret
   is wrong/missing (or `CRON_SECRET` is unset on Render) — the endpoint
   stays locked rather than running open.

## 6. Smoke-test checklist (in order)

- [ ] `GET /api/health/` → 200 (allow ~60 s on first hit: cold start).
- [ ] Register: `POST /api/auth/register/` with `password_confirm` + `role`
      (or use the Vercel `/register` page) → 201.
- [ ] Login with **email** + password → 200, tokens returned.
- [ ] Camera check: open an exam SystemCheck page on the Vercel URL (HTTPS —
      `getUserMedia` requires it; localhost also allowed) → webcam preview live.
- [ ] Faculty: create + publish a short exam (e.g. 2 questions, 5 min).
- [ ] Student: start it, answer one question (autosave → 200), submit → 200.
- [ ] Auto-submit: start another attempt on a 1-minute exam, wait past expiry,
      then autosave/fetch/submit → response reports `auto_submitted: true`
      and the attempt reads `auto_submitted`.
- [ ] Admin login: `https://proctox.vercel.app/admin/login` with the
      `DJANGO_SUPERUSER_*` credentials → overview loads.

## 7. Local parity (what was verified)

- `python manage.py test` → **106/106 passing** (93 pre-existing + 13 new:
  lazy auto-submit on fetch/autosave/submit, sweep 403s + success,
  `ensure_admin` idempotency).
- `DEBUG=False` + `collectstatic` (157 files) + `migrate` + `gunicorn` boot →
  `/api/health/` 200 (public, no DB), unauthenticated `/api/exams/` → 401,
  `SECURE_SSL_REDIRECT` active with `X-Forwarded-Proto` honored (Render model).
- `npm run build` + `npm run lint` clean (only the known benign
  useEffect-hoisting warnings).

## 8. Not verified locally (needs real infra)

- Actual Render Postgres traffic (`DATABASE_URL` parsing verified; no local
  Postgres on this machine — first Blueprint deploy runs real migrations).
- Cloudinary upload round-trip (settings switch verified; needs real
  `CLOUDINARY_*` keys + one reference-photo upload on the deployed backend).
- cron-job.org → sweep end-to-end (endpoint + 403 cases covered by tests).
- Vercel deploy + cold-start timing (build output verified identical via
  local `vite build`).
