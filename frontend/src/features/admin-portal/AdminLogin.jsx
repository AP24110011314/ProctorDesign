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
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-badge">Mission Control</span>
          <h1>Administrator sign in</h1>
          <h2>Roll out tests, monitor live, review integrity</h2>
        </div>

        <ul className="auth-capabilities">
          <li>Roll out &amp; publish exams</li>
          <li>Live monitoring room</li>
          <li>Integrity review &amp; void</li>
        </ul>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="admin-email">Admin email</label>
            <input
              type="email"
              id="admin-email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              type="password"
              id="admin-password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Verifying...' : 'Enter Mission Control'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Student or faculty? <Link to="/login">Main login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};
