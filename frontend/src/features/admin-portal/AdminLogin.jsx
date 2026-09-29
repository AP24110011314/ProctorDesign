import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../shared/hooks/useAuth';
import '../auth/Auth.css';

/**
 * Dedicated administrator entry point (separate from the student/faculty login).
 *
 * Security notes:
 * - Same JWT flow as the main login (authService.login) — no parallel auth
 *   system. Server-side RBAC is the real gate (system endpoints are
 *   admin-only; exam/grading/proctoring endpoints allow faculty + admin).
 * - Non-admin credentials are rejected here AND would 403 on every admin
 *   endpoint anyway; tokens are cleared on rejection.
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

  // Already signed in as admin → straight to mission control.
  if (user?.role === 'admin' || user?.is_superuser) {
    return <Navigate to="/admin" replace />;
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
      if (data.user?.role !== 'admin' && !data.user?.is_superuser) {
        // Valid credentials, wrong door — clear the session, deny entry.
        logout();
        setError('This portal is for administrators only. Use the main login for student or faculty access.');
        return;
      }
      navigate('/admin');
    } catch (err) {
      // Generic message — never reveal whether the email exists.
      setError(err.response?.data?.error?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container auth-admin">
      <div className="admin-bg-shape shape-1"></div>
      <div className="admin-bg-shape shape-2"></div>
      <div className="admin-bg-shape shape-3"></div>

      <div className="auth-card premium-glass">
        <div className="auth-header premium-header">
          <div className="header-brand">
            <div className="admin-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 8L16 12M16 12L12 16M16 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="auth-badge glow-badge">Mission Control</span>
          </div>
        </div>

        <ul className="auth-capabilities premium-caps">
          <li><span className="cap-dot"></span> Roll out &amp; publish exams</li>
          <li><span className="cap-dot"></span> Live monitoring room</li>
          <li><span className="cap-dot"></span> Integrity review &amp; void</li>
        </ul>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message glass-error" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group premium-input-wrapper">
            <label htmlFor="admin-email">Admin email</label>
            <div className="input-with-icon">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input
                type="email"
                id="admin-email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="commander@proctor.edu"
                autoComplete="email"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group premium-input-wrapper">
            <label htmlFor="admin-password">Secure passphrase</label>
            <div className="input-with-icon">
              <svg className="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

          <button type="submit" className="btn-primary btn-premium" disabled={loading}>
            {loading ? 'Authenticating...' : 'Engage System'}
          </button>
        </form>
      </div>

      <Link to="/login" className="floating-corner-btn">
        <div className="corner-icon-small">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span>Main Portal</span>
      </Link>
    </div>
  );
};
