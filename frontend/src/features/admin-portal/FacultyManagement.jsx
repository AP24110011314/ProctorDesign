import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { adminService } from '../../shared/api-client/adminService';
import './FacultyManagement.css';

/**
 * Faculty Management for Admins (Mission Control).
 * Allows platform administrators to:
 * - View all registered faculty members & instructor accounts
 * - Inspect assigned courses per faculty
 * - Provision new faculty accounts with secure initial credentials
 * - Copy provisioned credentials for instructor onboarding
 */

const emptyForm = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  password: '',
  phone: '',
};

const generateSecurePassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let pass = 'Fac@';
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass + '1!';
};

export const FacultyManagement = () => {
  const navigate = useNavigate();
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [provisionedCreds, setProvisionedCreds] = useState(null);
  const [copied, setCopied] = useState(false);

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);

  useEffect(() => {
    loadFaculty();
  }, []);

  useEffect(() => {
    if (showModal && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [showModal]);

  const loadFaculty = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await adminService.listFaculty();
      setFaculty(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
        err.response?.data?.detail ||
        'Failed to load faculty directory'
      );
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setFormData({
      ...emptyForm,
      password: generateSecurePassword(),
    });
    setFormErrors({});
    setShowPassword(true);
    setProvisionedCreds(null);
    setCopied(false);
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setProvisionedCreds(null);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.username.trim()) {
      errs.username = 'Username is required';
    } else if (formData.username.trim().length < 3) {
      errs.username = 'Username must be at least 3 characters';
    }

    if (!formData.email.trim()) {
      errs.email = 'Institutional email is required';
    } else if (!formData.email.includes('@') || !formData.email.includes('.')) {
      errs.email = 'Please enter a valid institutional email';
    }

    if (!formData.password) {
      errs.password = 'Initial password is required';
    } else if (formData.password.length < 8) {
      errs.password = 'Password must be at least 8 characters';
    }

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    setError('');

    try {
      const payload = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        phone: formData.phone.trim(),
      };

      const created = await adminService.createFaculty(payload);
      
      setProvisionedCreds({
        name: created.display_name || `${payload.first_name} ${payload.last_name}`.trim() || payload.username,
        username: payload.username,
        email: payload.email,
        password: payload.password,
      });

      setNotice(`Faculty account provisioned successfully for ${created.display_name || payload.username}`);
      await loadFaculty();
    } catch (err) {
      const respData = err.response?.data;
      if (respData && typeof respData === 'object') {
        const fieldErrs = {};
        for (const [key, val] of Object.entries(respData)) {
          if (Array.isArray(val) && val.length > 0) {
            fieldErrs[key] = val[0];
          } else if (typeof val === 'string') {
            fieldErrs[key] = val;
          }
        }
        if (Object.keys(fieldErrs).length > 0) {
          setFormErrors(fieldErrs);
          return;
        }
      }
      setError(
        err.response?.data?.error?.message ||
        err.response?.data?.detail ||
        'Failed to provision faculty account'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCredentials = () => {
    if (!provisionedCreds) return;
    const text = `ProctoX Faculty Portal Credentials:\nEmail / Username: ${provisionedCreds.email} (${provisionedCreds.username})\nTemporary Password: ${provisionedCreds.password}\nPortal Link: ${window.location.origin}/admin/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  // Filtered faculty list
  const filtered = faculty.filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (f.display_name || `${f.first_name} ${f.last_name}`).toLowerCase();
    const email = (f.email || '').toLowerCase();
    const user = (f.username || '').toLowerCase();
    return name.includes(q) || email.includes(q) || user.includes(q);
  });

  const totalCourses = faculty.reduce(
    (acc, f) => acc + (f.course_count || f.courses?.length || 0),
    0
  );

  return (
    <div className="faculty-mgmt">
      <div className="page-header">
        <div>
          <h1>Faculty Directory &amp; Provisioning</h1>
          <p className="page-subtitle">
            Manage institutional faculty accounts, provision new instructors, and track course assignments.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary add-faculty-btn"
          onClick={openCreateModal}
        >
          <span aria-hidden="true">+</span> Add New Faculty
        </button>
      </div>

      {notice && (
        <div className="alert-banner alert-success" role="status">
          <span>{notice}</span>
          <button type="button" className="alert-close" onClick={() => setNotice('')}>✕</button>
        </div>
      )}

      {error && (
        <div className="alert-banner alert-error" role="alert">
          <span>{error}</span>
          <button type="button" className="alert-close" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* Metrics Strip */}
      <div className="faculty-stat-grid">
        <div className="faculty-stat-card">
          <div className="stat-value">{faculty.length}</div>
          <div className="stat-label">Registered Instructors</div>
        </div>
        <div className="faculty-stat-card">
          <div className="stat-value">{faculty.filter((f) => f.is_active !== false).length}</div>
          <div className="stat-label">Active Accounts</div>
        </div>
        <div className="faculty-stat-card">
          <div className="stat-value">{totalCourses}</div>
          <div className="stat-label">Course Assignments</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="faculty-search-bar">
        <div className="search-input-wrap">
          <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search by instructor name, username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search faculty"
          />
        </div>
      </div>

      {/* Directory Table / Cards */}
      <div className="faculty-table-card">
        {loading ? (
          <div className="loading-state">
            <div className="spinner" aria-hidden="true"></div>
            <p>Loading faculty directory...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>No faculty members found matching your search.</p>
            {search && (
              <button type="button" className="btn-secondary" onClick={() => setSearch('')}>
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div className="responsive-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr>
                  <th>Faculty Member</th>
                  <th>Username</th>
                  <th>Institutional Email</th>
                  <th>Assigned Courses</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const initial = (item.display_name || item.username || 'F').charAt(0).toUpperCase();
                  const courses = item.courses || [];
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="faculty-profile-cell">
                          <span className="faculty-avatar" aria-hidden="true">{initial}</span>
                          <div>
                            <div className="faculty-name-text">
                              {item.display_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.username}
                            </div>
                            <span className="faculty-role-tag">Instructor</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <code className="username-code">@{item.username}</code>
                      </td>
                      <td>
                        <a href={`mailto:${item.email}`} className="email-link">
                          {item.email}
                        </a>
                      </td>
                      <td>
                        {courses.length > 0 ? (
                          <div className="courses-pill-list">
                            {courses.map((c) => (
                              <span key={c} className="course-code-pill" title={`Assigned course ${c}`}>
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="no-courses-text">No courses assigned</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${item.is_active !== false ? 'active' : 'inactive'}`}>
                          {item.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <Link
                          to="/admin/courses"
                          className="table-action-link"
                          title="Assign courses in Course Management"
                        >
                          Manage Courses →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Provision Faculty Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={closeModal} role="presentation">
          <div
            className="modal faculty-modal"
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-faculty-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-badge">Mission Control</span>
                <h2 id="modal-faculty-title">
                  {provisionedCreds ? 'Account Provisioned' : 'Add New Faculty Member'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={closeModal}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {provisionedCreds ? (
              <div className="creds-success-body">
                <div className="creds-badge-circle" aria-hidden="true">✓</div>
                <h3>Instructor Account Ready</h3>
                <p className="creds-intro">
                  The faculty account for <strong>{provisionedCreds.name}</strong> has been created.
                  Share these credentials with the instructor so they can access Mission Control.
                </p>

                <div className="creds-summary-box">
                  <div className="creds-row">
                    <span className="creds-label">Username:</span>
                    <code className="creds-val">{provisionedCreds.username}</code>
                  </div>
                  <div className="creds-row">
                    <span className="creds-label">Email:</span>
                    <code className="creds-val">{provisionedCreds.email}</code>
                  </div>
                  <div className="creds-row">
                    <span className="creds-label">Initial Password:</span>
                    <code className="creds-val">{provisionedCreds.password}</code>
                  </div>
                  <div className="creds-row">
                    <span className="creds-label">Portal:</span>
                    <span className="creds-val">Mission Control (/admin/login)</span>
                  </div>
                </div>

                <div className="creds-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleCopyCredentials}
                  >
                    {copied ? '✓ Copied to Clipboard!' : '📋 Copy Credentials'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeModal}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="faculty-form">
                <p className="form-helper-text">
                  Provision an official instructor account. The new faculty member can log in via Mission Control to create questions, manage exams, and evaluate student submissions.
                </p>

                <div className="form-row two-cols">
                  <div className="form-group">
                    <label htmlFor="first_name">First Name</label>
                    <input
                      type="text"
                      id="first_name"
                      name="first_name"
                      ref={firstInputRef}
                      value={formData.first_name}
                      onChange={handleInputChange}
                      placeholder="e.g. Marie"
                      disabled={saving}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="last_name">Last Name</label>
                    <input
                      type="text"
                      id="last_name"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleInputChange}
                      placeholder="e.g. Curie"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="username">
                    Username <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    placeholder="e.g. prof.curie or mcurie"
                    required
                    autoComplete="off"
                    disabled={saving}
                    className={formErrors.username ? 'input-error' : ''}
                  />
                  {formErrors.username && (
                    <span className="field-error">{formErrors.username}</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="email">
                    Institutional Email <span className="req">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="e.g. curie@proctox.edu"
                    required
                    autoComplete="off"
                    disabled={saving}
                    className={formErrors.email ? 'input-error' : ''}
                  />
                  {formErrors.email && (
                    <span className="field-error">{formErrors.email}</span>
                  )}
                </div>

                <div className="form-group">
                  <div className="password-label-row">
                    <label htmlFor="password">
                      Initial Password <span className="req">*</span>
                    </label>
                    <button
                      type="button"
                      className="text-btn-generate"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          password: generateSecurePassword(),
                        }))
                      }
                    >
                      ⚡ Generate Random
                    </button>
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      placeholder="Min. 8 characters"
                      required
                      disabled={saving}
                      className={formErrors.password ? 'input-error' : ''}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {formErrors.password && (
                    <span className="field-error">{formErrors.password}</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="phone">Phone Number (Optional)</label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="+1 (555) 019-2834"
                    disabled={saving}
                  />
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={saving}
                  >
                    {saving ? 'Provisioning...' : 'Provision Faculty Account'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};