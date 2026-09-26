# Software Requirements Specification (SRS)
## Online Examination & Proctoring System

**Version:** 1.0
**Conforms loosely to IEEE 830 structure**

---

## 1. Introduction

### 1.1 Purpose
Defines exact, testable functional and non-functional requirements derived from `PRD.md`. This is the contract an AI assistant or developer must satisfy — every feature built should be traceable to a requirement ID here.

### 1.2 Actors
- **STU** — Student
- **FAC** — Faculty
- **ADM** — Admin
- **PROC** — Proctor (may be same account as FAC with an added role)
- **SYS** — The system itself (background jobs, auto-grader, proctoring engine)

### 1.3 Definitions
- **Attempt**: one student's instance of taking one exam.
- **Flag/Event**: a logged proctoring violation tied to an attempt, with type, timestamp, and evidence (snapshot).
- **Integrity Score**: a computed score per attempt based on flag count/severity (informational only, never auto-fails).

---

## 2. Functional Requirements

### 2.1 Authentication & Authorization
- **FR-1**: The system shall support registration and login for three roles: Student, Faculty, Admin.
- **FR-2**: Passwords shall be stored hashed (bcrypt/argon2); never in plaintext.
- **FR-3**: The system shall issue session tokens (JWT) with expiry, and support logout/token invalidation.
- **FR-4**: Role-based access control (RBAC) shall restrict endpoints: e.g., only FAC/ADM can create exams; only ADM can manage users.
- **FR-5**: Admin shall be able to create/deactivate Faculty and Student accounts, or bulk-import Students via CSV.

### 2.2 Question Bank Management
- **FR-6**: FAC shall create, edit, delete questions tagged by course/topic/difficulty.
- **FR-7**: Supported question types (MVP): Single-correct MCQ, Multi-correct MCQ, Short Answer (manually graded).
- **FR-8**: Each MCQ shall store options in a way that supports per-student option-order randomization without altering the correct-answer mapping.

### 2.3 Exam Configuration
- **FR-9**: FAC shall create an exam with: title, course, start time, end time (or duration window), total duration (minutes), number of questions to draw from the bank, marks per question, negative marking (on/off + value), and proctoring mode (off / basic / strict).
- **FR-10**: The system shall generate a randomized, per-student question set and per-question option order at exam start, seeded deterministically per (student_id, exam_id) so a refreshed page shows the same set, not a new random draw.
- **FR-11**: FAC shall be able to preview an exam as a "dummy student" before publishing it.
- **FR-12**: FAC shall be able to publish/unpublish an exam; students can only see/join published exams within the configured time window.

### 2.4 Exam-Taking Flow (Student)
- **FR-13**: STU shall see a pre-exam "System Check" step verifying webcam, microphone, and fullscreen support before the timer starts.
- **FR-14**: STU shall capture a reference photo (or the system reuses their registration photo) for basic face-match at exam start.
- **FR-15**: Once started, the system shall display a persistent countdown timer; on timeout, the attempt shall auto-submit with whatever answers were saved.
- **FR-16**: The system shall autosave answers to the backend at least every 15 seconds and on every answer change (debounced).
- **FR-17**: STU shall be able to navigate between questions, mark a question "for review," and see a question-status palette (answered/unanswered/marked).
- **FR-18**: STU shall be able to submit the exam manually before time expires, with a confirmation dialog.
- **FR-19**: The exam UI shall enforce fullscreen mode; exiting fullscreen shall trigger a warning and log a flag (see FR-21).

### 2.5 Proctoring Engine
- **FR-20**: While an attempt is active (proctoring mode ≠ off), the client shall run webcam-based checks in-browser at a fixed sampling interval (e.g., every 3–5 seconds):
  - No face detected for > N consecutive seconds → flag `NO_FACE`.
  - More than one face detected → flag `MULTIPLE_FACES`.
  - Detected face does not sufficiently match the reference photo (basic similarity check) → flag `FACE_MISMATCH`.
- **FR-21**: The client shall detect and log the following browser-level events as flags: tab switch / window blur (`TAB_SWITCH`), fullscreen exit (`FULLSCREEN_EXIT`), copy/paste attempted (`CLIPBOARD_EVENT`), right-click/dev-tools attempt (`DEVTOOLS_ATTEMPT`, best-effort only).
- **FR-22**: (Strict mode only) The client shall sample microphone input level and flag `LOUD_NOISE` if ambient volume exceeds a configurable threshold for a sustained period.
- **FR-23**: Every flag shall be sent to the backend with: attempt_id, type, timestamp, severity, and (for visual flags) a compressed snapshot thumbnail — never continuous video recording, to bound storage.
- **FR-24**: The system shall compute a per-attempt Integrity Score as a weighted function of flag counts/severity, visible to FAC/ADM/PROC only, never automatically altering the exam score.
- **FR-25**: PROC shall have a "Live Monitoring" view listing active attempts for an ongoing exam with a real-time flag feed (poll or WebSocket-based).

### 2.6 Grading & Results
- **FR-26**: Objective questions (MCQ) shall be auto-graded immediately on submission.
- **FR-27**: Subjective/short-answer questions shall appear in a FAC grading queue; FAC assigns marks and optional feedback per answer.
- **FR-28**: FAC/ADM shall be able to publish results; only after publishing can STU view their own score and correctness breakdown.
- **FR-29**: FAC shall be able to export exam results and the integrity report as CSV/PDF.

### 2.7 Admin & Oversight
- **FR-30**: ADM shall view system-wide activity: total exams, active attempts, flagged attempts requiring review.
- **FR-31**: ADM shall be able to void/invalidate a specific attempt (e.g., confirmed cheating) with a mandatory reason logged for audit.

---

## 3. Non-Functional Requirements

### 3.1 Performance
- **NFR-1**: The exam-taking page shall load within 3 seconds on a standard broadband connection (≥ 4 Mbps).
- **NFR-2**: The system shall support at least 100 concurrent active attempts for the academic-scale MVP (single-college deployment) without answer-submission failures.
- **NFR-3**: Autosave/flag-submission API calls shall complete in < 500ms server-side under target load (excluding client network latency).

### 3.2 Security
- **NFR-4**: All traffic shall be served over HTTPS/TLS.
- **NFR-5**: All API endpoints shall validate the JWT and enforce RBAC server-side (never trust client-side role checks alone).
- **NFR-6**: Question banks and correct answers shall never be exposed to the Student-facing API payloads before grading.
- **NFR-7**: Webcam snapshots and flag evidence shall be stored with access restricted to FAC/ADM/PROC of the relevant course/exam only.
- **NFR-8**: Input validation and parameterized queries (ORM) shall be used throughout to prevent SQL injection; standard OWASP Top-10 mitigations apply.

### 3.3 Privacy & Data Retention
- **NFR-9**: Webcam access shall only be requested and active during an in-progress attempt; the media stream shall be released immediately on submit/timeout.
- **NFR-10**: Only flagged-moment thumbnails are persisted (per FR-23) — raw continuous video is not stored, consistent with a privacy-by-design lightweight-monitoring approach rather than full session recording.
- **NFR-11**: A configurable data-retention policy shall auto-delete flag evidence after a defined period post-exam (e.g., 90 days), documented for the institute's data policy.

### 3.4 Usability
- **NFR-12**: The exam-taking interface shall be usable without prior training; a one-time "how this exam works" walkthrough shall be shown before the first attempt.
- **NFR-13**: The UI shall be responsive down to a 1024px-wide laptop screen (tablet/mobile is best-effort, not a hard requirement given proctoring needs a stable webcam view).

### 3.5 Reliability & Availability
- **NFR-14**: If a student's connection drops mid-exam, on reconnect they shall resume with previously autosaved answers and the remaining time correctly recalculated server-side (server is the source of truth for the timer, not the client clock).
- **NFR-15**: The system shall degrade gracefully if the webcam/proctoring engine fails to initialize: the exam should still be allowed to proceed with a `PROCTORING_UNAVAILABLE` flag logged, rather than blocking the student entirely (configurable per institute policy).

### 3.6 Maintainability
- **NFR-16**: Codebase shall follow the conventions in `AI_RULES.md` and the module boundaries in `ARCHITECTURE.md`.
- **NFR-17**: Core grading and randomization logic shall have automated unit tests (target ≥ 70% coverage on backend business logic).

### 3.7 Compatibility
- **NFR-18**: The student exam client shall support the latest two major versions of Chrome, Edge, and Firefox.

---

## 4. Data Requirements (Summary — full schema in `ARCHITECTURE.md`)
- Users (id, role, name, email, password_hash, reference_photo_url)
- Courses, Questions, QuestionOptions
- Exams, ExamQuestions (join with per-exam config)
- Attempts, AttemptAnswers
- ProctoringEvents (attempt_id, type, severity, timestamp, evidence_url)
- Results (attempt_id, score, published_at)

## 5. Constraints
- Must be buildable and demoable within a single-semester final-year-project timeline.
- Must run without paid third-party proctoring APIs (uses in-browser ML via OpenCV.js / face-api.js or a lightweight Python CV service, not a commercial SaaS).

## 6. Acceptance Criteria (traceability sample)
| Requirement | Acceptance Test |
|---|---|
| FR-15, NFR-14 | Kill the network for 30s mid-exam; on reconnect, remaining time matches server-computed value, not client-elapsed guess |
| FR-20 | Cover the webcam for 10s during a "basic" mode exam; a `NO_FACE` flag appears in the faculty dashboard within the sampling interval |
| FR-21 | Switch browser tabs during an exam; a `TAB_SWITCH` flag with correct timestamp is recorded |
| FR-24 | An attempt with 5 high-severity flags shows a lower Integrity Score than one with 0 flags, while both retain their independently graded exam score |
