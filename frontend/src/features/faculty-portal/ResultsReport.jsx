import { useState, useEffect } from 'react';
import { gradingService, resultService } from '../../shared/api-client/gradingService';
import { examService } from '../../shared/api-client/examService';
import { adminService } from '../../shared/api-client/adminService';
import './ResultsReport.css';

/**
 * Integrity & Results Report for Faculty (UI_UX_SPEC.md §4.11)
 * Per-exam attempt table with scores + integrity columns, publish/unpublish
 * toggle (FR-28), and CSV export (FR-29). PDF export is backend-pending.
 */
export const ResultsReport = () => {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadExams();
  }, []);

  const handleExamChange = (e) => {
    const id = e.target.value;
    setExamId(id);
    if (id) loadReport(id);
    else {
      setExam(null);
      setAttempts([]);
    }
  };

  const loadExams = async () => {
    try {
      const data = await examService.getExams();
      const list = data.results || data;
      setExams(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load exams');
    }
  };

  const loadReport = async (id = examId) => {
    try {
      setLoading(true);
      setError('');
      setNotice('');
      const [examData, attemptsData] = await Promise.all([
        examService.getExam(id),
        resultService.getAttempts({ exam_id: id }),
      ]);
      setExam(examData);
      const list = attemptsData.results || attemptsData;
      setAttempts(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const togglePublish = async () => {
    try {
      setError('');
      setNotice('');
      if (exam.results_published) {
        await gradingService.unpublishResults(examId);
        setNotice('Results unpublished — students can no longer see scores.');
      } else {
        await gradingService.publishResults(examId);
        setNotice('Results published — students can now see their scores.');
      }
      const updated = await examService.getExam(examId);
      setExam(updated);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to update publish state');
    }
  };

  const handleExportCsv = async () => {
    try {
      setError('');
      await gradingService.downloadReport(examId, 'csv');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'CSV export failed');
    }
  };

  const handleExportPdf = async () => {
    try {
      setError('');
      await gradingService.downloadReport(examId, 'pdf');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'PDF export failed');
    }
  };

  const handleVoid = async (attemptId) => {
    const reason = window.prompt(
      'Void this attempt? A reason is mandatory and will be logged for audit.'
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError('A reason is required to void an attempt.');
      return;
    }
    try {
      setError('');
      await adminService.voidAttempt(attemptId, reason.trim());
      setNotice(`Attempt ${attemptId} voided and logged.`);
      loadReport(examId);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to void attempt');
    }
  };

  return (
    <div className="results-report-container">
      <h1>Integrity & Results Report</h1>

      <div className="report-controls">
        <select
          value={examId}
          onChange={handleExamChange}
          aria-label="Select exam"
        >
          <option value="">Select an exam</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.course_name ? `${e.course_name} — ` : ''}{e.title}
              {e.is_published === false ? ' (draft)' : ''}
              {e.results_published ? ' [scores out]' : ''}
            </option>
          ))}
        </select>

        {exam && (
          <>
            <span className={`chip ${exam.results_published ? 'published' : 'draft'}`}>
              {exam.results_published ? 'Results published' : 'Results hidden'}
            </span>
            <button type="button" onClick={togglePublish} className="btn-secondary">
              {exam.results_published ? 'Unpublish results' : 'Publish results'}
            </button>
            <button type="button" onClick={handleExportCsv} className="btn-secondary">
              Export CSV
            </button>
            <button type="button" onClick={handleExportPdf} className="btn-secondary">
              Export PDF
            </button>
          </>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="notice-message">{notice}</div>}
      {loading && <div className="loading">Loading report...</div>}

      {exam && !loading && (
        <table className="report-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Score</th>
              <th>Integrity</th>
              <th>Submitted</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {attempts.length === 0 ? (
              <tr>
                <td colSpan="6" className="empty">No attempts for this exam yet.</td>
              </tr>
            ) : (
              attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.student_username || `ID ${a.student}`}</td>
                  <td>{a.status}</td>
                  <td>{a.score ?? '—'}</td>
                  <td>{a.integrity_score ?? '—'}</td>
                  <td>{a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
                  <td>
                    {a.status === 'voided' ? (
                      <span className="hint">Voided</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleVoid(a.id)}
                        className="btn-danger"
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};
