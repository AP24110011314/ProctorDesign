# AGENTS.md — Online Examination & Proctoring System

## Repo shape
- Monorepo, two halves. `backend/` = Django 6.1 + DRF + SimpleJWT, apps `authentication/ exams/ proctoring/ grading/ system/`, project package `config/` (`settings.py`, `urls.py`, `celery.py`). `frontend/` = React 19 + Vite 8 + react-router v7 + axios (`src/features/` per portal, `src/shared/api-client|components|hooks`).
- Status: Phases 1–7 complete (auth/RBAC, question bank, exam-taking, randomization, proctoring, grading + export, admin), 93 backend tests passing. Don't treat portals as placeholders.
- Source-of-truth hierarchy: owner instruction > `SRS.md` (FR-*/NFR-*) > `ARCHITECTURE.md` (boundaries) > `PRD.md` (intent; §6.2 out-of-scope binding) > `AI_RULES.md` (process only). Never edit those four docs as a side effect — propose separately.

## Commands
```bash
# Backend — always run with backend/ as cwd so .env loads via load_dotenv()
source venv/bin/activate  # backend/venv exists, gitignored
python manage.py migrate
python manage.py runserver        # :8000
python manage.py test <app>       # per-app: authentication exams proctoring grading system; full = `python manage.py test`
curl http://localhost:8000/api/health/

# Frontend (from frontend/)
npm run dev    # :5173, proxies /api -> :8000 (vite.config.js)
npm run lint   # oxlint (NOT eslint; config .oxlintrc.json)
npm run build  # vite build
```
- No frontend test runner — never run `npm test`. No CI / pre-commit / root `opencode.json`.
- Env: `cp .env.example .env` in each half. Backend `DB_ENGINE=sqlite3` default (dev); `postgresql` + creds for prod. Frontend `VITE_API_BASE_URL` (default `http://localhost:8000/api`).
- Celery/Redis optional dev, required prod: `redis-server`, then from `backend/` → `celery -A config worker -l info` + `celery -A config beat -l info`. Beat runs `exams.tasks.auto_submit_expired_attempts` every 60s.

## Hard constraints (never simplify away)
- **RBAC default-deny:** every endpoint needs explicit `@require_role(...)` (`authentication/permissions.py`). DRF default `IsAuthenticated`; superusers bypass. `ProtectedRoute` is UX only — enforce server-side.
- **Never leak answers:** strip `is_correct` / correct ids / `model_answer` from all student serializers (NFR-6). Result detail hides scores until `exam.results_published = true`.
- **Server-authoritative timer:** client countdown display-only; expiry via Celery sweep (NFR-14).
- **Deterministic randomization:** order seeded by `(student_id, exam_id)` (FR-10) — flag any seeding change.
- **Proctoring privacy + flags-not-fail:** browser sends flag events + compressed thumbnails only (≤ `PROCTORING_SNAPSHOT_MAX_SIZE_MB`=2MB), never continuous video (NFR-10/11). Events endpoint throttled 60/min. Violations → `ProctoringEvent` for human review; never auto-disqualify. Server OpenCV = one-time reference-photo match / offline reprocessing only.
- **Out of scope** (PRD §6.2, needs owner approval): gaze-tracking, deepfake/liveness beyond basic photo match, audio transcription, native mobile, billing, live video-call proctoring.
- **Tech lock:** Django + React(Vite) + PostgreSQL + self-hosted JWT. No new major dep without flagging + updating `ARCHITECTURE.md` in same change.
- **Envelope + pagination:** errors `{ "error": { "code": "...", "message": "..." } }`; lists `?page=&page_size=` (default 20). Routes unversioned `/api/...` — don't rename toward `/api/v1/` casually.

## Gotchas agents actually hit
- Auth quirks: `POST /api/auth/register/` requires `password_confirm` + `role`; `POST /api/auth/login/` takes **email** + password (not username). JWT access 60min / refresh 7d, `ROTATE_REFRESH_TOKENS` + blacklist.
- Reuse `shared/api-client/apiClient.js` — never hand-roll axios. Its refresh is single-flight on purpose: parallel 401 refreshes would blacklist each other.
- Export quirk: `GET /api/grading/exams/{id}/export/?filetype=csv|pdf` — **`?filetype=`**, not `?format=` (DRF hijacks `?format=` and 404s).
- Attempt flow: `POST /api/attempts/start/` → SystemCheck → `POST /api/attempts/{id}/submit/`; `POST .../void/` needs mandatory reason and is terminal (excluded from grading queue/results); `POST .../events/` throttled; `POST .../reference_photo/`.
- Grading rules: MCQ exact set-match = full `marks_per_question` else 0 minus negative marking if enabled (blank = 0); short answers never auto-graded. `AI_ASSIST_GRADING_ENABLED` = suggestions only, never auto-applied.
- URLs live in `config/urls.py`: `api/health/`, `api/auth/`, `api/` (exams), `api/grading/`, `api/proctoring/`, `api/system/` — all mounted, none commented out.
- Proctoring frontend: isolated sensor hooks → single `flagEmitter`; keep detection swappable, don't couple to exam-taking UI.
- Conventions: custom user `authentication.User` with `role` (`student|faculty|admin`); new env var/script/setup step must update `README.md` in same change; new grading/randomization/integrity logic ships with backend unit tests (NFR-17) + manual role-access note; one concern per change; seed data uses `@example.edu`. Never commit `backend/venv|/.env|/db.sqlite3|/media/`, `frontend/node_modules|/.env*`.
