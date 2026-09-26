# Product Requirements Document (PRD)
## Online Examination & Proctoring System

**Version:** 1.0
**Owner:** Aman (B.Tech AI & ML, Final Year Project)
**Status:** Draft for AI-assisted implementation

---

## 1. Purpose

This document defines *what* the product must do and *why*, so that any AI coding assistant or developer picking up this project has an unambiguous source of truth for scope and intent. It is meant to be read alongside `SRS.md` (requirements), `ARCHITECTURE.md` (structure), `AI_RULES.md` (how an AI may modify the codebase) and `UI_UX_SPEC.md` (screens and flows).

## 2. Problem Statement

Since COVID-19, online examinations have become a standard part of academic and corporate assessment. However, most college-built or low-cost online exam tools only test *knowledge* — they do not verify *integrity*. Common failure modes:

- Students can open new tabs, search answers, or use a second device.
- No one is watching whether a second person is in the room or is silently dictating answers.
- Manual invigilation over video calls does not scale past a handful of candidates.
- Institutions want automation, but full commercial proctoring suites (Proctorio, Talview, ProctorU) are expensive, closed-source, and overkill for a single college's exams.

There is a real, present need for a **self-hosted, explainable, and affordable** exam + proctoring system that a college IT cell could run for internal assessments.

## 3. Product Vision

A web-based examination platform where:
1. Faculty can create timed, randomized-question exams in minutes.
2. Students take exams in a locked-down browser flow, monitored by webcam.
3. Suspicious events (tab switch, face missing, multiple faces, no face, loud noise) are logged automatically and flagged for human review — **the AI never auto-fails a student**, it only raises flags for a human proctor/faculty to adjudicate. This mirrors the industry direction observed in 2026 proctoring products, where AI narrows attention for a human reviewer rather than issuing an automated verdict.
4. Results, integrity reports, and analytics are available to faculty/admin after the exam.

## 4. Goals and Objectives

| Goal | Metric |
|---|---|
| Reduce manual invigilation effort | 1 proctor can effectively monitor 50+ students via the flagged-events dashboard instead of watching 50 live video feeds |
| Deter casual cheating | Random question order/options, tab-switch detection, fullscreen enforcement |
| Give faculty confidence in results | Every submission carries an integrity score + event log |
| Be deployable on a student budget | Runs on a single VM / free-tier cloud service, no paid proctoring API required |
| Be a strong final-year project | Demonstrates full-stack + applied computer vision + secure system design |

## 5. Target Users / Personas

1. **Student (Test-taker)** — logs in, joins an exam at a scheduled time, answers questions under webcam supervision, submits before the timer ends.
2. **Faculty (Exam Creator)** — creates question banks, configures exams (duration, shuffle, proctoring rules), reviews flagged incidents, publishes results.
3. **Admin (Institute IT/Exam Cell)** — manages users, departments, courses, and system-wide settings; can override/void exams.
4. **Proctor (optional secondary role)** — a TA/faculty member assigned to review live flags during an ongoing exam window (can be same person as Faculty in a small deployment).

## 6. Scope

### 6.1 In Scope (MVP)
- User registration/login with role-based access (Student, Faculty, Admin).
- Question bank management (MCQ, and optionally short-answer) per course.
- Exam creation: duration, start/end window, question count, randomization rules, negative marking (optional), proctoring toggle.
- Random question & option order generation per student.
- Student exam-taking UI: timer, question navigation, flagging for review, autosave.
- Webcam-based proctoring: face presence detection, multiple-face detection, face-not-matching-registration-photo detection (basic), tab-switch/window-blur detection, fullscreen-exit detection, copy-paste blocking.
- Event logging: every proctoring violation is timestamped and stored with a snapshot/thumbnail.
- Auto-grading for objective questions; manual grading UI for subjective ones.
- Results dashboard for students (post-publish) and faculty (all attempts + integrity report).
- Admin panel for user/course/exam oversight.

### 6.2 Out of Scope (MVP)
- Gaze-tracking / eye-movement analysis (needs specialized models; can be a "future work" section in the final report).
- Deepfake/liveness detection beyond basic photo-ID match.
- Audio transcription-based cheating detection (only ambient noise-level flagging is in scope).
- Native mobile apps (mobile web is acceptable but not optimized).
- Payment/billing (this is an internal institutional tool, not a SaaS product).
- Human live-proctor video calling (video *chat* between proctor and student) — only recorded/streamed monitoring with flags.

### 6.3 Assumptions
- Students take the exam on a laptop/desktop with a working webcam and stable internet.
- The institute already has a list of registered students (import via CSV or manual creation is acceptable).
- Exams are conducted within a single browser tab in a modern browser (Chrome/Edge/Firefox); no custom lockdown-browser binary is required for MVP — browser-level restrictions (Fullscreen API, `visibilitychange`, `blur` events) are sufficient deterrents for a college-scale deployment.

## 7. Key Features (User Stories)

1. *As a Student*, I want to see all exams I am eligible for, so I can join at the right time.
2. *As a Student*, I want a countdown timer and auto-submit on timeout, so I don't lose work if I forget to submit.
3. *As a Student*, I want my answers to autosave every N seconds, so a browser crash doesn't cost me the exam.
4. *As a Faculty*, I want to build a question bank once and reuse it across multiple exam instances.
5. *As a Faculty*, I want each student to get a shuffled subset/order of questions, to reduce copying.
6. *As a Faculty*, I want a dashboard showing which students triggered proctoring flags, ranked by severity/count, so I can review only the risky attempts instead of everyone.
7. *As an Admin*, I want to manage roles and see system-wide exam activity.
8. *As a Proctor*, I want a live "monitoring room" view during an active exam showing flagged webcam snapshots in near-real-time.

## 8. Success Criteria for the Academic Deliverable

- End-to-end demo: create exam → student takes exam with webcam active → violations are logged → faculty reviews integrity report → result is published.
- At least 3 distinct proctoring signals implemented and demonstrably working (face-missing, multi-face, tab-switch).
- A written report section comparing this system's approach to commercial proctoring tools (positioning it correctly as a lightweight academic-grade system, not a market competitor).

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Browser webcam/permission inconsistencies across devices | Provide a pre-exam "system check" screen (camera, mic, fullscreen test) before the real exam starts |
| False positives from face-detection (poor lighting) | Log flags but never auto-disqualify; always require human sign-off |
| Privacy concerns over webcam snapshots | Store only flagged-moment thumbnails (not full video) by default; document data retention policy in `SRS.md` |
| Scope creep into full commercial-grade AI proctoring | This PRD explicitly bounds MVP scope in Section 6 |

## 10. Open Questions
- Should subjective/short-answer questions be graded manually only, or should a rubric-based AI-assist grading be added as a stretch goal?
- Is a CSV bulk-import of students required for the demo, or is manual account creation acceptable?

---
*This PRD is a living document. Any AI assistant modifying the codebase should re-read this file before adding features outside the stated scope, and should flag scope conflicts instead of silently expanding scope.*
