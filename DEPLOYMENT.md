# Deployment Guide: Vercel Frontend + Render Backend

This guide explains how ProctoX is deployed and how authentication works in both **Standalone Demo Mode** (Vercel-only) and **Full-Stack Live Mode** (Vercel + Render/PostgreSQL).

---

## ⚡ Instant Vercel Preview (Demo Mode)

If you deployed the repository directly to Vercel, the React SPA is hosted as a static application. Because Vercel does not host the Python/Django backend or SQLite database by default, ProctoX includes a **built-in interactive Demo Mode**:

* **Zero Configuration Required:** Visiting your Vercel URL immediately allows login using the pre-seeded credentials.
* **Full Interactivity:** Mission Control, Course Management, Question Bank, Live Proctoring Room, Exam Builder, and the Grading Queue work out of the box with state persisted in browser `localStorage`.
* **Quick-Fill Buttons:** Tap the **⚡ Admin**, **⚡ Faculty**, or **⚡ Student** chips on the login screen to auto-fill credentials instantly on mobile or desktop.

### Pre-Configured Credentials

| Role | Username | Email | Password | Access Portal |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin@proctox.edu` | `AdminPass123!` | `/admin/login` or `/login` |
| **Faculty** | `faculty` | `faculty@proctox.edu` | `FacultyPass123!` | `/login` |
| **Student** | `student` | `student@proctox.edu` | `StudentPass123!` | `/login` |

---

## 🌐 Full-Stack Production Deployment (Vercel + Render)

To connect your Vercel frontend to a live Django REST API backend backed by PostgreSQL, follow these 3 steps:

### Step 1: Deploy Backend to Render (1-Click Blueprint)

1. Push this repository to your GitHub account.
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
3. Connect your repository. Render automatically reads [`render.yaml`](./render.yaml):
   - Provisions a free managed PostgreSQL database (`proctox-db`).
   - Provisions the Python web service (`proctox-backend`).
   - Runs migrations and seeds the demo credentials automatically via `python manage.py seed_demo_users`.
4. Note your Render backend service URL (e.g. `https://proctox-backend.onrender.com`).

### Step 2: Configure Environment Variables in Vercel

1. Open your project on [Vercel](https://vercel.com/dashboard) → **Settings** → **Environment Variables**.
2. Add the following variable:
   * **Key:** `VITE_API_BASE_URL`
   * **Value:** `https://<your-render-service>.onrender.com/api` *(include `/api`, no trailing slash)*
3. Trigger a redeploy: **Deployments** → **...** (on latest deployment) → **Redeploy**.

### Step 3: Configure Allowed Origins on Render (CORS)

In Render Dashboard → `proctox-backend` → **Environment**:
* Set `CORS_ALLOWED_ORIGINS` = `https://<your-project>.vercel.app` *(no trailing slash)*
* Set `CSRF_TRUSTED_ORIGINS` = `https://<your-project>.vercel.app` *(no trailing slash)*
* Click **Save Changes** (Render will automatically redeploy with CORS active).

---

## 🔍 Troubleshooting

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **"Invalid credentials" on Vercel** | Backend URL was defaulted to `http://localhost:8000`, which browsers block as Mixed Content on HTTPS. | The newly added demo interceptor now catches this automatically and signs you into Demo Mode. For a live backend, ensure `VITE_API_BASE_URL` is set in Vercel settings. |
| **Render cold starts** | Render free-tier web services sleep after 15 minutes of inactivity. | The first request after idle can take 30–50 seconds to wake up. Check `https://<your-render-service>.onrender.com/api/health/` to verify backend status. |
| **Database reset on Render** | If using SQLite instead of PostgreSQL, local disks are ephemeral on Render. | Ensure `DATABASE_URL` is configured to point to Render PostgreSQL (configured automatically by `render.yaml`). |

