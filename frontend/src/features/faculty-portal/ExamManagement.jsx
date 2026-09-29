import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { examService } from '../../shared/api-client/examService';
import { gradingService } from '../../shared/api-client/gradingService';
import './ExamManagement.css';

/**
 * Exam Management page for Faculty/Admin (fills the lifecycle gap).
 * Lists all exams with actions: publish/unpublish exam, publish/unpublish
 * results, navigate to grading/results report. This is the "mission control"
 * for exam lifecycle that was previously missing.
 */
export const ExamManagement = () => {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadExams();
  }, []);

  const loadExams = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await examService.getExams();
      const list = data.results || data;
      setExams(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load exams');
    } finally {
      setLoading(false);
    }
  };

  const toggleExamPublish = async (exam) => {
    try {
      setError('');
      setNotice('');
      if (exam.is_published) {
        await examService.unpublishExam(exam.id);
        setNotice(`"${exam.title}" unpublished — students can no longer see it.`);
      } else {
        await examService.publishExam(exam.id);
        setNotice(`"${exam.title}" published — students can now join.`);
      }
      await loadExams();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to toggle exam publish state');
    }
  };

  const toggleResultsPublish = async (exam) => {
    try {
      setError('');
      setNotice('');
      if (exam.results_published) {
        await gradingService.unpublishResults(exam.id);
        setNotice(`Results for "${exam.title}" hidden — students can no longer see scores.`);
      } else {
        await gradingService.publishResults(exam.id);
        setNotice(`Results for "${exam.title}" published — students can now view their scores.`);
      }
      await loadExams();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to toggle results publish state');
    }
  };

  const handleDelete = async (exam) => {
    const confirmed = window.confirm(
      `Delete "${exam.title}"? This action cannot be undone and will remove all attempts.`
    );
    if (!confirmed) return;
    try {
      setError('');
      setNotice('');
      await examService.deleteExam(exam.id);
      setNotice(`"${exam.title}" deleted.`);
      await loadExams();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to delete exam');
    }
  };

  const timeStatus = (exam) => {
    const now = new Date();
    if (new Date(exam.start_time) > now) return 'upcoming';
    if (new Date(exam.end_time) < now) return 'ended';
    return 'live';
  };

  if (loading) return <div className="loading">Loading exams...</div>;

  return (
    <div className="exam-management-container">
      <div className="mgmt-header">
        <h1>Exam Management</h1>
        <Link to="build" className="btn-primary">+ New Exam</Link>
      </div>

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="notice-message">{notice}</div>}

      {exams.length === 0 ? (
        <p className="empty">No exams yet. Create one to get started.</p>
      ) : (
        <div className="exam-mgmt-list">
          {exams.map((exam) => {
            const ts = timeStatus(exam);
            return (
              <div key={exam.id} className="exam-mgmt-card">
                <div className="exam-mgmt-info">
                  <h3>{exam.title}</h3>
                  <p className="meta">
                    {exam.course_name} · {exam.duration_minutes} min ·{' '}
                    {exam.total_marks} marks
                  </p>
                  <p className="meta">
                    {new Date(exam.start_time).toLocaleString()} →{' '}
                    {new Date(exam.end_time).toLocaleString()}
                  </p>
                  <div className="chip-row">
                    <span className={`chip chip-${ts}`}>{ts}</span>
                    <span className={`chip ${exam.is_published ? 'published' : 'draft'}`}>
                      {exam.is_published ? '✓ Published' : 'Draft'}
                    </span>
                    <span className={`chip ${exam.results_published ? 'results-out' : 'results-hidden'}`}>
                      {exam.results_published ? '📊 Results out' : 'Results hidden'}
                    </span>
                  </div>
                </div>

                <div className="exam-mgmt-actions">
                  <button
                    type="button"
                    onClick={() => toggleExamPublish(exam)}
                    className={exam.is_published ? 'btn-secondary' : 'btn-primary'}
                  >
                    {exam.is_published ? 'Unpublish exam' : 'Publish exam'}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleResultsPublish(exam)}
                    className={exam.results_published ? 'btn-secondary' : 'btn-primary'}
                    title={exam.results_published
                      ? 'Hide student scores'
                      : 'Release scores to students'}
                  >
                    {exam.results_published ? 'Hide results' : 'Publish results'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(exam)}
                    className="btn-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
