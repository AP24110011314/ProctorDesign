import { useState, useEffect, useRef } from 'react';
import { adminService } from '../../shared/api-client/adminService';
import './CourseManagement.css';

/**
 * Course Management for Admins.
 * Admins create/edit courses and activate/deactivate them (never delete:
 * exams, questions, and attempts keep referencing their course).
 * Deactivated courses disappear from faculty creation dropdowns while
 * existing exams, attempts, and results keep working.
 */

const emptyForm = { code: '', name: '', description: '', is_active: true };

const fieldError = (err, field) => {
  const data = err.response?.data;
  if (data && Array.isArray(data[field]) && data[field].length > 0) {
    return String(data[field][0]);
  }
  return '';
};

const generalError = (err, fallback) =>
  err.response?.data?.error?.message ||
  err.response?.data?.detail ||
  fallback;

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const facultyDisplay = (f) => `${f.display_name} (${f.email})`;

export const CourseManagement = () => {
  const [courses, setCourses] = useState([]);
  const [facultyOptions, setFacultyOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [facultyQuery, setFacultyQuery] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [confirmToggle, setConfirmToggle] = useState(null);
  const [toggling, setToggling] = useState(false);

  const searchTimer = useRef(null);
  const codeInputRef = useRef(null);

  // Debounce the search box so we don't hammer the API per keystroke.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => {
    loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    adminService
      .getFacultyOptions()
      .then(setFacultyOptions)
      .catch(() => setFacultyOptions([]));
  }, []);

  useEffect(() => {
    if (showForm && codeInputRef.current) codeInputRef.current.focus();
  }, [showForm]);



  const loadCourses = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await adminService.listCourses({
        q: debouncedSearch || undefined,
        is_active:
          statusFilter === 'active'
            ? 'true'
            : statusFilter === 'inactive'
              ? 'false'
              : undefined,
      });
      setCourses(data.results || data);
    } catch (err) {
      setError(generalError(err, 'Failed to load courses'));
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormData(emptyForm);
    setFacultyQuery('');
    setFormErrors({});
    setShowForm(true);
  };

  const openEdit = (course) => {
    setEditing(course);
    setFormData({
      code: course.code || '',
      name: course.name || '',
      description: course.description || '',
      is_active: course.is_active,
    });
    setFacultyQuery(course.faculty_name || '');
    setFormErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setEditing(null);
    setFormErrors({});
  };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
    if (formErrors[name]) setFormErrors({ ...formErrors, [name]: '' });
  };

  const handleFacultyQueryChange = (e) => {
    setFacultyQuery(e.target.value);
    if (formErrors.faculty_name) setFormErrors({ ...formErrors, faculty_name: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!formData.code.trim()) errors.code = 'Course code is required.';
    if (!formData.name.trim()) errors.name = 'Course name is required.';
    if (!facultyQuery.trim()) errors.faculty_name = 'Faculty in-charge name is required.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // No optimistic updates: wait for the server, then reload.
    try {
      setSaving(true);
      setError('');
      const payload = {
        code: formData.code.trim(),
        name: formData.name.trim(),
        description: formData.description.trim(),
        faculty_name: facultyQuery.trim(),
        is_active: formData.is_active,
      };
      let saved;
      if (editing) {
        saved = await adminService.updateCourse(editing.id, payload);
        setNotice(
          saved?.linked_faculty
            ? `Course ${payload.code} updated (linked to faculty login ${saved.linked_faculty.email}).`
            : `Course ${payload.code} updated (“${payload.faculty_name}” kept as a label — no matching faculty login).`
        );
      } else {
        saved = await adminService.createCourse(payload);
        setNotice(
          saved?.linked_faculty
            ? `Course ${payload.code} created (linked to faculty login ${saved.linked_faculty.email}).`
            : `Course ${payload.code} created (“${payload.faculty_name}” kept as a label — no matching faculty login).`
        );
      }
      setShowForm(false);
      setEditing(null);
      loadCourses();
    } catch (err) {
      const serverErrors = {};
      for (const field of ['code', 'name', 'description', 'faculty_name', 'is_active']) {
        const msg = fieldError(err, field);
        if (msg) serverErrors[field] = msg;
      }
      if (Object.keys(serverErrors).length > 0) {
        setFormErrors(serverErrors);
      } else {
        setError(generalError(err, 'Failed to save course'));
        setShowForm(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!confirmToggle) return;
    try {
      setToggling(true);
      setError('');
      await adminService.updateCourse(confirmToggle.id, {
        is_active: !confirmToggle.is_active,
      });
      setNotice(
        confirmToggle.is_active
          ? `Course ${confirmToggle.code} deactivated. Existing exams, attempts, and results are unaffected.`
          : `Course ${confirmToggle.code} reactivated.`
      );
      setConfirmToggle(null);
      loadCourses();
    } catch (err) {
      setError(generalError(err, 'Failed to update course status'));
      setConfirmToggle(null);
    } finally {
      setToggling(false);
    }
  };

  const facultyCell = (course) => {
    if (!course.faculty_name) return 'Unassigned';
    return (
      <>
        {course.faculty_name}{' '}
        {course.linked_faculty ? (
          <span className="status-pill status-active">linked login</span>
        ) : (
          <span className="status-pill status-inactive">label only</span>
        )}
      </>
    );
  };

  return (
    <div className="course-mgmt">
      <div className="page-header">
        <div>
          <h1>Courses</h1>
          <p className="page-subtitle">
            Create courses and assign faculty. Deactivating hides a course from
            new exams and questions — existing exams, attempts, and results keep working.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreate}>
          + Add Course
        </button>
      </div>

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success-message" role="status">
          {notice}
        </div>
      )}

      <div className="filters" role="search">
        <input
          type="search"
          aria-label="Search courses by code or name"
          placeholder="Search by code or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading courses...</div>
      ) : courses.length === 0 ? (
        <div className="empty-state">
          <span className="empty-art" aria-hidden="true">
            ▤
          </span>
          <strong>No courses found</strong>
          <p>
            {debouncedSearch || statusFilter !== 'all'
              ? 'Try a different search or status filter.'
              : 'Create your first course to get started.'}
          </p>
          {!debouncedSearch && statusFilter === 'all' && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              + Add Course
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Assigned faculty</th>
                <th scope="col">Status</th>
                <th scope="col">Last updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>
                    <strong>{course.code}</strong>
                  </td>
                  <td>{course.name}</td>
                  <td>{facultyCell(course)}</td>
                  <td>
                    <span
                      className={`status-pill ${course.is_active ? 'status-active' : 'status-inactive'}`}
                    >
                      <span aria-hidden="true">
                        {course.is_active ? '●' : '○'}
                      </span>{' '}
                      {course.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{formatDateTime(course.updated_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => openEdit(course)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={
                          course.is_active ? 'btn-ghost btn-small' : 'btn-secondary btn-small'
                        }
                        onClick={() => setConfirmToggle(course)}
                        aria-label={
                          course.is_active
                            ? `Deactivate course ${course.code}`
                            : `Reactivate course ${course.code}`
                        }
                      >
                        {course.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'Edit course' : 'Add course'}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{editing ? 'Edit Course' : 'Add Course'}</h2>
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="course-code">Course code *</label>
                <input
                  ref={codeInputRef}
                  id="course-code"
                  name="code"
                  type="text"
                  value={formData.code}
                  onChange={handleFormChange}
                  placeholder="e.g. CS101"
                  aria-invalid={Boolean(formErrors.code)}
                  aria-describedby={formErrors.code ? 'course-code-error' : undefined}
                />
                {formErrors.code && (
                  <p className="field-error" id="course-code-error" role="alert">
                    {formErrors.code}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="course-name">Course name *</label>
                <input
                  id="course-name"
                  name="name"
                  type="text"
                  value={formData.name}
                  onChange={handleFormChange}
                  placeholder="e.g. Introduction to Programming"
                  aria-invalid={Boolean(formErrors.name)}
                  aria-describedby={formErrors.name ? 'course-name-error' : undefined}
                />
                {formErrors.name && (
                  <p className="field-error" id="course-name-error" role="alert">
                    {formErrors.name}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="course-description">Description</label>
                <textarea
                  id="course-description"
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  rows="3"
                  placeholder="Optional course description"
                />
                {formErrors.description && (
                  <p className="field-error" role="alert">
                    {formErrors.description}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="course-faculty">Faculty in-charge *</label>
                <input
                  id="course-faculty"
                  name="facultyQuery"
                  type="text"
                  list="course-faculty-list"
                  value={facultyQuery}
                  onChange={handleFacultyQueryChange}
                  placeholder="Type any faculty name..."
                  autoComplete="off"
                  aria-invalid={Boolean(formErrors.faculty_name)}
                  aria-describedby={
                    formErrors.faculty_name ? 'course-faculty-error' : 'course-faculty-hint'
                  }
                />
                <datalist id="course-faculty-list">
                  {facultyOptions.map((f) => (
                    <option key={f.id} value={facultyDisplay(f)} />
                  ))}
                </datalist>
                <p className="field-hint" id="course-faculty-hint">
                  Any name works. If it matches a registered faculty login, their
                  account is linked automatically so the course appears in their lists.
                </p>
                {formErrors.faculty_name && (
                  <p className="field-error" id="course-faculty-error" role="alert">
                    {formErrors.faculty_name}
                  </p>
                )}
              </div>

              <div className="form-group form-check">
                <input
                  id="course-is-active"
                  name="is_active"
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={handleFormChange}
                />
                <label htmlFor="course-is-active">
                  Active (inactive courses stay on old exams but can&apos;t be used for new ones)
                </label>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Create course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmToggle && (
        <div className="modal-overlay" onClick={() => !toggling && setConfirmToggle(null)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-label={confirmToggle.is_active ? 'Deactivate course' : 'Reactivate course'}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>
              {confirmToggle.is_active ? 'Deactivate course?' : 'Reactivate course?'}
            </h2>
            <p className="confirm-text">
              {confirmToggle.is_active ? (
                <>
                  <strong>
                    {confirmToggle.code} — {confirmToggle.name}
                  </strong>{' '}
                  will be hidden from faculty when they create new exams or
                  questions. Existing exams, attempts, and results are
                  unaffected.
                </>
              ) : (
                <>
                  <strong>
                    {confirmToggle.code} — {confirmToggle.name}
                  </strong>{' '}
                  will become selectable for new exams and questions again.
                </>
              )}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmToggle(null)}
                disabled={toggling}
              >
                Cancel
              </button>
              <button
                type="button"
                className={confirmToggle.is_active ? 'btn-danger' : 'btn-primary'}
                onClick={handleToggle}
                disabled={toggling}
              >
                {toggling
                  ? 'Saving...'
                  : confirmToggle.is_active
                    ? 'Deactivate'
                    : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
