import { useState, useEffect } from 'react';
import { questionService, courseService } from '../../shared/api-client/examService';
import './QuestionBank.css';

/**
 * Question Bank page for Faculty (UI_UX_SPEC.md §4.7)
 * Implements SRS.md FR-6 to FR-8
 */
export const QuestionBank = () => {
  const [questions, setQuestions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);

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

    try {
      if (editingQuestion) {
        await questionService.updateQuestion(editingQuestion.id, formData);
      } else {
        await questionService.createQuestion(formData);
      }
      setShowForm(false);
      setEditingQuestion(null);
      resetForm();
      loadData();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save question');
    }
  };

  const handleEdit = (question) => {
    setEditingQuestion(question);
    setFormData({
      course: question.course,
      type: question.type,
      text: question.text,
      difficulty: question.difficulty,
      topic: question.topic || '',
      marks: question.marks,
      options: question.options || [],
    });
    setShowForm(true);
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
        <h1>Question Bank</h1>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Question'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

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
                  min="0"
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
                placeholder="e.g., Loops, Data Structures"
              />
            </div>

            <div className="form-group">
              <label>Question Text *</label>
              <textarea
                name="text"
                value={formData.text}
                onChange={handleFormChange}
                rows="4"
                required
              />
            </div>

            {/* Options for MCQ */}
            {(formData.type === 'mcq_single' || formData.type === 'mcq_multi') && (
              <div className="options-section">
                <h3>Options</h3>
                {formData.options.map((option, index) => (
                  <div key={index} className="option-row">
                    <input
                      type="checkbox"
                      checked={option.is_correct}
                      onChange={(e) =>
                        handleOptionChange(index, 'is_correct', e.target.checked)
                      }
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

      {/* Questions Table */}
      <div className="questions-table">
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Course</th>
              <th>Type</th>
              <th>Difficulty</th>
              <th>Topic</th>
              <th>Marks</th>
              <th>Actions</th>
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
              questions.map((question) => (
                <tr key={question.id}>
                  <td className="question-text">{question.text.substring(0, 80)}...</td>
                  <td>{question.course_name}</td>
                  <td>
                    <span className="badge">{question.type.replace('_', ' ')}</span>
                  </td>
                  <td>
                    <span className={`badge badge-${question.difficulty}`}>
                      {question.difficulty}
                    </span>
                  </td>
                  <td>{question.topic || '-'}</td>
                  <td>{question.marks}</td>
                  <td className="actions">
                    <button onClick={() => handleEdit(question)} className="btn-icon">
                      ✏️
                    </button>
                    <button onClick={() => handleDelete(question.id)} className="btn-icon">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
