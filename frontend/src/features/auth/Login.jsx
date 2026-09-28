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
      <div className="auth-split">
        <div className="auth-panel" aria-hidden="true">
          <span className="auth-badge">ProctorU · Secure exams</span>
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
            <span className="auth-badge">Exam Portal</span>
            <h1>Welcome back</h1>
            <h2>Log in to your examination account</h2>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
                disabled={loading}
                placeholder="you@example.edu"
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

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Logging in...' : 'Login →'}
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
            <p>
              Administrator? <Link to="/admin/login">Sign in to Mission Control</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
