import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './shared/hooks/useAuth';
import { ProtectedRoute } from './shared/components/ProtectedRoute';
import { Login } from './features/auth/Login';
import { Register } from './features/auth/Register';
import { QuestionBank } from './features/faculty-portal/QuestionBank';
import { ExamBuilder } from './features/faculty-portal/ExamBuilder';
import { ExamManagement } from './features/faculty-portal/ExamManagement';
import { GradingQueue } from './features/faculty-portal/GradingQueue';
import { ResultsReport } from './features/faculty-portal/ResultsReport';
import { LiveMonitor } from './features/faculty-portal/LiveMonitor';
import { MyExams } from './features/student-portal/MyExams';
import { MyResults } from './features/student-portal/MyResults';
import { SystemCheck } from './features/student-portal/SystemCheck';
import { ExamTaking } from './features/student-portal/ExamTaking';
import { SystemOverview } from './features/admin-portal/SystemOverview';
import { CourseManagement } from './features/admin-portal/CourseManagement';
import { AdminLogin } from './features/admin-portal/AdminLogin';
import { isDemoModeActive } from './shared/api-client/demoMockService';
import './App.css';

const Icon = ({ children }) => <span className="nav-icon" aria-hidden="true">{children}</span>;

const Topbar = ({ onToggleNav, isNavOpen, hasNav }) => {
  const { user, displayRole, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initial = (user?.email || user?.username || '?').charAt(0).toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-left">
        {hasNav && (
          <button
            type="button"
            className="mobile-nav-toggle"
            onClick={onToggleNav}
            aria-label={isNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={isNavOpen}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {isNavOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        )}
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <path d="M32 3 C47 3 58 11 58 23 C58 43 43 55 32 61 C21 55 6 43 6 23 C6 11 17 3 32 3 Z" fill="currentColor" opacity="0.95" />
              <path d="M14 31 C20 20 25.5 16 32 16 C38.5 16 44 20 50 31 C44 42 38.5 46 32 46 C25.5 46 20 42 14 31 Z" fill="#FCF9EA" stroke="#2E2A23" strokeWidth="2.2" />
              <circle cx="32" cy="31" r="7" fill="#2E2A23" />
              <circle cx="32" cy="31" r="3.5" fill="#DB9558" />
              <circle cx="45" cy="45" r="9" fill="#57693F" stroke="#FFFFFF" strokeWidth="2" />
              <path d="M41 45 L43.5 47.5 L49 42" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-text">
            ProctoX
            <small>Secure exams · Fair results</small>
          </span>
        </div>
      </div>
      {user && (
        <div className="topbar-user">
          {isDemoModeActive() && (
            <span className="demo-mode-pill" title="Running in standalone interactive demo mode">
              Demo
            </span>
          )}
          <span className={`role-badge ${displayRole}`}>{displayRole}</span>
          <span className="avatar-circle" title={user.email} aria-hidden="true">{initial}</span>
          <span className="user-email-text">{user.email}</span>
          <button className="btn-logout" onClick={handleLogout} title="Sign out of your account">
            Logout
          </button>
        </div>
      )}
    </header>
  );
};

const Shell = ({ title, links, children, footNote }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMenu = () => setMobileMenuOpen(false);
  const toggleMenu = () => setMobileMenuOpen((prev) => !prev);

  return (
    <div className="app-shell">
      <Topbar onToggleNav={toggleMenu} isNavOpen={mobileMenuOpen} hasNav={Boolean(links?.length)} />
      
      {/* Backdrop for mobile drawer */}
      {mobileMenuOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      <div className="layout">
        <nav
          className={`sidenav ${mobileMenuOpen ? 'mobile-open' : ''}`}
          aria-label={`${title} navigation`}
        >
          <div className="sidenav-header-mobile">
            <div className="sidenav-title">{title} Portal</div>
            <button
              type="button"
              className="sidenav-close-btn"
              onClick={closeMenu}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>
          <div className="sidenav-links-list">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={closeMenu}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <Icon>{link.icon}</Icon> <span>{link.label}</span>
              </NavLink>
            ))}
          </div>
          <div className="sidenav-foot">{footNote || 'Flags are for human review — the system never auto-fails an attempt.'}</div>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
};

const StudentDashboard = () => (
  <Shell
    title="Student"
    footNote="Camera stays on during exams. Tab switches and fullscreen exits are logged for faculty review."
    links={[
      { to: '/student', label: 'Home', icon: '⌂', end: true },
      { to: '/student/exams', label: 'My Exams', icon: '✎' },
      { to: '/student/results', label: 'My Results', icon: '◔' },
    ]}
  >
    <Routes>
      <Route
        index
        element={
          <div className="page">
            <div className="hero-strip">
              <div>
                <h2>Ready when you are.</h2>
                <p>Your upcoming exams, active attempts and published results live here. Enter via System Check when your window opens.</p>
              </div>
            </div>
            <MyExams />
          </div>
        }
      />
      <Route path="exams" element={<MyExams />} />
      <Route path="results" element={<MyResults />} />
      <Route path="exams/:examId/check" element={<SystemCheck />} />
      <Route path="attempts/:attemptId/take" element={<ExamTaking />} />
    </Routes>
  </Shell>
);

const FacultyDashboard = () => (
  <Shell
    title="Faculty"
    links={[
      { to: '/faculty', label: 'Home', icon: '⌂', end: true },
      { to: '/faculty/questions', label: 'Question Bank', icon: '▤' },
      { to: '/faculty/exams', label: 'Manage Exams', icon: '⊞' },
      { to: '/faculty/exams/build', label: 'Exam Builder', icon: '⚙' },
      { to: '/faculty/grading', label: 'Grading Queue', icon: '✎' },
      { to: '/faculty/results', label: 'Results Report', icon: '◔' },
      { to: '/faculty/monitor', label: 'Live Monitoring', icon: '◎' },
    ]}
  >
    <Routes>
      <Route
        index
        element={
          <div className="page">
            <div className="hero-strip">
              <div>
                <h2>Teach, assess, trust the process.</h2>
                <p>Build questions and exams, grade answers and monitor attempts — flags surface what happened, you decide what it means.</p>
              </div>
              <div className="hero-actions">
                <NavLink className="btn-primary" to="/faculty/exams/build">New exam</NavLink>
                <NavLink className="btn-secondary" to="/faculty/monitor">Live monitor</NavLink>
              </div>
            </div>
            <div className="stat-row">
              <div className="mini-stat"><strong>Bank</strong><span>Questions by topic</span></div>
              <div className="mini-stat"><strong>Build</strong><span>Draft → publish</span></div>
              <div className="mini-stat"><strong>Grade</strong><span>Subjective queue</span></div>
              <div className="mini-stat"><strong>Review</strong><span>Integrity flags</span></div>
            </div>
            <p className="page-subtitle">Use the sidebar to jump into a workflow. Server-side RBAC enforces every action; the UI is just navigation.</p>
          </div>
        }
      />
      <Route path="questions" element={<QuestionBank />} />
      <Route path="exams" element={<ExamManagement />} />
      <Route path="exams/build" element={<ExamBuilder />} />
      <Route path="grading" element={<GradingQueue />} />
      <Route path="results" element={<ResultsReport />} />
      <Route path="monitor" element={<LiveMonitor />} />
    </Routes>
  </Shell>
);

const AdminDashboard = () => (
  <Shell
    title="Mission Control"
    footNote="Admin actions are audited. Voiding and overrides require a reason and are logged."
    links={[
      { to: '/admin', label: 'System Overview', icon: '◈', end: true },
      { to: '/admin/courses', label: 'Courses', icon: '▤' },
      { to: '/admin/exams', label: 'Manage Exams', icon: '⊞' },
      { to: '/admin/exams/build', label: 'Roll Out Test', icon: '➤' },
      { to: '/admin/questions', label: 'Question Bank', icon: '▤' },
      { to: '/admin/monitor', label: 'Live Monitoring', icon: '◎' },
      { to: '/admin/grading', label: 'Grading Queue', icon: '✎' },
      { to: '/admin/results', label: 'Results & Integrity', icon: '◔' },
    ]}
  >
    <Routes>
      <Route index element={<SystemOverview />} />
      <Route path="overview" element={<SystemOverview />} />
      <Route path="courses" element={<CourseManagement />} />
      {/* Admins reuse the faculty workflows server-side RBAC already allows
          FACULTY + ADMIN on all exam/grading/proctoring endpoints. */}
      <Route path="exams" element={<ExamManagement />} />
      <Route path="exams/build" element={<ExamBuilder />} />
      <Route path="questions" element={<QuestionBank />} />
      <Route path="monitor" element={<LiveMonitor />} />
      <Route path="grading" element={<GradingQueue />} />
      <Route path="results" element={<ResultsReport />} />
    </Routes>
  </Shell>
);
const Unauthorized = () => (
  <div className="unauthorized">
    <span className="role-badge admin">403</span>
    <h1 style={{ margin: '0.7rem 0 0.35rem' }}>Unauthorized</h1>
    <p className="page-subtitle" style={{ marginBottom: '1.2rem' }}>You don&apos;t have permission to access this resource. Switch to an account with the right role.</p>
    <a className="btn-primary" href="/login">Back to login</a>
  </div>
);

// Role-based redirect after login
const RoleBasedRedirect = () => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  switch (user.role) {
    case 'student':
      // Superusers land in Mission Control even if their role field is 'student'.
      return <Navigate to={user.is_superuser ? '/admin' : '/student'} replace />;
    case 'faculty':
      return <Navigate to={user.is_superuser ? '/admin' : '/faculty'} replace />;
    case 'admin':
      return <Navigate to="/admin" replace />;
    default:
      return <Navigate to={user.is_superuser ? '/admin' : '/unauthorized'} replace />;
  }
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* Role-based landing */}
      <Route path="/" element={<RoleBasedRedirect />} />

      {/* Student routes */}
      <Route
        path="/student/*"
        element={
          <ProtectedRoute allowedRoles={['student']}>
            <StudentDashboard />
          </ProtectedRoute>
        }
      />

      {/* Faculty routes */}
      <Route
        path="/faculty/*"
        element={
          <ProtectedRoute allowedRoles={['faculty']}>
            <FacultyDashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin routes */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
