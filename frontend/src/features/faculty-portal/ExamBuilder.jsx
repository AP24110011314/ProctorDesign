import { useState, useEffect } from 'react';
import { examService, courseService, questionService } from '../../shared/api-client/examService';
import './ExamBuilder.css';

/**
 * Exam Builder page for Faculty (UI_UX_SPEC.md §4.8)
 * Step-based form: Basic info → Question selection → Rules → Review & Publish
 * Implements SRS.md FR-9 to FR-12
 */
export const ExamBuilder = ({ examId = null }) => {
  const [step, setStep] = useState(1); // 1: Basic info, 2: Questions, 3: Rules, 4: Review
  const [courses, setCourses] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    course: '',
    title: '',
    start_time: '',
    end_time: '',
    duration_minutes: 60,
    question_count: 20,
    marks_per_question: 1.0,
    negative_marking: false,
    negative_marks_value: 0.0,
    shuffle_questions: true,
    shuffle_options: true,
    proctoring_mode: 'basic',
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (formData.course) {
      loadQuestions();
    }
  }, [formData.course]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const coursesData = await courseService.getCourses();
      setCourses(coursesData.results || coursesData);
    } catch (err) {
      setError('Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  const loadQuestions = async () => {
    try {
      const questionsData = await questionService.getQuestions({
        course: formData.course,
      });
      setQuestions(questionsData.results || questionsData);
    } catch (err) {
      console.error('Failed to load questions');
    }
  };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  const handleAddQuestion = (question) => {
    if (!selectedQuestions.find((q) => q.id === question.id)) {
      setSelectedQuestions([...selectedQuestions, question]);
      setFormData({
        ...formData,
        question_count: selectedQuestions.length + 1,
      });
    }
  };

  const handleRemoveQuestion = (questionId) => {
    setSelectedQuestions(selectedQuestions.filter((q) => q.id !== questionId));
    setFormData({
      ...formData,
      question_count: selectedQuestions.length - 1,
    });
  };

  const canProceedToNext = () => {
    switch (step) {
      case 1: // Basic info
        return formData.course && formData.title && formData.start_time && formData.end_time;
      case 2: // Question selection
        return selectedQuestions.length > 0;
      case 3: // Rules (always valid)
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!examId && selectedQuestions.length === 0) {
      setError('Select at least one question in Step 2 before creating the exam.');
      return;
    }

    try {
      const payload = {
        ...formData,
        question_count: selectedQuestions.length,
      };

      if (examId) {
        await examService.updateExam(examId, payload);
      } else {
        const exam = await examService.createExam(payload);

        // Add selected questions to exam
        if (selectedQuestions.length > 0) {
          await examService.addQuestions(
            exam.id,
            selectedQuestions.map((q) => q.id)
          );
        }
      }

      // Navigate to exams list or show success
      window.alert('Exam created successfully!');
      // TODO: Navigate to exams list
    } catch (err) {
      const data = err.response?.data;
      if (data?.error?.message) {
        setError(data.error.message);
      } else if (data && typeof data === 'object') {
        // DRF validation errors come as { field: [messages] } — surface them
        const msgs = Object.entries(data).map(
          ([field, val]) => `${field}: ${Array.isArray(val) ? val.join(' ') : val}`
        );
        setError(msgs.join(' | ') || 'Failed to create exam');
      } else {
        setError('Failed to create exam');
      }
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="exam-builder-container">
      <div className="builder-header">
        <h1>Exam Builder</h1>
        <div className="stepper">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={`step ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`}>
              {s}
            </div>
          ))}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="builder-form">
        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="step-content">
            <h2>Basic Information</h2>

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

            <div className="form-group">
              <label>Exam Title *</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleFormChange}
                placeholder="e.g., Midterm Exam"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Start Time *</label>
                <input
                  type="datetime-local"
                  name="start_time"
                  value={formData.start_time}
                  onChange={handleFormChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>End Time *</label>
                <input
                  type="datetime-local"
                  name="end_time"
                  value={formData.end_time}
                  onChange={handleFormChange}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Duration (minutes) *</label>
              <input
                type="number"
                name="duration_minutes"
                value={formData.duration_minutes}
                onChange={handleFormChange}
                min="1"
                required
              />
            </div>
          </div>
        )}

        {/* Step 2: Question Selection */}
        {step === 2 && (
          <div className="step-content">
            <h2>Select Questions</h2>

            <div className="questions-selection">
              <div className="available-questions">
                <h3>Available Questions ({questions.length})</h3>
                <div className="questions-list">
                  {questions.length === 0 ? (
                    <p className="empty">No questions available for this course</p>
                  ) : (
                    questions.map((question) => (
                      <div key={question.id} className="question-item">
                        <div className="question-info">
                          <p className="question-text">{question.text}</p>
                          <span className="badge">{question.type}</span>
                          <span className={`badge badge-${question.difficulty}`}>
                            {question.difficulty}
                          </span>
                          <span className="marks">{question.marks}M</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddQuestion(question)}
                          disabled={selectedQuestions.some((q) => q.id === question.id)}
                          className="btn-add"
                        >
                          {selectedQuestions.some((q) => q.id === question.id) ? '✓ Added' : '+ Add'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="selected-questions">
                <h3>Selected Questions ({selectedQuestions.length})</h3>
                <div className="questions-list">
                  {selectedQuestions.length === 0 ? (
                    <p className="empty">No questions selected yet</p>
                  ) : (
                    selectedQuestions.map((question) => (
                      <div key={question.id} className="question-item selected">
                        <div className="question-info">
                          <p className="question-text">{question.text}</p>
                          <span className="marks">{question.marks}M</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(question.id)}
                          className="btn-remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Scoring & Proctoring Rules */}
        {step === 3 && (
          <div className="step-content">
            <h2>Scoring & Proctoring Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label>Marks Per Question *</label>
                <input
                  type="number"
                  name="marks_per_question"
                  value={formData.marks_per_question}
                  onChange={handleFormChange}
                  min="0"
                  step="0.5"
                  required
                />
              </div>

              <div className="form-group">
                <label>Total Marks (calculated): {selectedQuestions.length * formData.marks_per_question}</label>
                <input type="text" disabled value={selectedQuestions.length * formData.marks_per_question} />
              </div>
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  name="negative_marking"
                  checked={formData.negative_marking}
                  onChange={handleFormChange}
                />
                Enable Negative Marking
              </label>
            </div>

            {formData.negative_marking && (
              <div className="form-group">
                <label>Negative Marks Per Wrong Answer</label>
                <input
                  type="number"
                  name="negative_marks_value"
                  value={formData.negative_marks_value}
                  onChange={handleFormChange}
                  min="0"
                  step="0.5"
                />
              </div>
            )}

            <div className="form-group">
              <label>Proctoring Mode</label>
              <select name="proctoring_mode" value={formData.proctoring_mode} onChange={handleFormChange}>
                <option value="off">Off</option>
                <option value="basic">Basic (Face detection, tab-switch detection)</option>
                <option value="strict">Strict (All detections + microphone monitoring)</option>
              </select>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  name="shuffle_questions"
                  checked={formData.shuffle_questions}
                  onChange={handleFormChange}
                />
                Randomize Question Order
              </label>
            </div>

            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  name="shuffle_options"
                  checked={formData.shuffle_options}
                  onChange={handleFormChange}
                />
                Randomize Option Order
              </label>
            </div>
          </div>
        )}

        {/* Step 4: Review & Publish */}
        {step === 4 && (
          <div className="step-content">
            <h2>Review & Publish</h2>

            <div className="review-summary">
              <div className="summary-card">
                <h3>Exam Configuration</h3>
                <p>
                  <strong>Title:</strong> {formData.title}
                </p>
                <p>
                  <strong>Course:</strong>{' '}
                  {courses.find((c) => String(c.id) === String(formData.course))?.name}
                </p>
                <p>
                  <strong>Duration:</strong> {formData.duration_minutes} minutes
                </p>
                <p>
                  <strong>Total Marks:</strong> {selectedQuestions.length * formData.marks_per_question}
                </p>
                <p>
                  <strong>Questions:</strong> {selectedQuestions.length}
                </p>
                <p>
                  <strong>Proctoring:</strong> {formData.proctoring_mode}
                </p>
              </div>

              <div className="summary-card">
                <h3>Questions ({selectedQuestions.length})</h3>
                <ul>
                  {selectedQuestions.map((q) => (
                    <li key={q.id}>
                      {q.text.substring(0, 60)}... ({q.type})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="form-navigation">
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={step === 1}
            className="btn-secondary"
          >
            ← Previous
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canProceedToNext()}
              className="btn-primary"
            >
              Next →
            </button>
          ) : (
            <button type="submit" className="btn-primary">
              {examId ? 'Update Exam' : 'Create & Publish Exam'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
