import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { examService } from '../../shared/api-client/examService';
import { resultService } from '../../shared/api-client/gradingService';
import './MyExams.css';

/**
 * My Exams page for Students (UI_UX_SPEC.md §4.3/§4.4).
 * Published exams with time-window status plus the student's own attempt
 * state: not started → System Check; in progress → resume; submitted →
 * results (score only when published — enforced server-side, FR-28).
 */
export const MyExams = () => {
  const [exams, setExams] = useState([]);
  const [attemptsByExam, setAttemptsByExam] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [examsData, attemptsData] = await Promise.all([
        examService.getExams(),
        resultService.getAttempts(),
      ]);
      const list = examsData.results || examsData;
      setExams(Array.isArray(list) ? list : []);
      const attempts = attemptsData.results || attemptsData;
      const byExam = {};
      (Array.isArray(attempts) ? attempts : []).forEach((a) => {
        byExam[a.exam] = a;
      });
      setAttemptsByExam(byExam);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load exams');
    } finally {
      setLoading(false);
    }
  };

  const windowStatus = (exam) => {
    const now = new Date();
    if (new Date(exam.start_time) > now) return 'upcoming';
    if (new Date(exam.end_time) < now) return 'closed';
    return 'open';
  };

  if (loading) return <div className="loading">Loading exams...</div>;

  return (
    <div className="my-exams-container">
      <h1>My Exams</h1>

      {error && <div className="error-message">{error}</div>}

      {exams.length === 0 ? (
        <p className="empty">No published exams available.</p>
      ) : (
        <div className="exams-list">
          {exams.map((exam) => {
            const window = windowStatus(exam);
            const attempt = attemptsByExam[exam.id];
            const attemptStatus = attempt?.status;
            return (
              <div key={exam.id} className="exam-card">
                <div className="exam-info">
                  <h3>{exam.title}</h3>
                  <p className="meta">
                    {exam.course_name} · {exam.duration_minutes} min ·{' '}
                    {exam.total_marks} marks
                  </p>
                  <p className="meta">
                    {new Date(exam.start_time).toLocaleString()} →{' '}
                    {new Date(exam.end_time).toLocaleString()}
                  </p>
                  <span className={`chip chip-${window}`}>{window}</span>{' '}
                  {attemptStatus && (
                    <span className={`chip chip-${attemptStatus}`}>
                      {attemptStatus === 'in_progress'
                        ? 'In progress'
                        : attemptStatus === 'voided'
                          ? 'Voided'
                          : exam.results_published && attempt?.score != null
                            ? `Score: ${attempt.score}`
                            : 'Result pending'}
                    </span>
                  )}
                </div>
                <div className="exam-actions">
                  {attemptStatus === 'in_progress' ? (
                    <Link
                      to={`/student/attempts/${attempt.id}/take`}
                      className="btn-primary"
                    >
                      Resume exam
                    </Link>
                  ) : !attemptStatus && window === 'open' ? (
                    <Link to={`/student/exams/${exam.id}/check`} className="btn-primary">
                      Start exam
                    </Link>
                  ) : (
                    attemptStatus &&
                    (attemptStatus === 'submitted' ||
                      attemptStatus === 'auto_submitted') && (
                      <Link to="/student/results" className="btn-secondary">
                        View results
                      </Link>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
