import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../shared/hooks/useAuth';
import '../auth/Auth.css';

/**
 * Mission Control Portal — Unified staff entry point for both Faculty and Administrators.
 *
 * Security & RBAC:
 * - Faculty accounts land directly in the Faculty Dashboard (/faculty).
 * - Administrator accounts land directly in Mission Control (/admin).
 * - Students attempting to log in here are rejected and directed to the Student Portal.
 */
export const AdminLogin = () => {
  const navigate = useNavigate();
  const { user, login, logout } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If already authenticated with staff credentials, route to their respective portal
  if (user?.role === 'admin' || user?.is_superuser) {
    return <Navigate to="/admin" replace />;
  }
  if (user?.role === 'faculty') {
    return <Navigate to="/faculty" replace />;
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(formData.email, formData.password);
      const role = data.user?.role;
      const isSuper = data.user?.is_superuser;

      if (role !== 'admin' && role !== 'faculty' && !isSuper) {
        // Student credentials entered into Mission Control
        logout();
        setError('This portal is reserved for Faculty and Administrators. Please use the Student Portal to sign in.');
        return;
      }

      if (role === 'admin' || isSuper) {
        navigate('/admin');
      } else {
        navigate('/faculty');
      }
    } catch (err) {
      // Generic message — never reveal whether the email exists
      setError(err.response?.data?.error?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container auth-admin">
      <Link to="/login" className="floating-corner-btn" title="Back to Student Portal">
        <div className="admin-btn-left">
          <div className="corner-icon-small" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="admin-btn-text">
            <span className="admin-btn-title">Student Portal</span>
            <span className="admin-btn-sub">Student Examination Access</span>
          </div>
        </div>
        <span className="admin-btn-arrow" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </Link>

      <div className="admin-bg-shape shape-1"></div>
      <div className="admin-bg-shape shape-2"></div>
      <div className="admin-bg-shape shape-3"></div>

      <div className="auth-card premium-glass">
        <div className="auth-header premium-header">
          <div className="header-brand">
            <div className="admin-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 22 12 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 8L16 12M16 12L12 16M16 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="auth-badge glow-badge">Mission Control</span>
          </div>
          <h2 className="admin-login-heading">
            Faculty &amp; Admin Sign In
          </h2>
        </div>

        <ul className="auth-capabilities premium-caps">
          <li><span className="cap-dot"></span> Question Bank &amp; Builder</li>
          <li><span className="cap-dot"></span> Live Proctor Monitor</li>
          <li><span className="cap-dot"></span> Grading &amp; Overview</li>
        </ul>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message glass-error" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group premium-input-wrapper">
            <label htmlFor="admin-email">Staff email or username</label>
            <div className="input-with-icon">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input
                type="text"
                id="admin-email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="admin@proctox.edu or faculty@proctox.edu"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group premium-input-wrapper">
            <label htmlFor="admin-password">Secure passphrase</label>
            <div className="input-with-icon">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                type="password"
                id="admin-password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          </div>

          <div className="demo-credentials-helper admin-helper">
            <span className="demo-helper-label">
              ⚡ Staff Quick Demo Fill:
            </span>
            <div className="demo-helper-chips">
              <button
                type="button"
                className="demo-chip-btn premium-chip"
                onClick={() => setFormData({ email: 'admin@proctox.edu', password: 'AdminPass123!' })}
              >
                ⚡ Admin
              </button>
              <button
                type="button"
                className="demo-chip-btn premium-chip"
                onClick={() => setFormData({ email: 'faculty@proctox.edu', password: 'FacultyPass123!' })}
              >
                ⚡ Faculty
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary btn-premium" disabled={loading}>
            {loading ? 'Authenticating...' : 'Sign In to Mission Control →'}
          </button>
        </form>
      </div>
    </div>
  );
};