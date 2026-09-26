# AI Collaboration Rules
## Online Examination & Proctoring System

**Purpose:** This file governs how any AI coding assistant (Claude, Cursor, Copilot, etc.) may read, generate, or modify this codebase. Read this file, `PRD.md`, `SRS.md`, and `ARCHITECTURE.md` before writing any code. If a request conflicts with these rules, the AI should say so explicitly rather than silently complying.

---

## 1. Source of Truth Hierarchy

When requirements seem to conflict, resolve in this order:
1. Explicit instruction from the project owner in the current conversation.
2. `SRS.md` (exact requirements).
3. `ARCHITECTURE.md` (structure/module boundaries).
4. `PRD.md` (intent/scope, for judgment calls not covered above).
5. This file (`AI_RULES.md`) for process/style only — it never overrides *what* to build, only *how* to build it.

## 2. Scope Discipline
- Do **not** add features listed in `PRD.md` §6.2 "Out of Scope" (gaze-tracking, deepfake detection, billing, native mobile apps, live human video-call proctoring) unless the project owner explicitly asks for a scope change.
- If a request seems to expand scope significantly, ask for confirmation before implementing, or implement it behind a clearly-labeled feature flag / separate module so it doesn't destabilize the MVP.
- Do not silently "improve" the architecture (e.g., switching to microservices, adding Kubernetes, adding Redis) unless asked — this is a single-semester academic project; keep the stack boring and defensible in a viva/demo.

## 3. Tech Stack Lock
Unless explicitly told otherwise, use exactly:
- **Backend**: Django (preferred, for built-in admin + ORM + auth scaffolding) or Flask if the owner prefers a lighter framework — pick one and stay consistent; do not mix both in one codebase.
- **Frontend**: React (Vite, not Create React App).
- **Database**: PostgreSQL.
- **Proctoring CV**: client-side (face-api.js or OpenCV.js/MediaPipe) for continuous monitoring per `ARCHITECTURE.md` §2; server-side OpenCV (Python) only for the one-time reference-photo match and any batch/offline reprocessing.
- **Auth**: JWT-based, RBAC via a role field, never a third-party auth SaaS (keeps the project self-contained for a viva demo).

Do not introduce a new major dependency (a new database, a message queue, a different frontend framework) without flagging it as a deliberate architectural decision and updating `ARCHITECTURE.md` in the same change.

## 4. Code Change Rules
- **Never modify `SRS.md`, `PRD.md`, `ARCHITECTURE.md`, or this file** as a side effect of a code change. If a code change reveals that a requirement was wrong or incomplete, propose the doc edit explicitly and separately, don't quietly rewrite it.
- **One logical concern per change.** Don't bundle a refactor with a new feature in the same diff — makes it hard to grade/review and hard to debug regressions.
- **Never touch grading/randomization determinism casually.** The per-student question/option randomization (`SRS.md` FR-10) must remain deterministic per `(student_id, exam_id)`. Any change to the seeding logic must be called out explicitly, since it affects exam fairness.
- **Never remove the server-side authoritative timer.** The client-side countdown is a display only; the server must independently enforce the exam end-time (`NFR-14`). Do not "simplify" this into a client-only timer even if asked for a quick demo shortcut — flag the trade-off instead of silently doing it.
- **Never expose correct answers to student-facing API responses** before grading, even temporarily for debugging. If debug output is needed, gate it behind a clearly-labeled dev-only flag that is off by default.
- **Never store raw continuous webcam video.** Only flagged-moment thumbnails, per `ARCHITECTURE.md` §2 and `SRS.md` NFR-10. If asked to "just record the whole exam for safety," push back and point to this constraint, offering the documented alternative (more frequent flagging, not full recording).

## 5. Security & Privacy Defaults
- All new endpoints require an explicit role check — default-deny, not default-allow.
- All new database migrations that touch `User`, `Attempt`, or `ProctoringEvent` must consider the retention policy (`NFR-11`) — don't add fields that silently bypass the cleanup job.
- Secrets (DB credentials, JWT signing key) must be read from environment variables, never hardcoded, never committed.
- When generating example/seed data, use clearly fake data (e.g., `student1@example.edu`), never realistic-looking real names/emails scraped or invented to resemble real people.

## 6. Explicitly Allowed Deviations (owner has pre-approved these)
- Flask may be substituted for Django if the owner states a preference, as long as RBAC, ORM usage, and migrations are still present in equivalent form.
- Server-side OpenCV-primary proctoring (instead of client-side-primary) may be used **if the owner states the project rubric requires demonstrating OpenCV directly** — in that case, update `ARCHITECTURE.md` §2 to reflect the flipped design rather than silently diverging from the documented architecture.
- SQLite may be used for local development convenience, but PostgreSQL remains the target for anything described as "production" or "final" in conversation.

## 7. When the AI Should Ask Instead of Assume
- Whether short-answer questions get any auto-assist grading (PRD.md §10 open question) — do not build this silently.
- Whether CSV bulk student import is required for the demo or manual creation suffices.
- Any request that would mean storing continuous video, auto-disqualifying a student without human review, or removing the server-authoritative timer — these contradict core integrity/privacy decisions above and should be confirmed explicitly, not just implemented.

## 8. Testing Expectations
- New backend business logic (grading, randomization seeding, integrity scoring) should come with unit tests in the same change, per `SRS.md` NFR-17.
- Do not mark a feature "done" without at least a manual test note (or automated test) for: role-restricted access, and the specific proctoring flag(s) it introduces.

## 9. Documentation Hygiene
- Any new environment variable, script, or setup step must be added to the project's `README.md` (create one if absent) in the same change.
- Keep this five-document set (`PRD.md`, `SRS.md`, `ARCHITECTURE.md`, `AI_RULES.md`, `UI_UX_SPEC.md`) as the canonical spec; if the codebase and a doc drift apart, treat that as a bug to report, not something to quietly paper over.
