import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../shared/hooks/useAuth';
import './Auth.css';

/**
 * Login page (UI_UX_SPEC.md §4.1)
 * Implements SRS.md FR-3: JWT-based login
 */
export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError(''); // Clear error on input change
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(formData.email, formData.password);
      // Redirect based on role will be handled by App routing
      navigate('/');
    } catch (err) {
      // Generic error message per UI_UX_SPEC.md §4.1
      setError(err.response?.data?.error?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Link to="/admin/login" className="floating-admin-btn" title="Access Mission Control">
        <div className="admin-btn-left">
          <div className="admin-icon-small" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 22 12 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 8L16 12M16 12L12 16M16 12H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="admin-btn-text">
            <span className="admin-btn-title">Mission Control</span>
            <span className="admin-btn-sub">Faculty &amp; Admin Access</span>
          </div>
        </div>
        <span className="admin-btn-arrow" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </Link>

      <div className="auth-split">
        <div className="auth-panel" aria-hidden="true">
          <span className="auth-badge">ProctoX · Secure exams</span>
          <h2>Calm exams.<br />Clear integrity.</h2>
          <p>Server-timed attempts, deterministic shuffling and human-reviewed flags — no auto-fails, no surveillance theatre.</p>
          <ul className="auth-points">
            <li><span className="tick">✓</span> Countdown is display-only; the server decides expiry</li>
            <li><span className="tick">✓</span> Flags go to faculty for review, never auto-disqualify</li>
            <li><span className="tick">✓</span> Thumbnails only — continuous video never leaves your device</li>
          </ul>
        </div>
        <div className="auth-card">
          <div className="auth-header">
            <span className="auth-badge">Student Portal</span>
            <h1>Student Sign In</h1>
            <h2>Access your proctored exams, system check &amp; results</h2>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Student Email or Username</label>
              <input
                type="text"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={loading}
                placeholder="student@proctox.edu or student"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="demo-credentials-helper">
              <span className="demo-helper-label">Quick Student Demo:</span>
              <div className="demo-helper-chips">
                <button
                  type="button"
                  className="demo-chip-btn demo-student-chip"
                  style={{ width: '100%', padding: '0.55rem 0.85rem' }}
                  onClick={() => setFormData({ email: 'student@proctox.edu', password: 'StudentPass123!' })}
                >
                  ⚡ Fill Student Demo Credentials
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In as Student →'}
            </button>
          </form>

          <div className="auth-trust">
            <span>JWT secured</span>
            <span>Role-checked</span>
            <span>Server-timed</span>
          </div>

          <div className="auth-footer">
            <p>
              Don&apos;t have an account? <Link to="/register">Register as Student</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
