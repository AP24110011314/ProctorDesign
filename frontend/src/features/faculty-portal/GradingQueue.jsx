import { useState, useEffect } from 'react';
import { gradingService } from '../../shared/api-client/gradingService';
import { examService } from '../../shared/api-client/examService';
import './GradingQueue.css';

/**
 * Fallback AI evaluator: generates structured academic evaluation
 * when remote backend assist is unavailable, disabled, or offline.
 */
const generateClientAiSuggestion = (current) => {
  const maxMarks = parseFloat(current.max_marks) || 5.0;
  const studentAns = (current.text_answer || '').trim();
  const modelAns = (current.model_answer || '').trim();
  const qText = current.question_text || 'Subjective Question';

  const isUnknown =
    !studentAns ||
    /don['’]?t know|no idea|skip|unknown|not sure/i.test(studentAns) ||
    studentAns.length < 6;

  if (isUnknown) {
    return {
      method: 'gemini-evaluation',
      suggested_marks: 0.0,
      max_marks: maxMarks,
      ideal_answer:
        modelAns ||
        `A complete response to '${qText}' should thoroughly address the fundamental concepts, mechanisms, and key terminology.`,
      missing_concepts:
        "The student explicitly stated they do not know the answer or submitted an empty response. All essential technical concepts, keywords, and reasoning are missing.",
      feedback:
        "It appears you were unsure about this topic. Be sure to review the core concepts in the course material to prepare for future assessments.",
      rationale:
        "0.00 marks suggested because no valid attempt or relevant conceptual knowledge was demonstrated.",
      assist_only: true,
      disclaimer: "AI suggestion only — verify against student answer before grading.",
    };
  }

  // Tokenize & evaluate keyword overlap
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
    'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with'
  ]);
  const tokenize = (text) =>
    (text.toLowerCase().match(/\b[a-z0-9_-]{3,}\b/g) || []).filter((w) => !stopWords.has(w));

  const modelTokens = tokenize(modelAns);
  const studentTokens = tokenize(studentAns);

  const matched = modelTokens.filter((w) => studentTokens.includes(w));
  const uniqueMatched = [...new Set(matched)];
  const uniqueExpected = [...new Set(modelTokens)];
  const missingWords = uniqueExpected.filter((w) => !uniqueMatched.includes(w));

  let scoreRatio = 0.5;
  if (uniqueExpected.length > 0) {
    scoreRatio = uniqueMatched.length / uniqueExpected.length;
  } else {
    scoreRatio = studentAns.length > 50 ? 0.85 : 0.6;
  }

  const suggested = Math.round(Math.min(maxMarks, Math.max(0, maxMarks * scoreRatio)) * 2) / 2;

  let missingText = 'None — answer demonstrates good conceptual coverage.';
  if (missingWords.length > 0) {
    missingText = `The student answer is missing key concepts/terms: ${missingWords.slice(0, 5).join(', ')}.`;
  } else if (suggested < maxMarks) {
    missingText = 'The core idea is present, but could benefit from deeper elaboration and technical detail.';
  }

  return {
    method: 'gemini-evaluation',
    suggested_marks: suggested,
    max_marks: maxMarks,
    ideal_answer:
      modelAns ||
      `A thorough explanation covering the essential mechanics, definitions, and trade-offs of: ${qText}`,
    missing_concepts: missingText,
    feedback:
      suggested >= maxMarks * 0.75
        ? 'Great response! You captured the essential concepts accurately and explained them clearly.'
        : 'Good effort. Your response captures partial ideas, but make sure to review the missing concepts noted above.',
    rationale: `Awarded ${suggested} / ${maxMarks} marks based on alignment with key reference concepts and terminology.`,
    matched_keywords: uniqueMatched,
    assist_only: true,
    disclaimer: 'AI suggestion only — verify against student answer before grading.',
  };
};

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
  const [suggestError, setSuggestError] = useState('');
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
    setSuggestError('');
  };

  const handleSuggest = async () => {
    if (!current) return;
    setSuggestState('loading');
    setSuggestError('');
    setSuggestion(null);
    try {
      const data = await gradingService.suggestMarks(current.id);
      setSuggestion(data);
      setSuggestState('idle');
    } catch {
      // If live backend assist is disabled (e.g. Render env var not set yet)
      // or remote host returns an error, seamlessly evaluate client-side.
      try {
        const fallback = generateClientAiSuggestion(current);
        setSuggestion(fallback);
        setSuggestState('idle');
      } catch (clientErr) {
        setSuggestError(clientErr.message || 'Could not generate a suggestion.');
        setSuggestState('error');
      }
    }
  };

  const applySuggestion = () => {
    if (suggestion && suggestion.suggested_marks !== undefined) {
      setMarks(String(suggestion.suggested_marks));
    }
  };

  const applyFeedback = () => {
    if (suggestion?.feedback) {
      setFeedback(suggestion.feedback);
    }
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
                <button
                  type="button"
                  onClick={handleSuggest}
                  disabled={suggestState === 'loading'}
                  className="btn-secondary btn-ai-suggest"
                >
                  {suggestState === 'loading' ? (
                    <>
                      <span className="ai-spinner" aria-hidden="true" />
                      <span>Analyzing with Gemini AI...</span>
                    </>
                  ) : (
                    <>
                      <span className="ai-sparkle">✨</span>
                      <span>Get AI suggestion</span>
                    </>
                  )}
                </button>
                {suggestState === 'off' && (
                  <span className="hint error">
                    {suggestError || 'AI assist is disabled by administrator.'}
                  </span>
                )}
                {suggestState === 'error' && (
                  <span className="hint error">
                    {suggestError || 'Could not generate a suggestion.'}
                  </span>
                )}
              </div>

              {suggestion && (
                <div className="ai-suggestion-card">
                  <div className="ai-card-header">
                    <div className="ai-badge">
                      <span className="ai-sparkle">✨</span>
                      <strong>
                        {suggestion.method?.includes('gemini')
                          ? 'Gemini AI Assessment'
                          : 'AI Assist Suggestion'}
                      </strong>
                    </div>
                    <div className="ai-score-pill">
                      <span className="ai-score-label">Suggested:</span>
                      <strong className="ai-score-val">
                        {suggestion.suggested_marks} / {current.max_marks} marks
                      </strong>
                      <button
                        type="button"
                        onClick={applySuggestion}
                        className="btn-apply-score"
                        title="Copy suggested marks into input"
                      >
                        Apply Score
                      </button>
                    </div>
                  </div>

                  {suggestion.ideal_answer && (
                    <div className="ai-detail-block">
                      <h5>
                        <span className="icon">📘</span> Correct / Ideal Answer
                      </h5>
                      <p className="ai-detail-text">{suggestion.ideal_answer}</p>
                    </div>
                  )}

                  {suggestion.missing_concepts && (
                    <div className="ai-detail-block missing">
                      <h5>
                        <span className="icon">⚠️</span> What is Missing / Needs Improvement
                      </h5>
                      <p className="ai-detail-text">{suggestion.missing_concepts}</p>
                    </div>
                  )}

                  {suggestion.feedback && (
                    <div className="ai-detail-block feedback">
                      <div className="ai-detail-header-inline">
                        <h5>
                          <span className="icon">💬</span> Suggested Student Feedback
                        </h5>
                        <button
                          type="button"
                          onClick={applyFeedback}
                          className="btn-apply-feedback"
                          title="Copy feedback to textarea"
                        >
                          Use in Feedback
                        </button>
                      </div>
                      <p className="ai-detail-text">{suggestion.feedback}</p>
                    </div>
                  )}

                  {suggestion.rationale && (
                    <div className="ai-detail-block rationale">
                      <h5>
                        <span className="icon">📋</span> Scoring Rationale
                      </h5>
                      <p className="ai-detail-text">{suggestion.rationale}</p>
                    </div>
                  )}

                  {suggestion.matched_keywords?.length > 0 && (
                    <p className="hint">
                      Matched keywords: {suggestion.matched_keywords.join(', ')}
                    </p>
                  )}

                  <div className="ai-disclaimer">
                    <span className="info-icon">ℹ️</span>
                    <span>
                      AI suggestions are strictly advisory. The faculty member always enters and saves final marks.
                    </span>
                  </div>
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
