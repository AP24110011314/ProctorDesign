import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { adminService } from '../../shared/api-client/adminService';
import './FacultyManagement.css';

/**
 * Faculty Management for Admins (Mission Control).
 * Allows platform administrators to:
 * - View all registered faculty members & instructor accounts
 * - Inspect assigned courses per faculty
 * - Provision new faculty accounts with initial credentials AND assign their courses immediately
 * - Reassign or edit courses for existing faculty members
 * - Copy provisioned credentials for instructor onboarding
 */

const emptyForm = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  password: '',
  phone: '',
  course_ids: [],
  create_new_course: false,
  new_course_code: '',
  new_course_name: '',
  new_course_description: '',
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
  const [faculty, setFaculty] = useState([]);
  const [availableCourses, setAvailableCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  // Add Faculty Modal
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [provisionedCreds, setProvisionedCreds] = useState(null);
  const [copied, setCopied] = useState(false);

  // Edit Courses Modal (for existing faculty)
  const [editingFacultyCourses, setEditingFacultyCourses] = useState(null);
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [savingCourses, setSavingCourses] = useState(false);

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);

  useEffect(() => {
    loadFaculty();
    loadCourses();
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

  const loadCourses = async () => {
    try {
      const data = await adminService.listCourses({ is_active: 'true' });
      setAvailableCourses(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      console.error('Failed to load courses', e);
    }
  };

  const openCreateModal = () => {
    setFormData({
      ...emptyForm,
      password: generateSecurePassword(),
      course_ids: availableCourses.length > 0 ? [availableCourses[0].id] : [],
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
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (formErrors[name] || formErrors.courses) {
      setFormErrors((prev) => ({ ...prev, [name]: '', courses: '' }));
    }
  };

  const handleCourseCheckboxToggle = (courseId) => {
    setFormData((prev) => {
      const exists = prev.course_ids.includes(courseId);
      const updated = exists
        ? prev.course_ids.filter((id) => id !== courseId)
        : [...prev.course_ids, courseId];
      return { ...prev, course_ids: updated };
    });
    if (formErrors.courses) {
      setFormErrors((prev) => ({ ...prev, courses: '' }));
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

    // Require at least one course assignment
    const hasExistingCourse = formData.course_ids.length > 0;
    const hasNewCourse = formData.create_new_course && formData.new_course_code.trim();

    if (!hasExistingCourse && !hasNewCourse) {
      errs.courses = 'Please assign at least one course to grant this instructor question bank and exam building privileges.';
    }

    if (formData.create_new_course) {
      if (!formData.new_course_code.trim()) {
        errs.new_course_code = 'Course code is required (e.g. CS301)';
      }
      if (!formData.new_course_name.trim()) {
        errs.new_course_name = 'Course title is required';
      }
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
        course_ids: formData.course_ids,
        new_course_code: formData.create_new_course ? formData.new_course_code.trim().toUpperCase() : '',
        new_course_name: formData.create_new_course ? formData.new_course_name.trim() : '',
        new_course_description: formData.create_new_course ? formData.new_course_description.trim() : '',
      };

      const created = await adminService.createFaculty(payload);
      const assignedCodes = created.courses || [];
      
      setProvisionedCreds({
        name: created.display_name || `${payload.first_name} ${payload.last_name}`.trim() || payload.username,
        username: payload.username,
        email: payload.email,
        password: payload.password,
        courses: assignedCodes,
      });

      setNotice(
        `Faculty account provisioned successfully for ${created.display_name || payload.username} with course(s): ${assignedCodes.join(', ') || 'None'}`
      );
      await loadFaculty();
      await loadCourses();
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
    const coursesStr = provisionedCreds.courses?.length > 0 ? provisionedCreds.courses.join(', ') : 'None assigned';
    const text = `ProctoX Faculty Portal Credentials:\nEmail / Username: ${provisionedCreds.email} (${provisionedCreds.username})\nTemporary Password: ${provisionedCreds.password}\nAssigned Courses: ${coursesStr}\nPortal Link: ${window.location.origin}/admin/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  // Manage courses for existing faculty
  const openEditCourses = (fac) => {
    setEditingFacultyCourses(fac);
    const currentCodes = fac.courses || [];
    const initialIds = availableCourses
      .filter((c) => currentCodes.includes(c.code))
      .map((c) => c.id);
    setSelectedCourseIds(initialIds);
  };

  const handleSaveCoursesForFaculty = async () => {
    if (!editingFacultyCourses) return;
    try {
      setSavingCourses(true);
      await adminService.assignFacultyCourses(editingFacultyCourses.id, selectedCourseIds);
      setNotice(`Course assignments updated successfully for ${editingFacultyCourses.display_name}`);
      setEditingFacultyCourses(null);
      await loadFaculty();
      await loadCourses();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to update course assignments');
    } finally {
      setSavingCourses(false);
    }
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
            Manage institutional faculty accounts, provision new instructors, and assign courses to grant exam privileges.
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
          <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
                          <span className="no-courses-warning" title="No courses assigned — instructor cannot build exams until assigned">
                            ⚠️ Unassigned
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${item.is_active !== false ? 'active' : 'inactive'}`}>
                          {item.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions-group">
                          <button
                            type="button"
                            className="table-action-link"
                            onClick={() => openEditCourses(item)}
                            title="Assign or change courses for this instructor"
                          >
                            ✎ Assign Courses
                          </button>
                          <Link
                            to="/admin/courses"
                            className="table-action-link secondary-link"
                            title="Open Course Management"
                          >
                            Courses →
                          </Link>
                        </div>
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
                  The faculty account for <strong>{provisionedCreds.name}</strong> has been created with full faculty privileges.
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
                    <span className="creds-label">Assigned Courses:</span>
                    <span className="creds-val courses-tag-group">
                      {provisionedCreds.courses?.length > 0
                        ? provisionedCreds.courses.map((c) => (
                            <span key={c} className="course-code-pill">{c}</span>
                          ))
                        : 'None'}
                    </span>
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
                  Provision an official instructor account and assign their academic scope. Assigned courses grant the instructor full privileges to create questions, schedule exams, and grade student submissions.
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

                {/* Course Privileges & Academic Scope Section */}
                <div className="course-assignment-section">
                  <div className="course-section-header">
                    <label className="section-title">
                      Assigned Course(s) <span className="req">*</span>
                    </label>
                    <span className="scope-badge">Faculty Privileges</span>
                  </div>
                  <p className="course-section-hint">
                    Select existing course(s) or add a new one. This grants the faculty member ownership to create questions, manage exams, and view attempts.
                  </p>

                  {formErrors.courses && (
                    <div className="field-error course-error-banner" role="alert">
                      {formErrors.courses}
                    </div>
                  )}

                  {/* Existing courses selection */}
                  {availableCourses.length > 0 ? (
                    <div className="course-checkbox-list">
                      {availableCourses.map((c) => {
                        const isChecked = formData.course_ids.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className={`course-choice-card ${isChecked ? 'selected' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleCourseCheckboxToggle(c.id)}
                              disabled={saving}
                            />
                            <div className="course-choice-text">
                              <div className="course-choice-header">
                                <span className="choice-code">{c.code}</span>
                                {c.faculty_name && (
                                  <span className="current-instructor-tag">
                                    Current: {c.faculty_name}
                                  </span>
                                )}
                              </div>
                              <span className="choice-name">{c.name}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="no-existing-courses">No courses currently exist in the system.</p>
                  )}

                  {/* Option to create a new course directly */}
                  <div className="new-course-toggle-box">
                    <label className="toggle-checkbox-label">
                      <input
                        type="checkbox"
                        name="create_new_course"
                        checked={formData.create_new_course}
                        onChange={handleInputChange}
                        disabled={saving}
                      />
                      <span className="toggle-label-text">
                        + Create and assign a brand new course for this instructor
                      </span>
                    </label>

                    {formData.create_new_course && (
                      <div className="new-course-inline-form">
                        <div className="form-row two-cols">
                          <div className="form-group">
                            <label htmlFor="new_course_code">
                              Course Code <span className="req">*</span>
                            </label>
                            <input
                              type="text"
                              id="new_course_code"
                              name="new_course_code"
                              value={formData.new_course_code}
                              onChange={handleInputChange}
                              placeholder="e.g. CS301"
                              disabled={saving}
                              className={formErrors.new_course_code ? 'input-error' : ''}
                            />
                            {formErrors.new_course_code && (
                              <span className="field-error">{formErrors.new_course_code}</span>
                            )}
                          </div>
                          <div className="form-group">
                            <label htmlFor="new_course_name">
                              Course Title <span className="req">*</span>
                            </label>
                            <input
                              type="text"
                              id="new_course_name"
                              name="new_course_name"
                              value={formData.new_course_name}
                              onChange={handleInputChange}
                              placeholder="e.g. Advanced Operating Systems"
                              disabled={saving}
                              className={formErrors.new_course_name ? 'input-error' : ''}
                            />
                            {formErrors.new_course_name && (
                              <span className="field-error">{formErrors.new_course_name}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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
                    {saving ? 'Provisioning...' : 'Provision Faculty & Assign Courses'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Courses Modal for Existing Faculty */}
      {editingFacultyCourses && (
        <div className="modal-backdrop" onClick={() => setEditingFacultyCourses(null)} role="presentation">
          <div
            className="modal faculty-modal course-assign-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-assign-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-badge">Course Management</span>
                <h2 id="modal-assign-title">
                  Assign Courses: {editingFacultyCourses.display_name}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditingFacultyCourses(null)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <p className="form-helper-text">
              Select which course(s) <strong>{editingFacultyCourses.display_name}</strong> ({editingFacultyCourses.email}) is authorized to manage. Assigned courses grant question bank, exam authoring, and grading privileges.
            </p>

            <div className="course-checkbox-list">
              {availableCourses.map((c) => {
                const isSelected = selectedCourseIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={`course-choice-card ${isSelected ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {
                        setSelectedCourseIds((prev) =>
                          prev.includes(c.id)
                            ? prev.filter((id) => id !== c.id)
                            : [...prev, c.id]
                        );
                      }}
                      disabled={savingCourses}
                    />
                    <div className="course-choice-text">
                      <div className="course-choice-header">
                        <span className="choice-code">{c.code}</span>
                        {c.faculty_name && c.faculty_name !== editingFacultyCourses.display_name && (
                          <span className="current-instructor-tag">
                            Current: {c.faculty_name}
                          </span>
                        )}
                      </div>
                      <span className="choice-name">{c.name}</span>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditingFacultyCourses(null)}
                disabled={savingCourses}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveCoursesForFaculty}
                disabled={savingCourses}
              >
                {savingCourses ? 'Updating...' : 'Save Course Assignments'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};