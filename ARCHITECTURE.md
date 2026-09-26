# System Architecture
## Online Examination & Proctoring System

**Version:** 1.0

---

## 1. Architecture Style

A **modular monolith with a decoupled frontend**, chosen deliberately over microservices: this is a single-semester academic project, and microservices would add operational overhead (service discovery, inter-service auth, multiple deploys) without a corresponding benefit at this scale. The one exception is the **proctoring inference path**, which is kept behind a clean internal boundary so it *could* be split into its own service later without touching exam/grading logic.

```
┌──────────────────────────┐        HTTPS/JSON, WebSocket
│  React SPA (Frontend)    │◄──────────────────────────────┐
│  - Student portal        │                                │
│  - Faculty portal        │                                │
│  - Admin portal          │                                │
│  - In-browser CV (face   │                                │
│    detection via         │                                │
│    face-api.js/OpenCV.js)│                                │
└──────────────┬────────────┘                                │
               │ REST + WebSocket                            │
               ▼                                             │
┌───────────────────────────────────────────────────────────┴─┐
│                     Backend (Django or Flask)                │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐ │
│  │   Auth &  │ │   Exam &  │ │ Proctoring│ │   Grading &   │ │
│  │   RBAC    │ │  Question │ │  Events   │ │   Results     │ │
│  │  module   │ │  module   │ │  module   │ │   module      │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────┘ │
│                          │                                    │
│              ┌───────────┴───────────┐                        │
│              │  Background Workers   │  (Celery/RQ, optional) │
│              │  - auto-submit sweep  │                        │
│              │  - retention cleanup  │                        │
│              └───────────┬───────────┘                        │
└──────────────────────────┼─────────────────────────────────────┘
                            ▼
                 ┌─────────────────────┐        ┌─────────────────────┐
                 │  PostgreSQL (RDBMS) │        │  Object/File Storage│
                 │  users, exams,      │        │  (local disk or S3- │
                 │  attempts, answers, │        │  compatible bucket) │
                 │  proctoring_events  │        │  for snapshots,     │
                 └─────────────────────┘        │  reference photos   │
                                                 └─────────────────────┘
```

## 2. Why This Split for Proctoring

Two viable designs were considered:

1. **Server-side CV (Python + OpenCV on the backend)**: client streams frames to the server, server runs face detection.
2. **Client-side CV (browser-based, e.g., face-api.js / MediaPipe / OpenCV.js) with only *flag events* sent to the server.**

**Decision: Client-side detection, server-side event logging.** Rationale:
- Sending continuous video to the server for 100+ concurrent students is bandwidth- and compute-heavy, and directly conflicts with NFR-2 (concurrency) and NFR-10 (privacy — don't transmit/store raw video).
- Running detection in-browser (WebAssembly-backed libraries) keeps latency low and lets the system scale horizontally on the backend, since the backend only ever receives small JSON events + occasional compressed thumbnails, not video streams.
- OpenCV (Python) is still used, but **server-side and on-demand**: e.g., verifying the one-time reference-photo-to-first-frame match at exam start, and any offline batch reprocessing FAC might request during dispute review — not for continuous per-frame monitoring.

If the project's rubric specifically requires OpenCV on the backend as the primary detector, this design should be flipped (see `AI_RULES.md` §6 for how to request that variant) — but the default here favors client-side detection for scalability reasons that matter for the "handle real classes of students" story in `PRD.md`.

## 3. Backend Modules

### 3.1 Auth & RBAC module
- Endpoints: `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`.
- Middleware: JWT verification + role decorator (`@require_role("faculty")`) applied per view/route.
- Stores password hashes only; never returns password fields in any serializer.

### 3.2 Exam & Question module
- Question bank CRUD, tagged by course/topic/difficulty.
- Exam CRUD + publish/unpublish lifecycle.
- **Randomization service**: given `(student_id, exam_id)`, deterministically seeds a PRNG (e.g., `random.Random(hash(student_id, exam_id))`) to select N questions and shuffle options — same student always sees the same set on refresh, different students see different sets.

### 3.3 Proctoring Events module
- `POST /api/attempts/{id}/events` — client pushes a flag; validated, rate-limited (to prevent flooding), stored with a computed severity.
- `GET /api/exams/{id}/monitor` — WebSocket or short-poll endpoint for the PROC "Live Monitoring" view.
- Snapshot thumbnails uploaded as small JPEGs (client-side compressed before upload) to object storage; DB stores only the URL/key.

### 3.4 Grading & Results module
- Auto-grader runs synchronously on submission for objective questions.
- Manual grading queue for subjective answers, exposed to FAC.
- Result publishing gate: STU cannot query their own score until `exam.results_published = true`.

### 3.5 Background Workers (optional but recommended)
- **Auto-submit sweep**: a periodic job (every 30–60s) that finds attempts past their end-time and haven't been submitted, and force-submits them server-side — this must not depend solely on the client's JS timer, per NFR-14.
- **Retention cleanup**: deletes proctoring evidence older than the configured retention window (NFR-11).

## 4. Frontend Structure (React)

```
src/
  app/                # routing, top-level layout, auth context
  features/
    auth/
    student-portal/
      exam-list/
      exam-taking/     # timer, question nav, autosave, proctoring hooks
      results/
    faculty-portal/
      question-bank/
      exam-builder/
      grading-queue/
      integrity-dashboard/
    admin-portal/
      user-management/
      exam-oversight/
    proctoring/
      useFaceDetection.ts   # wraps face-api.js/OpenCV.js
      useTabVisibility.ts   # visibilitychange/blur listeners
      useFullscreenGuard.ts
      flagEmitter.ts        # batches/sends events to backend
  shared/
    components/
    api-client/
    hooks/
```

Each proctoring "sensor" is an isolated React hook that only emits events through a single `flagEmitter` — this keeps the detection logic swappable (e.g., replacing face-api.js with MediaPipe later) without touching the exam-taking screen's core logic.

## 5. Data Model (Core Tables)

```
User(id, role[student|faculty|admin], name, email, password_hash,
     reference_photo_url, created_at)

Course(id, name, code, faculty_id FK)

Question(id, course_id FK, type[mcq_single|mcq_multi|short_answer],
         text, difficulty, created_by FK)

QuestionOption(id, question_id FK, text, is_correct)

Exam(id, course_id FK, title, start_time, end_time, duration_minutes,
     question_count, negative_marking, proctoring_mode[off|basic|strict],
     is_published, results_published)

Attempt(id, exam_id FK, student_id FK, started_at, submitted_at,
        status[in_progress|submitted|auto_submitted|voided],
        integrity_score, score)

AttemptQuestion(id, attempt_id FK, question_id FK, order_index,
                shuffled_option_order JSON)

AttemptAnswer(id, attempt_id FK, question_id FK, selected_option_ids JSON,
              text_answer, marks_awarded, graded_by FK NULL)

ProctoringEvent(id, attempt_id FK, type, severity[low|medium|high],
                timestamp, evidence_url NULL, metadata JSON)
```

## 6. API Design Principles
- RESTful resource-based routes (`/api/exams/{id}/attempts/{id}/answers`), versioned under `/api/v1/`.
- All mutating endpoints require CSRF protection (if session-based) or rely purely on JWT bearer auth (if fully stateless) — pick one consistently; do not mix.
- Pagination on all list endpoints (`?page=&page_size=`).
- Consistent error envelope: `{ "error": { "code": "...", "message": "..." } }`.

## 7. Deployment Architecture

For an academic MVP:
- **Frontend**: static build deployed to Vercel/Netlify or served via the same origin behind Nginx.
- **Backend**: Django/Flask app behind Gunicorn/Uvicorn + Nginx reverse proxy, deployable on a single VM (e.g., a free-tier cloud instance) or Render/Railway.
- **Database**: managed PostgreSQL (or a Dockerized instance for local/dev).
- **Storage**: local disk for a college demo is acceptable; document the upgrade path to S3-compatible storage for production.
- **TLS**: via the reverse proxy (Let's Encrypt/Certbot) — satisfies NFR-4.

```
[ Browser ] → [ Nginx (TLS termination) ] → [ Gunicorn/Uvicorn → Django/Flask ]
                        │                              │
                        ▼                              ▼
              [ Static frontend build ]        [ PostgreSQL, Storage ]
```

## 8. Security Architecture Notes
- All role checks enforced server-side (NFR-5); the frontend role-based UI hiding is a UX convenience only, never the actual gate.
- Question correct-answers (`is_correct`) are stripped from every Student-facing serializer at the API layer, not just hidden in the UI (NFR-6).
- Proctoring evidence access is scoped by course/exam ownership, checked per-request (NFR-7).
- Rate-limiting on the events endpoint prevents a malicious client from flooding the flag pipeline.

## 9. Extension Points (documented for future work, not MVP)
- Swap client-side face-api.js for a dedicated inference microservice if the institute later wants centralized model updates.
- Add a live-proctor video-call module (would introduce WebRTC + signaling — a real architectural addition, not a small feature).
- Add gaze-tracking (would need a heavier CV model and likely a native app, not a browser-only solution).
