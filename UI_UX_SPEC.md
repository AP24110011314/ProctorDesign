# UI/UX Specification
## Online Examination & Proctoring System

**Version:** 1.0

---

## 1. Design Principles
- **Calm, low-friction exam-taking UI.** The student's attention should be on the exam, not on the interface — minimal chrome, high-contrast timer, no distracting animation during an active attempt.
- **Trust through transparency.** Students should always see a small persistent proctoring indicator (e.g., "Camera active — monitoring on") so nothing is covert.
- **Flags over footage for reviewers.** Faculty/Proctor screens should surface a short list of *what happened and when*, not require scrubbing through video.

## 2. Global Navigation & Layout
- Top bar: logo/app name, current role badge, user menu (profile, logout).
- Role-based landing pages:
  - Student → "My Exams"
  - Faculty → "Dashboard" (courses, exams, grading queue counts)
  - Admin → "System Overview"
- Sidebar (Faculty/Admin only): Question Bank, Exams, Grading Queue, Integrity Reports, (Admin: Users, Courses, System Logs).
- The exam-taking screen (Section 4) intentionally **removes the global nav** to reduce distraction and prevent easy tab/window escape.

## 3. Page Inventory

| # | Page | Primary Actor(s) | Purpose |
|---|---|---|---|
| 1 | Login / Register | All | Auth entry point |
| 2 | My Exams (list) | Student | Upcoming/ongoing/past exams |
| 3 | Pre-Exam System Check | Student | Camera/mic/fullscreen check + reference photo capture |
| 4 | Exam-Taking Screen | Student | The locked-down exam UI itself |
| 5 | My Results | Student | Published scores + correctness breakdown |
| 6 | Faculty Dashboard | Faculty | Overview of courses/exams/pending grading |
| 7 | Question Bank | Faculty | CRUD questions by course/topic |
| 8 | Exam Builder | Faculty | Create/edit an exam's configuration |
| 9 | Live Monitoring Room | Faculty/Proctor | Real-time flags during an active exam window |
| 10 | Grading Queue | Faculty | Grade subjective answers |
| 11 | Integrity & Results Report | Faculty | Per-exam attempt list with scores + integrity flags |
| 12 | Admin: User Management | Admin | Manage/import users |
| 13 | Admin: System Overview | Admin | Institution-wide activity + void/override controls |

## 4. Page-by-Page Detail

### 4.1 Login / Register
- **Layout**: centered card, app name/logo above, tabs or toggle link between Login and Register.
- **Fields (Login)**: email, password, "Forgot password?" link.
- **Fields (Register — Student self-registration, if enabled)**: name, email, password, confirm password. (Faculty/Admin accounts are typically created by Admin, not self-registered — reflect this by hiding the Faculty/Admin option from the public register form.)
- **States**: inline validation errors, loading spinner on submit, generic "invalid credentials" message (never reveal whether the email exists, for basic security hygiene).

### 4.2 My Exams (Student)
- **Layout**: three sections/tabs — "Ongoing," "Upcoming," "Past."
- **Each exam card shows**: title, course, time window, duration, a status chip (`Not started` / `In progress` / `Submitted` / `Result pending` / `Result published`).
- **Primary action**: "Enter Exam" button — disabled/greyed with a tooltip ("Opens at 10:00 AM") until the window opens; active only within the scheduled window.

### 4.3 Pre-Exam System Check
- **Purpose**: satisfies SRS FR-13/FR-14 — must pass before the real attempt starts.
- **Steps shown as a small stepper (1–2–3)**:
  1. **Camera check** — live preview, "We can see you" confirmation once a face is detected.
  2. **Reference photo capture** — capture button, retake option, confirm.
  3. **Fullscreen & rules acknowledgement** — a short bulleted list of exam rules (no tab switching, camera must stay on, etc.) + a checkbox "I understand and agree" + "Enter Fullscreen & Start Exam" button.
- **Failure states**: if camera/mic permission is denied, show a clear inline instruction on how to enable it in the browser, with a retry button; don't dead-end the student.

### 4.4 Exam-Taking Screen
This is the highest-stakes screen in the product — spec it precisely.

**Layout (two-column, no global nav):**
- **Left/main column**: current question text, options (radio/checkbox depending on type) or a textarea for short-answer.
- **Right sidebar**:
  - Countdown timer (large, high-contrast, turns amber under 5 minutes, red under 1 minute).
  - Question palette grid (numbered buttons, color-coded: grey = not visited, blue = visited/unanswered, green = answered, purple = marked for review).
  - "Submit Exam" button (opens confirmation modal).
- **Top-right corner (always visible)**: small persistent badge — camera icon + "Monitoring active" text — this is the transparency element from Design Principle #2.
- **Bottom bar**: Previous / Save & Next / Mark for Review & Next.

**Proctoring-related UI behavior:**
- On tab-switch/blur: show a non-blocking toast ("Tab switch detected — this has been logged") immediately on return to the tab; do not pause the timer.
- On fullscreen exit: show a modal overlay ("You must stay in fullscreen. Click below to continue.") with a single "Re-enter Fullscreen" button; timer keeps running (per NFR-14, server is authoritative — don't let students game extra time by exiting fullscreen).
- On camera lost (no face / permission revoked): a persistent, non-dismissible banner ("Camera not detected — this is being logged. Please ensure your camera is visible.") until resolved.
- **Autosave indicator**: tiny "Saved" / "Saving…" text near the timer, updating per FR-16.

**Submit confirmation modal**: shows counts — "You have answered 18/20 questions, 2 marked for review, 2 unanswered. Submit anyway?" — Cancel / Submit buttons.

**Auto-submit screen**: when the server-side timer expires, show a full-screen "Time's up — your exam has been submitted" message, then redirect to My Exams. This must trigger even if the client-side JS timer glitches, since submission is server-enforced.

### 4.5 My Results (Student)
- List of past exams with: score (if published), max marks, and a "View Breakdown" link.
- Breakdown view: per-question correctness (for objective) and any faculty feedback (for subjective), only after `results_published = true`.
- If proctoring flagged the attempt for review and it's still pending adjudication, show a neutral status ("Result under review") rather than the raw flag details, to avoid alarming students over flags that may turn out to be false positives.

### 4.6 Faculty Dashboard
- Cards/widgets: "Exams needing grading," "Exams with pending review flags," "Upcoming exams this week."
- Quick links into Question Bank, Exam Builder, Grading Queue.

### 4.7 Question Bank
- Filterable table (course, topic, difficulty, type) with search.
- "Add Question" opens a form/modal: question type selector, text (rich-text or plain), options with correct-answer toggle(s) for MCQ, difficulty/topic tags.
- Bulk import (CSV/Excel) as a stretch option, per PRD open question.

### 4.8 Exam Builder
- **Step-based form**: 
  1. Basic info (title, course, start/end window, duration).
  2. Question selection (choose count + filter by topic/difficulty, or hand-pick specific questions).
  3. Rules (negative marking on/off + value, proctoring mode: off/basic/strict, shuffle on/off).
  4. Review & Publish (summary + "Preview as Student" button before publishing).
- Draft vs Published state clearly labeled; editing a published exam that already has attempts should warn about the impact.

### 4.9 Live Monitoring Room
- Left: list of active attempts (student name, elapsed time, live flag count badge, sorted by flag severity/count descending by default).
- Right: selected attempt's event timeline (chronological list: type, timestamp, thumbnail if available) — no live video feed grid (per architecture decision to avoid streaming video at scale).
- Filter chips: "High severity only," "Multiple faces," "Tab switches," etc.

### 4.10 Grading Queue
- List of ungraded subjective answers, grouped by exam.
- Grading view: question text, student's answer, marks input (bounded to max marks), optional feedback textarea, Save & Next.

### 4.11 Integrity & Results Report
- Table: student name, score, integrity score, flag count (by severity), status (clean / needs review / voided).
- Row action: "View attempt detail" → same event timeline as 4.9, plus the student's actual answers, plus an "Void this attempt" action (Admin/Faculty, requires a reason — per SRS FR-31).
- Export buttons: CSV, PDF.

### 4.12 Admin: User Management
- Table of users with role filter, search, "Deactivate" toggle, "Import CSV" button, "Create User" modal.

### 4.13 Admin: System Overview
- High-level stats (active exams, total attempts today, flagged-attempts-pending-review count).
- System/audit log table (who voided what, who changed roles, etc.).

## 5. Component Library (Reusable)
- `TimerBadge` — countdown with color-state thresholds.
- `QuestionPalette` — grid of numbered status buttons.
- `FlagBadge` — colored pill by severity (grey/amber/red) + icon.
- `RoleGuardRoute` — wraps routes to redirect unauthorized roles.
- `ConfirmModal` — generic confirm/cancel dialog (used for submit exam, void attempt, deactivate user).
- `EmptyState` — consistent "nothing here yet" illustration/message for empty tables/lists.
- `DataTable` — shared table with sort/filter/pagination for Question Bank, Users, Reports.

## 6. Interaction & State Notes
- **Optimistic UI is disallowed for the exam submission action** — always wait for server confirmation before showing "Submitted," since a false-positive "submitted" state on a failed network call would be a serious trust issue.
- **Idle/inactivity**: no auto-logout during an active attempt (would be disruptive); auto-logout after inactivity is fine on all other authenticated pages.
- **Accessibility baseline**: all interactive elements keyboard-navigable, sufficient color contrast for the timer's amber/red states (don't rely on color alone — add text label change too, e.g. "5 min left").

## 7. Visual Style Direction (non-binding starting point)
- Neutral, institutional color palette (e.g., deep blue/teal primary, grey neutrals), with red/amber reserved strictly for warnings/timers/flags so they retain urgency.
- Clean sans-serif type, generous spacing on the exam-taking screen specifically (reduces cognitive load under time pressure).
- Faculty/Admin data-heavy screens can be denser (smaller row height, more columns) since those users are not under exam time-pressure.
