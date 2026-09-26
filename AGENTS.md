# AGENTS.md — Online Examination & Proctoring System

## Repo shape (monorepo, two halves)
- `backend/` — Django 6.1 + DRF + SimpleJWT. Apps map 1:1 to architecture: `authentication/`, `exams/`, `proctoring/`, `grading/`. Project package is `config/` (`settings.py`, `urls.py`, `celery.py`).
- `frontend/` — React 19 + Vite 8 + react-router v7 + axios. `src/features/` per portal (`auth/`, `student-portal/`, `faculty-portal/`, `admin-portal/`, `proctoring/`); `src/shared/` holds `api-client/`, `components/`, `hooks/`. (README says React 18 — stale; `package.json` is truth: React 19.)
- Phase 0 scaffolding only: health endpoint works, most portals are placeholders in `src/App.jsx`. Build phases sequentially per README (Auth → Question bank → Exam-taking → Randomization → Proctoring → Grading → Admin).

## Source-of-truth hierarchy (from `AI_RULES.md` — follow it)
1. Explicit owner instruction in current conversation
2. `SRS.md` (exact requirements, FR-*/NFR-* IDs)
3. `ARCHITECTURE.md` (module boundaries)
4. `PRD.md` (intent; §6.2 out-of-scope is binding)
5. `AI_RULES.md` (process/style only, never overrides what to build)

Never edit `SRS.md`, `PRD.md`, `ARCHITECTURE.md`, or `AI_RULES.md` as a side effect of a code change — propose doc edits separately.

## Commands (verify before substituting)
```bash
# Backend (from backend/, venv already exists at backend/venv but is gitignored)
source venv/bin/activate
python manage.py migrate
python manage.py runserver        # :8000
python manage.py test             # only real test suite; run per-app as `python manage.py test <app>`
curl http://localhost:8000/api/health/

# Frontend (from frontend/)
npm install
npm run dev     # :5173, proxies /api -> :8000 (see vite.config.js)
npm run build   # vite build
npm run lint    # oxlint (NOT eslint; config in .oxlintrc.json)
```
- No frontend test runner is installed — README's `npm test` is aspirational, don't run it.
- No CI workflows / pre-commit / task runner exist. No root `opencode.json`.
- Env: `cp .env.example .env` in each half. Backend defaults to SQLite (`DB_ENGINE=sqlite3`); set `DB_ENGINE=postgresql` + creds for prod. Frontend uses `VITE_API_BASE_URL` (defaults to `http://localhost:8000/api` in `apiClient.js`).
- Celery/Redis (auto-submit sweep, retention cleanup) is optional for dev, required for prod: `redis-server`, then `celery -A config worker -l info` and `celery -A config beat -l info` from `backend/`. Beat runs `exams.tasks.auto_submit_expired_attempts` every 60s.

## Hard constraints (do not "simplify" these away)
- **RBAC default-deny:** every new endpoint needs an explicit `@require_role(...)` check (`authentication/permissions.py`). Global DRF default is `IsAuthenticated`; superusers bypass role checks. Frontend `ProtectedRoute` hiding is UX only — enforce server-side.
- **Never leak answers:** strip `is_correct` from all student-facing serializers (ARCHITECTURE.md §8, NFR-6).
- **Server-authoritative timer:** client countdown is display-only; expiry enforced by Celery auto-submit sweep (NFR-14). Never replace with client-only timer.
- **Deterministic randomization:** question/option order seeded by `(student_id, exam_id)` (FR-10). Flag any change to seeding logic explicitly.
- **Proctoring privacy:** client-side detection (face-api.js/MediaPipe) sends flag events + compressed thumbnails only. Never store/transmit continuous video (NFR-10/11). Server OpenCV is for one-time reference-photo match + offline reprocessing only.
- **Flags, not auto-fail:** violations create `ProctoringEvent`s for human review; never auto-disqualify.
- **Out of scope** (PRD §6.2, needs explicit owner approval): gaze-tracking, deepfake/liveness beyond basic photo match, audio transcription, native mobile apps, billing, live human video-call proctoring.
- **Tech lock:** Django + React(Vite) + PostgreSQL + self-hosted JWT. No new major dependency (DB, queue, framework, auth SaaS) without flagging it and updating `ARCHITECTURE.md` in the same change. SQLite OK for local dev only.
- **Error envelope + pagination:** errors as `{ "error": { "code": "...", "message": "..." } }`; list endpoints paginate (`?page=&page_size=`, default size 20). API versioning intent is `/api/v1/` but current routes are unversioned `/api/...` — don't rename existing routes casually.
- **Secrets/env:** everything from env vars (`config/settings.py` via `load_dotenv()` — run Django commands with `backend/` as cwd so `.env` loads). Never hardcode/commit secrets. Seed data must use fake addresses (`student1@example.edu`).

## Conventions that differ from defaults
- Custom user model: `AUTH_USER_MODEL = 'authentication.User'` with `role` field (`student|faculty|admin`); use `is_student()/is_faculty()/is_admin()` helpers.
- JWT: `Bearer` header, access 60min / refresh 7d (env-tunable), `ROTATE_REFRESH_TOKENS` + blacklist. Frontend stores `access_token`/`refresh_token` in `localStorage` and auto-refreshes on 401 (`shared/api-client/apiClient.js`) — reuse that client, don't hand-roll axios calls.
- Routes: `config/urls.py` mounts `api/health/`, `api/auth/` (register/login/logout/token/refresh/profile), `api/` (exams). `proctoring`/`grading` URL includes are still commented out — uncomment as those phases land.
- Proctoring frontend: each sensor is an isolated hook funneling through a single `flagEmitter` (ARCHITECTURE.md §4) — keep detection swappable, don't couple it to exam-taking UI.
- Results gate: students can't see scores until `exam.results_published = true`.
- Docs hygiene: any new env var/script/setup step must update `README.md` in the same change; new grading/randomization/integrity logic ships with unit tests (NFR-17) plus a manual note for role-access + proctoring flags. One logical concern per change — don't bundle refactors with features.
- Gitignored (never commit): `backend/venv/`, `backend/.env`, `backend/db.sqlite3`, `backend/media/`, `frontend/node_modules/`, `frontend/.env*`.
