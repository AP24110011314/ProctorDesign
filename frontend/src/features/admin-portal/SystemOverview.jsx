import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminService } from '../../shared/api-client/adminService';
import './SystemOverview.css';

/**
 * System Overview for Admins (UI_UX_SPEC.md §4.13, SRS.md FR-30/FR-31).
 * Activity snapshot, flagged attempts with void action (mandatory reason),
 * and the append-only audit log.
 */
export const SystemOverview = () => {
  const [overview, setOverview] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [ov, log] = await Promise.all([
        adminService.getOverview(),
        adminService.getAuditLog(),
      ]);
      setOverview(ov);
      setAudit(log.results || log);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load system overview');
    } finally {
      setLoading(false);
    }
  };

  const handleVoid = async (attemptId) => {
    const reason = window.prompt(
      'Void this attempt? A reason is mandatory and will be logged for audit.'
    );
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      setError('A reason is required to void an attempt.');
      return;
    }
    try {
      setError('');
      await adminService.voidAttempt(attemptId, reason.trim());
      setNotice(`Attempt ${attemptId} voided and logged.`);
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to void attempt');
    }
  };

  if (loading) return <div className="loading">Loading system overview...</div>;

  return (
    <div className="system-overview-container">
      <h1>System Overview</h1>

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="notice-message">{notice}</div>}

      <p className="page-subtitle">
        Need to release scores?{' '}
        <Link to="/admin/results">Go to Results &amp; Integrity to publish or unpublish results</Link>.
      </p>

      {overview && (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <span className="stat-value">{overview.total_exams}</span>
              <span className="stat-label">Total exams</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{overview.active_attempts}</span>
              <span className="stat-label">Active attempts</span>
            </div>
            <div className="stat-card alert">
              <span className="stat-value">{overview.flagged_needing_review}</span>
              <span className="stat-label">Flagged needing review</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{overview.pending_grading}</span>
              <span className="stat-label">Attempts pending grading</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{overview.voided_attempts}</span>
              <span className="stat-label">Voided attempts</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">
                {overview.users_by_role.student}/{overview.users_by_role.faculty}/
                {overview.users_by_role.admin}
              </span>
              <span className="stat-label">Students/Faculty/Admins</span>
            </div>
          </div>

          <h2>Flagged attempts requiring review</h2>
          {overview.flagged_attempts.length === 0 ? (
            <p className="empty">No flagged attempts.</p>
          ) : (
            <table className="overview-table">
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Status</th>
                  <th>Unreviewed</th>
                  <th>Integrity</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.flagged_attempts.map((a) => (
                  <tr key={a.attempt_id}>
                    <td>{a.attempt_id}</td>
                    <td>{a.student_username}</td>
                    <td>{a.exam_title}</td>
                    <td>{a.status}</td>
                    <td>{a.unreviewed_count}</td>
                    <td>{a.integrity_score ?? '—'}</td>
                    <td>
                      {a.status === 'voided' ? (
                        <span className="hint">Voided</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleVoid(a.attempt_id)}
                          className="btn-danger"
                        >
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2>Audit log</h2>
      {audit.length === 0 ? (
        <p className="empty">No audit entries yet.</p>
      ) : (
        <table className="overview-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.actor_username || `ID ${e.actor}`}</td>
                <td>{e.action}</td>
                <td>
                  {e.target_type} #{e.target_id}
                </td>
                <td>{e.details?.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
