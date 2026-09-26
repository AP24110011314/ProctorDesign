import { useState, useEffect, useRef } from 'react';
import { proctoringService } from '../../shared/api-client/proctoringService';
import { examService } from '../../shared/api-client/examService';
import './LiveMonitor.css';

const POLL_MS = 10_000;

/**
 * Live Monitoring Room for Faculty (UI_UX_SPEC.md §4.9, SRS.md FR-25).
 * Short-poll snapshot (MVP; WebSocket feed is a documented future upgrade):
 * active attempts sorted by flag count with an event timeline.
 * No live video grid — thumbnails of flagged moments only (NFR-10).
 */
export const LiveMonitor = () => {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    examService
      .getExams()
      .then((data) => setExams(data.results || data))
      .catch(() => setError('Failed to load exams'));
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!examId) return;
    const tick = () => loadSnapshot(examId);
    tick();
    timerRef.current = setInterval(tick, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [examId]);

  const loadSnapshot = async (id) => {
    try {
      setError('');
      const data = await proctoringService.getMonitor(id);
      setSnapshot(data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load monitor');
    } finally {
      setLoading(false);
    }
  };

  const handleExamChange = (e) => {
    const id = e.target.value;
    setExamId(id);
    setSelectedAttempt(null);
    if (!id) {
      if (timerRef.current) clearInterval(timerRef.current);
      setSnapshot(null);
      return;
    }
    setLoading(true);
    loadSnapshot(id);
  };

  const handleReview = async (eventId) => {
    try {
      await proctoringService.reviewEvent(eventId);
      if (examId) loadSnapshot(examId);
    } catch {
      setError('Could not mark event as reviewed');
    }
  };

  const events = snapshot?.recent_events || [];
  const visibleEvents = events.filter((e) => {
    if (selectedAttempt && e.attempt !== selectedAttempt) return false;
    if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="live-monitor-container">
      <h1>Live Monitoring</h1>

      <div className="monitor-controls">
        <select value={examId} onChange={handleExamChange} aria-label="Select exam">
          <option value="">Select an ongoing exam</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <span className="hint">Auto-refreshes every 10s</span>
        <div className="filter-chips">
          {['all', 'high', 'medium', 'low'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverityFilter(s)}
              className={`chip-btn ${severityFilter === s ? 'active' : ''}`}
            >
              {s === 'all' ? 'All severities' : s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {loading && <div className="loading">Loading...</div>}

      {snapshot && (
        <div className="monitor-layout">
          <div className="attempts-pane">
            <h3>Active attempts ({snapshot.active_attempts.length})</h3>
            {snapshot.active_attempts.length === 0 ? (
              <p className="empty">No active attempts right now.</p>
            ) : (
              snapshot.active_attempts.map((a) => (
                <button
                  key={a.attempt_id}
                  type="button"
                  onClick={() =>
                    setSelectedAttempt(selectedAttempt === a.attempt_id ? null : a.attempt_id)
                  }
                  className={`attempt-row ${selectedAttempt === a.attempt_id ? 'active' : ''}`}
                >
                  <span className="attempt-student">{a.student_username}</span>
                  <span className={`flag-badge ${a.flag_count > 0 ? 'flagged' : ''}`}>
                    {a.flag_count} flags
                  </span>
                  {a.unreviewed_count > 0 && (
                    <span className="flag-badge unreviewed">
                      {a.unreviewed_count} unreviewed
                    </span>
                  )}
                  <span className="integrity">Integrity: {a.integrity_score ?? '—'}</span>
                </button>
              ))
            )}
          </div>

          <div className="timeline-pane">
            <h3>
              Event timeline
              {selectedAttempt ? ` (attempt ${selectedAttempt}, click again to clear)` : ''}
            </h3>
            {visibleEvents.length === 0 ? (
              <p className="empty">No flags{selectedAttempt ? ' for this attempt' : ''} yet.</p>
            ) : (
              visibleEvents.map((e) => (
                <div key={e.id} className={`event-card severity-${e.severity}`}>
                  <div className="event-head">
                    <strong>{e.type}</strong>
                    <span className="chip">{e.severity}</span>
                    <span className="event-time">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="event-meta">
                    Student: {e.attempt_student} · Attempt {e.attempt}
                  </p>
                  {e.evidence && (
                    <img
                      src={proctoringService.evidenceUrl(e.evidence)}
                      alt={`Flag evidence for ${e.type}`}
                      className="event-thumb"
                      loading="lazy"
                    />
                  )}
                  {e.reviewed ? (
                    <span className="hint">Reviewed by {e.reviewed_by_username}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReview(e.id)}
                      className="btn-secondary"
                    >
                      Mark reviewed
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
