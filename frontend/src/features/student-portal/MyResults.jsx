import { useState, useEffect } from 'react';
import { resultService } from '../../shared/api-client/gradingService';
import './MyResults.css';

/**
 * My Results page for Students (UI_UX_SPEC.md §4.5)
 * List of past exams with score (only when published — enforced server-side
 * by FR-28) plus a per-question breakdown view. Unpublished results show a
 * neutral "Result pending" status, never raw scores or flag details.
 */
export const MyResults = () => {
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadAttempts();
  }, []);

  const loadAttempts = async () => {
    try {
      setLoading(true);
      const data = await resultService.getAttempts();
      const list = data.results || data;
      // Past attempts only: submitted or auto-submitted
      const past = (Array.isArray(list) ? list : []).filter((a) =>
        ['submitted', 'auto_submitted'].includes(a.status)
      );
      setAttempts(past);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load results');
    } finally {
      setLoading(false);
    }
  };

  const openBreakdown = async (attempt) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      const data = await resultService.getResult(attempt.id);
      setDetail(data);
    } catch (err) {
      // 403 not_published (or not_submitted) -> neutral message, no score leak
      setDetailError(
        err.response?.data?.error?.message || 'Result is not available yet'
      );
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading results...</div>;

  return (
    <div className="my-results-container">
      <h1>My Results</h1>

      {error && <div className="error-message">{error}</div>}

      {attempts.length === 0 ? (
        <p className="empty">No completed exams yet.</p>
      ) : (
        <div className="results-list">
          {attempts.map((attempt) => (
            <div key={attempt.id} className="result-card">
              <div className="result-info">
                <h3>{attempt.exam_title || `Exam ${attempt.exam}`}</h3>
                <span
                  className={`chip ${attempt.score != null ? 'published' : 'pending'}`}
                >
                  {attempt.score != null
                    ? `Score: ${attempt.score}`
                    : 'Result pending'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => openBreakdown(attempt)}
                className="btn-secondary"
              >
                View Breakdown
              </button>
            </div>
          ))}
        </div>
      )}

      {detailLoading && <div className="loading">Loading breakdown...</div>}
      {detailError && <div className="error-message">{detailError}</div>}

      {detail && (
        <div className="breakdown">
          <h2>
            {detail.exam_title} — Score: {detail.score} / {detail.max_score}
          </h2>
          {detail.items.map((item) => (
            <div key={item.question_id} className="breakdown-item">
              <p className="question">{item.question_text}</p>
              {item.question_type.startsWith('mcq') ? (
                <p>
                  Your answer: {item.selected_options.join(', ') || <em>(blank)</em>}{' '}
                  {item.is_correct == null ? (
                    <span className="chip pending">Pending</span>
                  ) : item.is_correct ? (
                    <span className="chip correct">Correct</span>
                  ) : (
                    <span className="chip wrong">Incorrect</span>
                  )}
                </p>
              ) : (
                <p className="text-answer">{item.text_answer || <em>(blank)</em>}</p>
              )}
              <p className="marks">
                Marks: {item.marks_awarded ?? '—'} / {item.max_marks}
              </p>
              {item.grading_feedback && (
                <p className="feedback">Feedback: {item.grading_feedback}</p>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setDetail(null)} className="btn-secondary">
            Close breakdown
          </button>
        </div>
      )}
    </div>
  );
};
