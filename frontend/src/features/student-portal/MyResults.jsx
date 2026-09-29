import { useState, useEffect } from 'react';
import { resultService } from '../../shared/api-client/gradingService';
import { examService } from '../../shared/api-client/examService';
import './MyResults.css';

/**
 * My Results page for Students (UI_UX_SPEC.md §4.5)
 * List of past exams with score (only when published — enforced server-side
 * by FR-28) plus a per-question breakdown view. Unpublished results show a
 * neutral "Result pending" status, never raw scores or flag details.
 *
 * We fetch the exam list to know which exams have results_published=true so
 * we can disable the breakdown button proactively instead of letting students
 * click and get a confusing 403.
 */
export const MyResults = () => {
  const [attempts, setAttempts] = useState([]);
  const [examsById, setExamsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [attemptsData, examsData] = await Promise.all([
        resultService.getAttempts(),
        examService.getExams(),
      ]);

      const list = attemptsData.results || attemptsData;
      // Past attempts only: submitted or auto-submitted
      const past = (Array.isArray(list) ? list : []).filter((a) =>
        ['submitted', 'auto_submitted'].includes(a.status)
      );
      setAttempts(past);

      // Build exam lookup for results_published status
      const examList = examsData.results || examsData;
      const lookup = {};
      (Array.isArray(examList) ? examList : []).forEach((e) => {
        lookup[e.id] = e;
      });
      setExamsById(lookup);
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
          {attempts.map((attempt) => {
            const exam = examsById[attempt.exam];
            const resultsPublished = exam?.results_published === true;
            return (
              <div key={attempt.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="result-card">
                  <div className="result-info">
                    <h3>{attempt.exam_title || `Exam ${attempt.exam}`}</h3>
                    {resultsPublished && attempt.score != null ? (
                      <span className="chip published">Score: {attempt.score}</span>
                    ) : (
                      <span className="chip pending">
                        {resultsPublished ? 'Grading in progress' : 'Result pending'}
                      </span>
                    )}
                  </div>
                  <div className="result-actions">
                    {resultsPublished ? (
                      <button
                        type="button"
                        onClick={() => detail && detail.attempt_id === attempt.id ? setDetail(null) : openBreakdown(attempt)}
                        className="btn-secondary"
                      >
                        {detail && detail.attempt_id === attempt.id ? 'Hide Breakdown' : 'View Breakdown'}
                      </button>
                    ) : (
                      <span className="hint">Results not yet released by faculty</span>
                    )}
                  </div>
                </div>
              
              {/* Inline Breakdown Rendering */}
              {detailLoading && detail === null && (
                <div className="loading" style={{ padding: '1rem', minHeight: 'auto' }}>Loading breakdown...</div>
              )}
              {detailError && detail === null && (
                <div className="error-message" style={{ margin: '1rem 0' }}>{detailError}</div>
              )}

              {detail && detail.attempt_id === attempt.id && (
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
                  <div className="result-actions" style={{ marginTop: '1rem' }}>
                    <button type="button" onClick={() => setDetail(null)} className="btn-secondary">
                      Close breakdown
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
