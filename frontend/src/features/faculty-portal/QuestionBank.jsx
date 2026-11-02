import { useState, useEffect } from 'react';
import { questionService, courseService } from '../../shared/api-client/examService';
import './QuestionBank.css';

/**
 * Question Bank page for Faculty (UI_UX_SPEC.md §4.7)
 * Implements SRS.md FR-6 to FR-8
 *
 * API contract: GET /api/questions/ returns options nested as `options`
 * (see backend QuestionSerializer; related_name='options' on QuestionOption).
 * Older payloads may use `question_options` — handled via fallback below.
 */
const getQuestionOptions = (question) =>
  question?.options ?? question?.question_options ?? [];

const isMCQType = (type) => {
  if (!type) return false;
  const normalized = String(type).toLowerCase();
  return normalized.includes('mcq');
};

export const QuestionBank = () => {
  const [questions, setQuestions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [viewMode, setViewMode] = useState('cards'); // 'cards' (default) | 'table'

  // Filters
  const [filters, setFilters] = useState({
    course: '',
    type: '',
    difficulty: '',
    topic: '',
  });

  const [formData, setFormData] = useState({
    course: '',
    type: 'mcq_single',
    text: '',
    difficulty: 'medium',
    topic: '',
    marks: 1.0,
    model_answer: '',
    options: [
      { text: '', is_correct: false, order: 0 },
      { text: '', is_correct: false, order: 1 },
      { text: '', is_correct: false, order: 2 },
      { text: '', is_correct: false, order: 3 },
    ],
  });

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [questionsData, coursesData] = await Promise.all([
        questionService.getQuestions(filters),
        courseService.getCourses(),
      ]);
      setQuestions(questionsData.results || questionsData);
      setCourses(coursesData.results || coursesData);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e) => {
    setFilters({
      ...filters,
      [e.target.name]: e.target.value,
    });
  };

  const handleFormChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleOptionChange = (index, field, value) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setFormData({ ...formData, options: newOptions });
  };

  const addOption = () => {
    setFormData({
      ...formData,
      options: [
        ...formData.options,
        { text: '', is_correct: false, order: formData.options.length },
      ],
    });
  };

  const removeOption = (index) => {
    if (formData.options.length <= 2) return;
    const newOptions = formData.options.filter((_, i) => i !== index);
    setFormData({ ...formData, options: newOptions });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const isMCQ = isMCQType(formData.type);
    const cleanedOptions = isMCQ
      ? formData.options.filter((opt) => opt.text && opt.text.trim().length > 0)
      : [];

    if (isMCQ) {
      if (cleanedOptions.length < 2) {
        setError('MCQ questions require at least 2 options with text.');
        return;
      }
      const hasCorrect = cleanedOptions.some((opt) => opt.is_correct);
      if (!hasCorrect) {
        setError('Please mark at least one option as correct.');
        return;
      }
    }

    const payload = {
      ...formData,
      course: Number(formData.course) || formData.course,
      marks: parseFloat(formData.marks) || 1.0,
      model_answer: !isMCQ ? (formData.model_answer || '').trim() : '',
      options: cleanedOptions,
    };

    try {
      if (editingQuestion) {
        await questionService.updateQuestion(editingQuestion.id, payload);
      } else {
        await questionService.createQuestion(payload);
      }
      setShowForm(false);
      setEditingQuestion(null);
      resetForm();
      loadData();
    } catch (err) {
      const data = err.response?.data;
      let msg = 'Failed to save question';
      if (typeof data === 'string') {
        msg = data;
      } else if (data?.error?.message) {
        msg = data.error.message;
      } else if (data?.detail) {
        msg = data.detail;
      } else if (data && typeof data === 'object') {
        const firstKey = Object.keys(data)[0];
        const val = data[firstKey];
        if (Array.isArray(val)) {
          msg = `${firstKey}: ${val[0]}`;
        } else if (typeof val === 'string') {
          msg = `${firstKey}: ${val}`;
        } else if (typeof val === 'object') {
          msg = JSON.stringify(val);
        }
      }
      setError(msg);
    }
  };

  const handleEdit = (question) => {
    const existingOptions = getQuestionOptions(question);
    setEditingQuestion(question);
    setFormData({
      course: question.course,
      type: question.type,
      text: question.text,
      difficulty: question.difficulty,
      topic: question.topic || '',
      marks: question.marks,
      model_answer: question.model_answer || '',
      options:
        existingOptions && existingOptions.length > 0
          ? existingOptions
          : [
              { text: '', is_correct: false, order: 0 },
              { text: '', is_correct: false, order: 1 },
              { text: '', is_correct: false, order: 2 },
              { text: '', is_correct: false, order: 3 },
            ],
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this question?')) return;

    try {
      await questionService.deleteQuestion(id);
      loadData();
    } catch (err) {
      setError('Failed to delete question');
    }
  };

  const resetForm = () => {
    setFormData({
      course: '',
      type: 'mcq_single',
      text: '',
      difficulty: 'medium',
      topic: '',
      marks: 1.0,
      model_answer: '',
      options: [
        { text: '', is_correct: false, order: 0 },
        { text: '', is_correct: false, order: 1 },
        { text: '', is_correct: false, order: 2 },
        { text: '', is_correct: false, order: 3 },
      ],
    });
  };

  if (loading) return <div className="loading">Loading questions...</div>;

  return (
    <div className="question-bank-container">
      <div className="page-header">
        <div>
          <h1>Question Bank</h1>
          <p className="page-subtitle">
            Manage your questions across all assigned courses with full options and evaluation rubrics.
          </p>
        </div>
        <div className="page-header-actions">
          <div className="view-mode-toggle" role="group" aria-label="View Mode">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
              title="Cards view — spacious layout with full questions, options and model answers"
            >
              ▤ Cards
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Table view — compact spreadsheet format"
            >
              ☰ Table
            </button>
          </div>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Question'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {!loading && courses.length === 0 && (
        <div
          className="alert-banner alert-warning"
          style={{
            margin: '0.75rem 0 1.25rem',
            padding: '0.9rem 1.1rem',
            background: 'var(--caramel-ghost, #FBF3E2)',
            border: '1px solid var(--caramel-border, #E8CFA8)',
            borderRadius: '12px',
            color: 'var(--caramel-ink, #4A2E14)',
          }}
          role="alert"
        >
          <strong>⚠️ No courses assigned to your account yet.</strong>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', lineHeight: '1.45' }}>
            Faculty privileges (creating questions, building exams, grading) require course assignments.
            Please contact an administrator in Mission Control to assign courses to your faculty profile.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="filters">
        <select name="course" value={filters.course} onChange={handleFilterChange}>
          <option value="">All Courses</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code} - {course.name}
            </option>
          ))}
        </select>

        <select name="type" value={filters.type} onChange={handleFilterChange}>
          <option value="">All Types</option>
          <option value="mcq_single">Single Correct MCQ</option>
          <option value="mcq_multi">Multi Correct MCQ</option>
          <option value="short_answer">Short Answer</option>
        </select>

        <select name="difficulty" value={filters.difficulty} onChange={handleFilterChange}>
          <option value="">All Difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <input
          type="text"
          name="topic"
          placeholder="Search by topic..."
          value={filters.topic}
          onChange={handleFilterChange}
        />
      </div>

      {/* Question Form */}
      {showForm && (
        <div className="question-form-card">
          <h2>{editingQuestion ? 'Edit Question' : 'Add New Question'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Course *</label>
              <select
                name="course"
                value={formData.course}
                onChange={handleFormChange}
                required
              >
                <option value="">Select Course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Type *</label>
                <select name="type" value={formData.type} onChange={handleFormChange} required>
                  <option value="mcq_single">Single Correct MCQ</option>
                  <option value="mcq_multi">Multi Correct MCQ</option>
                  <option value="short_answer">Short Answer</option>
                </select>
              </div>

              <div className="form-group">
                <label>Difficulty *</label>
                <select
                  name="difficulty"
                  value={formData.difficulty}
                  onChange={handleFormChange}
                  required
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>

              <div className="form-group">
                <label>Marks *</label>
                <input
                  type="number"
                  name="marks"
                  value={formData.marks}
                  onChange={handleFormChange}
                  min="0.5"
                  step="0.5"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Topic (optional)</label>
              <input
                type="text"
                name="topic"
                value={formData.topic}
                onChange={handleFormChange}
                placeholder="e.g., Loops, Data Structures, Operating Systems"
              />
            </div>

            <div className="form-group">
              <label>Question Text *</label>
              <textarea
                name="text"
                value={formData.text}
                onChange={handleFormChange}
                rows="4"
                placeholder="Enter the complete question text..."
                required
              />
            </div>

            {/* Options for MCQ or Model Answer for Short Answer */}
            {isMCQType(formData.type) ? (
              <div className="options-section">
                <div className="options-header">
                  <h3>Options</h3>
                  <small className="options-hint">Check the box for the correct option(s)</small>
                </div>
                {formData.options.map((option, index) => (
                  <div key={index} className="option-row">
                    <input
                      type="checkbox"
                      checked={option.is_correct}
                      onChange={(e) =>
                        handleOptionChange(index, 'is_correct', e.target.checked)
                      }
                      title="Mark as correct answer"
                    />
                    <input
                      type="text"
                      value={option.text}
                      onChange={(e) => handleOptionChange(index, 'text', e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      required
                    />
                    {formData.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        className="btn-delete-small"
                        title="Delete option"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addOption} className="btn-secondary">
                  + Add Option
                </button>
              </div>
            ) : (
              <div className="options-section subjective-section">
                <h3>Subjective Evaluation Guide</h3>
                <div className="form-group">
                  <label>Model / Reference Answer (Optional)</label>
                  <textarea
                    name="model_answer"
                    value={formData.model_answer}
                    onChange={handleFormChange}
                    rows="3"
                    placeholder="Provide key points, keywords, or a model answer to guide faculty during subjective grading..."
                  />
                  <small className="form-hint">
                    This reference answer will be shown in the Evaluation Queue to guide subjective grading.
                  </small>
                </div>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                {editingQuestion ? 'Update Question' : 'Create Question'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingQuestion(null);
                  resetForm();
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cards View (Default — optimal for laptops, desktops, tablets, and phones) */}
      {viewMode === 'cards' && (
        <div className="questions-cards-feed">
          {questions.length === 0 ? (
            <div className="empty-state">
              No questions found. Create your first question to get started.
            </div>
          ) : (
            questions.map((question, qIdx) => {
              const rowOptions = getQuestionOptions(question);
              const isMCQ = isMCQType(question.type);
              return (
                <div key={question.id} className="qb-full-card">
                  <div className="qb-card-topbar">
                    <div className="qb-card-badges">
                      <span className="qb-card-index">Q{qIdx + 1}</span>
                      <span className="badge badge-course">{question.course_name || 'Course'}</span>
                      <span className={`badge badge-${question.difficulty}`}>
                        {question.difficulty}
                      </span>
                      <span className="badge">
                        {String(question.type || '').replace('_', ' ')}
                      </span>
                      {question.topic && (
                        <span className="badge badge-topic">
                          📁 {question.topic}
                        </span>
                      )}
                    </div>
                    <div className="qb-card-meta-right">
                      <span className="qb-card-marks">
                        {question.marks} {Number(question.marks) === 1 ? 'mark' : 'marks'}
                      </span>
                      <div className="qb-card-actions-inline">
                        <button
                          type="button"
                          onClick={() => handleEdit(question)}
                          className="btn-card-action btn-card-edit"
                          title="Edit Question"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(question.id)}
                          className="btn-card-action btn-card-delete"
                          title="Delete Question"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="qb-card-question-box">
                    <p className="qb-card-question-text">{question.text}</p>
                  </div>

                  {isMCQ ? (
                    <div className="qb-card-options-box">
                      <div className="qb-options-title">
                        <span>Answer Choices:</span>
                        <span className="qb-options-count">{rowOptions.length} options</span>
                      </div>
                      {rowOptions.length > 0 ? (
                        <div className="qb-options-grid">
                          {rowOptions.map((opt, idx) => (
                            <div
                              key={opt.id ?? idx}
                              className={`qb-option-item ${opt.is_correct ? 'option-correct' : ''}`}
                            >
                              <span className="opt-marker">
                                {opt.is_correct ? '✓' : String.fromCharCode(65 + idx)}
                              </span>
                              <span className="opt-text">{opt.text}</span>
                              {opt.is_correct && (
                                <span className="opt-correct-tag">Correct Answer</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="options-missing">No options added</span>
                      )}
                    </div>
                  ) : (
                    <div className="qb-card-subjective-box">
                      <div className="qb-subjective-header">
                        <span className="qb-subj-badge">Subjective / Short Answer</span>
                        {question.model_answer && (
                          <span className="qb-subj-has-key">✓ Reference answer available</span>
                        )}
                      </div>
                      {question.model_answer ? (
                        <div className="qb-model-answer-content">
                          <strong>Model / Reference Answer:</strong>
                          <p>{question.model_answer}</p>
                        </div>
                      ) : (
                        <p className="qb-model-answer-placeholder">
                          No model answer set. Answers will be reviewed and graded manually by faculty in the Evaluation Queue.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Table View (Alternative compact view) */}
      {viewMode === 'table' && (
        <div className="questions-table questions-table-desktop">
          <table>
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Question</th>
                <th style={{ width: '14%' }}>Course</th>
                <th style={{ width: '10%' }}>Type</th>
                <th style={{ width: '9%' }}>Difficulty</th>
                <th style={{ width: '7%' }}>Marks</th>
                <th style={{ width: '14%' }}>Options / Answer</th>
                <th style={{ width: '8%', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    No questions found. Create your first question to get started.
                  </td>
                </tr>
              ) : (
                questions.map((question) => {
                  const rowOptions = getQuestionOptions(question);
                  const isMCQ = isMCQType(question.type);
                  return (
                    <tr key={question.id}>
                      <td className="question-text">
                        <div className="question-text-content">{question.text}</div>
                        {question.topic && (
                          <div className="table-topic-pill">Topic: {question.topic}</div>
                        )}
                      </td>
                      <td>
                        <span className="table-course-name">{question.course_name}</span>
                      </td>
                      <td>
                        <span className="badge">{String(question.type || '').replace('_', ' ')}</span>
                      </td>
                      <td>
                        <span className={`badge badge-${question.difficulty}`}>
                          {question.difficulty}
                        </span>
                      </td>
                      <td>
                        <span className="table-marks-pill">{question.marks}M</span>
                      </td>
                      <td className="question-options-cell">
                        {isMCQ ? (
                          rowOptions.length > 0 ? (
                            <ul className="question-options-list">
                              {rowOptions.map((opt, idx) => (
                                <li
                                  key={opt.id ?? idx}
                                  className={opt.is_correct ? 'option-correct' : ''}
                                >
                                  {opt.is_correct ? '✓ ' : '○ '}
                                  {opt.text}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="options-missing">No options</span>
                          )
                        ) : (
                          <div className="table-short-answer-preview">
                            <span className="table-short-badge">Short Answer</span>
                            {question.model_answer && (
                              <small className="table-model-snippet" title={question.model_answer}>
                                Key: {question.model_answer.substring(0, 40)}...
                              </small>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="actions" style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleEdit(question)}
                          className="btn-icon"
                          aria-label="Edit question"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(question.id)}
                          className="btn-icon"
                          aria-label="Delete question"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
