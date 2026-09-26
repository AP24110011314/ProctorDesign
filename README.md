# Online Examination & Proctoring System

A web-based examination platform with automated proctoring, built as a final-year B.Tech project.
Faculty create timed, randomized exams; students take them in a monitored browser environment;
proctoring flags suspicious behavior for **human review only** — the system never auto-fails a student.

## Quick Start (5 minutes)

You need: Python 3.12+ (Django 6.1 supports 3.12 / 3.13 / 3.14 only), Node.js 20.19+ (Vite 8
requires Node 20.19+ or 22.12+) and npm. Run the backend and frontend in **two separate terminals**.

**Terminal 1 — backend (first time only: steps 1–4, then just step 5 every day):**

```bash
cd backend
python3 -m venv venv              # skip if `venv/` already exists
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # only once — skip if .env already exists (Windows: `copy .env.example .env`)
python manage.py migrate
python manage.py createsuperuser  # only once — follow the prompts (superusers bypass role checks, so no role prompt needed)
        # every day: http://localhost:8000
```
Run all Django commands with `backend/` as the working directory so `.env` loads.

Check it works: open http://localhost:8000/api/health/ — you should see `{"status": "healthy", ...}`.

**Terminal 2 — frontend (first time only: steps 1–2, then just step 3 every day):**

```bash
cd frontend
npm install                       # only once
cp .env.example .env              # only once — skip if .env already exists (Windows: `copy .env.example .env`)
npm run dev                       # every day: http://localhost:5173
```

Open http://localhost:5173, register as a student, and log in.

**Stuck?**

| Symptom | Fix |
| ------- | --- |
| `Error: That port is already in use` | An old server is still running. Find and stop it: `lsof -i :8000`, then `kill <PID>` — or just use another port: `python manage.py runserver 8001` |
| `401 Unauthorized` on `/api/exams/` before login | Normal — the API denies anonymous requests. Log in first |
| `POST /api/auth/token/refresh/ 401` on page reload | Normal — your saved token expired. Log in again (clear Local Storage if it loops) |
| `SECRET_KEY` / `.env` errors | Make sure you run Django commands with `backend/` as the working directory so `.env` loads |

Redis/Celery (auto-submit sweep) is optional for local dev — see "Optional: background workers" below.

## Project Structure

```
ProctorDesign/
├── backend/                 # Django 6.1 + DRF + SimpleJWT API
│   ├── authentication/      # Custom User (student|faculty|admin), JWT, @require_role (FR-1–FR-5)
│   ├── exams/               # Courses, question bank, exams, attempts, timer (FR-6–FR-19)
│   ├── proctoring/          # ProctoringEvent log, integrity scoring, throttled ingest (FR-20–FR-25)
│   ├── grading/             # Auto-grader, manual queue, publish gate, CSV/PDF export (FR-26–FR-29)
│   ├── system/              # AuditLog + admin overview (FR-30–FR-31)
│   └── config/              # settings.py, urls.py, celery.py
├── frontend/                # React 19 + Vite 8 + react-router v7 + axios SPA
│   └── src/
│       ├── features/        # auth, student-portal, faculty-portal, admin-portal, proctoring
│       └── shared/          # api-client (axios + auto-refresh), components, hooks
├── PRD.md                   # Product requirements and scope (§6.2 out-of-scope is binding)
├── SRS.md                   # Functional/non-functional requirements (FR-*/NFR-*)
├── ARCHITECTURE.md          # Module boundaries and design rationale
├── UI_UX_SPEC.md            # Page-by-page UI specifications
└── AI_RULES.md              # Development rules and constraints
```

## Tech Stack

### Backend
- **Framework:** Django 6.1 + Django REST Framework + SimpleJWT
- **Database:** SQLite (local dev, default) / PostgreSQL (production)
- **Auth:** JWT Bearer tokens — access 60 min / refresh 7 days (env-tunable), refresh rotation + blacklist
- **Background jobs:** Celery + Redis — auto-submit sweep every 60 s, proctoring retention cleanup
- **PDF export:** reportlab (pure-Python, pinned in `backend/requirements.txt`)
- **CV (server-side):** reserved for one-time reference-photo match / offline reprocessing only

### Frontend
- **Framework:** React 19 + Vite 8, react-router v7, axios
- **Lint:** oxlint (`npm run lint`) — there is no eslint and no frontend test runner
- **CV (client-side):** swappable sensor hooks (`sensors.js`) funneling through one `flagEmitter` —
  real face detection (face-api.js/MediaPipe) is a documented swap-in, not bundled

## Setup Instructions

If you followed **Quick Start** above, you're done — this section is the same steps with extra detail.

### Prerequisites
- Python 3.12+ (3.12 / 3.13 / 3.14 — required by Django 6.1), Node.js 20.19+ (or 22.12+ — required by Vite 8) and npm
- Redis — optional for local dev, required for production (auto-submit sweep)

### Backend
```bash
cd backend
python3 -m venv venv              # skip if `venv/` already exists
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # edit SECRET_KEY / DB creds as needed (Windows: `copy .env.example .env`)
python manage.py migrate
python manage.py createsuperuser  # creates a superuser (bypasses role checks, usable as admin)
python manage.py runserver        # http://localhost:8000
curl http://localhost:8000/api/health/
```
Always run Django commands with `backend/` as the working directory so `.env` loads.

### Frontend
```bash
cd frontend
npm install
cp .env.example .env              # default VITE_API_BASE_URL=http://localhost:8000/api (Windows: `copy .env.example .env`)
npm run dev                       # http://localhost:5173 (proxies /api -> :8000)
```

### Optional: background workers (required for production)
```bash
redis-server
# from backend/, one terminal each:
source venv/bin/activate && celery -A config worker -l info
source venv/bin/activate && celery -A config beat -l info
```

## Environment Variables

Backend (`backend/.env`, see `.env.example`) — everything comes from env, never hardcoded:

| Var | Default | Purpose |
| --- | ------- | ------- |
| `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS` | — | Django core |
| `DB_ENGINE` | `sqlite3` | `sqlite3` for dev; `postgresql` + `DB_NAME/USER/PASSWORD/HOST/PORT` for prod |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` / `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | `60` / `7` | JWT lifetimes |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,…` | Frontend origin |
| `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` | `redis://localhost:6379/0` | Workers |
| `PROCTORING_SNAPSHOT_MAX_SIZE_MB` | `2` | Rejects oversized evidence uploads |
| `PROCTORING_DATA_RETENTION_DAYS` | `90` | Retention-cleanup window (NFR-11) |
| `AI_ASSIST_GRADING_ENABLED` | `False` | Stretch goal: keyword-overlap *suggestions* only, never auto-applied |

Frontend (`frontend/.env`): `VITE_API_BASE_URL` (defaults to `http://localhost:8000/api`).

## API Overview

Base path `/api/…` (unversioned; `/api/v1/` versioning is intent only — don't rename routes casually).
Errors use the envelope `{ "error": { "code": "…", "message": "…" } }`; list endpoints paginate
(`?page=&page_size=`, default size 20).

| Area | Endpoints |
| ---- | --------- |
| Health | `GET /api/health/` (public) |
| Auth | `POST /api/auth/register/` (needs `password_confirm` + `role`), `POST /api/auth/login/` (**email** + password), `POST /api/auth/logout/`, `POST /api/auth/token/refresh/`, `GET/PATCH /api/auth/profile/` |
| Exams | `GET /api/exams/` (student: published only, no answers), faculty/admin CRUD; `GET /api/exams/{id}/monitor/` (live integrity board) |
| Attempts | `POST /api/attempts/start/` → SystemCheck → `POST /api/attempts/{id}/submit/`; `GET /api/attempts/{id}/result/` (own + submitted + published only); `POST /api/attempts/{id}/void/` (mandatory reason, terminal); `POST /api/attempts/{id}/events/` (throttled 60/min); `POST /api/attempts/{id}/reference_photo/` |
| Grading | `GET /api/grading/queue/?exam_id=` (voided excluded); `POST /api/grading/answers/{id}/grade/`; `POST /api/grading/exams/{id}/publish|unpublish/`; `GET /api/grading/exams/{id}/export/?filetype=csv|pdf` (FR-29) |
| Proctoring | `GET /api/proctoring/events/` (scoped: students see own, faculty their exams); `POST /api/proctoring/events/{id}/review/` |
| System | `GET /api/system/overview/` (counts + recent audit, admin-only); `GET /api/system/audit/` (admin-only) |

Quirk to know: exports use **`?filetype=`**, not `?format=` — DRF reserves `?format=` for renderer
override and 404s before the view runs.

## Key Design Decisions

1. **RBAC default-deny** — every endpoint carries an explicit `@require_role(...)` check
   (`authentication/permissions.py`); DRF default is `IsAuthenticated`; superusers bypass role checks.
   `ProtectedRoute` in React is UX only. Verified live: unauthenticated → 401 everywhere,
   student → 200 on own exams/profile, 403 on grading export and system overview.
2. **Never leak answers** — student serializers strip `is_correct` / correct option ids / `model_answer` (NFR-6).
3. **Server-authoritative timer** — client countdown is display-only; Celery beat force-submits expired
   attempts every 60 s (NFR-14).
4. **Deterministic randomization** — question/option order seeded by `(student_id, exam_id)` (FR-10).
5. **Proctoring privacy** — browser sensors send flag events + compressed thumbnails only; no continuous
   video is stored or transmitted (NFR-10/11). Severity weights feed a display-only integrity score that
   never alters marks. Violations create `ProctoringEvent`s for human review — never auto-disqualify.
6. **Grading** — MCQ exact set-match earns full `marks_per_question`, else 0, minus negative marking if
   enabled (blank = 0); short answers are never auto-graded. Students see scores only after
   `exam.results_published = true` (FR-28). Voided attempts are terminal and excluded from queue/results.
7. **Audit trail** — publish/unpublish/void/review actions append to `AuditLog` (FR-31).

Out of scope without explicit owner approval (PRD §6.2): gaze-tracking, deepfake/liveness beyond the basic
photo match, audio transcription, native mobile apps, billing, live human video-call proctoring.

## Frontend Routes

- `/login`, `/register`, `/unauthorized`
- `/admin/login` — separated administrator entry (Mission Control skin, same JWT flow, rejects non-admins)
- Student: `/student` (dashboard), `/student/exams` (My Exams — start/resume/results),
  `/student/exams/:examId/check` (SystemCheck), `/student/attempts/:attemptId/take` (exam + sensors),
  `/student/results` (My Results)
- Faculty: `/faculty/questions`, `/faculty/exams/build`, `/faculty/grading`, `/faculty/results`,
  `/faculty/monitor` (LiveMonitor)
- Admin: `/admin/overview` (SystemOverview), `/admin/exams/build` (roll out tests),
  `/admin/questions`, `/admin/monitor`, `/admin/grading`, `/admin/results` —
  admin console reuses the faculty workflows (server RBAC already allows FACULTY + ADMIN there)

All API calls go through the shared `apiClient` (localStorage tokens + auto-refresh on 401) —
don't hand-roll axios calls.

## Testing

Backend is the real suite — **93 tests, all passing**:
```bash
cd backend
source venv/bin/activate
python manage.py test            # full suite
python manage.py test <app>      # per-app: authentication, exams, proctoring, grading, system
```
Coverage spans RBAC matrix, deterministic randomization, grading/scoring rules, publish gating,
result-detail answer stripping, proctoring severity/integrity/throttling/evidence validation,
void flow, audit logging, and CSV/PDF export.

Frontend:
```bash
cd frontend
npm run lint     # oxlint — only the benign codebase-wide useEffect-hoisting pattern warns
npm run build    # vite build — succeeds
```
There is no frontend test runner (`npm test` is aspirational — don't run it). New
grading/randomization/integrity logic must ship with backend unit tests (NFR-17).

## Health-Check Log (2026-09-26)

Last full verification, all green:
- `manage.py check` clean; all migrations applied (`exams` 0001–0005, `proctoring` 0001, `system` 0001).
- Live server: `GET /api/health/` → 200; unauthenticated → 401 on exams/grading/proctoring/system;
  registered + email-login flow → 201/200; student exam-list + profile → 200;
  student grading-export + system-overview → 403; duplicate registration → 400.
- Two issues found and fixed during the check:
  1. Dev `db.sqlite3` was missing 4 migrations (`exams` 0003–0005, `proctoring` 0001) — applied via `migrate`.
     (Local-only; `db.sqlite3` is gitignored.)
  2. The `system` app shipped with **no `migrations/` package**, so `migrate` never created the
     `audit_log` table on fresh databases (tests masked this via test-DB sync) — created
     `system/migrations/0001_initial.py` and applied. Any fresh checkout must run `migrate` normally.

## Contributing

This is an academic project. If modifying:
1. Read `AI_RULES.md` first (source-of-truth hierarchy: owner > `SRS.md` > `ARCHITECTURE.md` > `PRD.md` > `AI_RULES.md`).
2. Every feature must trace to an FR-*/NFR-* ID in `SRS.md`.
3. One logical concern per change; new env vars/setup steps update this README in the same change.
4. Never edit `SRS.md`, `PRD.md`, `ARCHITECTURE.md`, or `AI_RULES.md` as a side effect — propose doc edits separately.
5. Seed data must use fake addresses (`…@example.edu`).

## License

Educational/Academic use only.

## Author

Aman Maddheshiya
B.Tech AI & ML, Final Year Project
2026

---

**Current status:** Phases 1–7 complete and verified (auth/RBAC, question bank, exam-taking, randomization,
proctoring engine, grading + CSV/PDF export, admin oversight) plus Phase 8 polish (student exam-list page).
93/93 backend tests passing; frontend lint + build clean.
