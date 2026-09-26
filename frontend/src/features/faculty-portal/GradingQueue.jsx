import { useState, useEffect } from 'react';
import { gradingService } from '../../shared/api-client/gradingService';
import { examService } from '../../shared/api-client/examService';
import './GradingQueue.css';

/**
 * Grading Queue page for Faculty (UI_UX_SPEC.md §4.10)
 * List of ungraded subjective answers grouped by exam; grading view with
 * marks input bounded to max marks, feedback textarea, Save & Next.
 * Implements SRS.md FR-27.
 */
export const GradingQueue = () => {
  const [queue, setQueue] = useState([]);
  const [exams, setExams] = useState([]);
  const [examFilter, setExamFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);
  const [marks, setMarks] = useState('');
  const [feedback, setFeedback] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [suggestState, setSuggestState] = useState('idle'); // idle|loading|off|error
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadExams();
  }, []);

  useEffect(() => {
    loadQueue();
  }, [examFilter]);

  const loadExams = async () => {
    try {
      const data = await examService.getExams();
      setExams(data.results || data);
    } catch {
      // Exam filter is optional; queue still loads unfiltered
    }
  };

  const loadQueue = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await gradingService.getQueue(
        examFilter ? { exam_id: examFilter } : {}
      );
      const items = data.results || data;
      setQueue(Array.isArray(items) ? items : []);
      setCurrent(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.detail || 'Failed to load grading queue');
    } finally {
      setLoading(false);
    }
  };

  const openItem = (item) => {
    setCurrent(item);
    setMarks('');
    setFeedback('');
    setSuggestion(null);
    setSuggestState('idle');
  };

  const handleSuggest = async () => {
    if (!current) return;
    setSuggestState('loading');
    setSuggestion(null);
    try {
      const data = await gradingService.suggestMarks(current.id);
      setSuggestion(data);
      setSuggestState('idle');
    } catch (err) {
      // 403 with code ai_assist_disabled means the backend flag is off
      if (err.response?.status === 403) {
        setSuggestState('off');
      } else {
        setSuggestState('error');
      }
    }
  };

  const applySuggestion = () => {
    if (suggestion) setMarks(suggestion.suggested_marks);
  };

  const handleSaveNext = async (e) => {
    e?.preventDefault();
    if (!current) return;
    const max = parseFloat(current.max_marks);
    const value = parseFloat(marks);
    if (Number.isNaN(value) || value < 0 || value > max) {
      setError(`Marks must be between 0 and ${current.max_marks}`);
      return;
    }
    try {
      setSaving(true);
      setError('');
      await gradingService.gradeAnswer(current.id, {
        marks_awarded: value,
        grading_feedback: feedback,
      });
      const remaining = queue.filter((q) => q.id !== current.id);
      setQueue(remaining);
      if (remaining.length > 0) {
        openItem(remaining[0]);
      } else {
        setCurrent(null);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.response?.data?.detail || 'Failed to save grade');
    } finally {
      setSaving(false);
    }
  };

  // Group queue items by exam for the list view
  const grouped = queue.reduce((acc, item) => {
    const key = item.exam_id;
    if (!acc[key]) acc[key] = { title: item.exam_title, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {});

  if (loading) return <div className="loading">Loading grading queue...</div>;

  return (
    <div className="grading-queue-container">
      <div className="queue-header">
        <h1>Grading Queue</h1>
        <select
          value={examFilter}
          onChange={(e) => setExamFilter(e.target.value)}
          aria-label="Filter by exam"
        >
          <option value="">All exams</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.course_name ? `${exam.course_name} — ` : ''}{exam.title}
              {exam.is_published === false ? ' (draft)' : ''}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="queue-layout">
        <div className="queue-list">
          {queue.length === 0 ? (
            <p className="empty">No answers awaiting grading.</p>
          ) : (
            Object.entries(grouped).map(([examId, group]) => (
              <div key={examId} className="queue-group">
                <h3>
                  {group.title} ({group.items.length})
                </h3>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openItem(item)}
                    className={`queue-item ${current?.id === item.id ? 'active' : ''}`}
                  >
                    <span className="queue-student">
                      {item.student_name || item.student_username}
                    </span>
                    <span className="queue-question">
                      {item.question_text.substring(0, 60)}...
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="grading-pane">
          {!current ? (
            <p className="empty">Select an answer from the queue to grade.</p>
          ) : (
            <form onSubmit={handleSaveNext}>
              <h2>{current.exam_title}</h2>
              <p className="meta">
                Student: {current.student_name || current.student_username} · Max:{' '}
                {current.max_marks} marks
              </p>

              <div className="grade-block">
                <h4>Question</h4>
                <p>{current.question_text}</p>
              </div>

              {current.model_answer && (
                <div className="grade-block reference">
                  <h4>Reference answer (faculty only)</h4>
                  <p>{current.model_answer}</p>
                </div>
              )}

              <div className="grade-block">
                <h4>Student&apos;s answer</h4>
                <p className="student-answer">
                  {current.text_answer || <em>(no answer given)</em>}
                </p>
              </div>

              <div className="suggest-row">
                <button type="button" onClick={handleSuggest} className="btn-secondary">
                  Get AI suggestion
                </button>
                {suggestState === 'off' && (
                  <span className="hint">AI assist is disabled by the administrator.</span>
                )}
                {suggestState === 'error' && (
                  <span className="hint error">Could not generate a suggestion.</span>
                )}
              </div>

              {suggestion && (
                <div className="suggestion">
                  <p>
                    Suggested marks: <strong>{suggestion.suggested_marks}</strong> (assist
                    only — you enter the final marks)
                  </p>
                  {suggestion.matched_keywords?.length > 0 && (
                    <p className="hint">
                      Matched keywords: {suggestion.matched_keywords.join(', ')}
                    </p>
                  )}
                  <button type="button" onClick={applySuggestion} className="btn-secondary">
                    Use suggestion
                  </button>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="marks">Marks (0 – {current.max_marks}) *</label>
                <input
                  id="marks"
                  type="number"
                  value={marks}
                  onChange={(e) => setMarks(e.target.value)}
                  min="0"
                  max={current.max_marks}
                  step="0.5"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="feedback">Feedback (optional)</label>
                <textarea
                  id="feedback"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows="3"
                  placeholder="Feedback shown to the student after results are published"
                />
              </div>

              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save & Next'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
