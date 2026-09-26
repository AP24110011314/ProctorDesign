import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../../shared/api-client/apiClient';
import { useProctoring } from '../proctoring/sensors';
import './ExamTaking.css';

/**
 * Exam-Taking Screen (UI_UX_SPEC.md §4.4)
 * Implements SRS.md FR-15 to FR-19
 *
 * Critical: Timer is server-authoritative (NFR-14)
 * Client-side countdown is display only
 */
export const ExamTaking = () => {
  const { attemptId } = useParams();
  const navigate = useNavigate();

  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState('');
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [proctoringMode, setProctoringMode] = useState(null);

  const autosaveTimer = useRef(null);
  const serverTimeTimer = useRef(null);

  // Client-side proctoring sensors (FR-20–FR-22); no-op when mode is 'off'.
  // Detection runs in-browser; only flag events + thumbnails reach the server.
  const proctoringActive =
    attempt && attempt.status === 'in_progress' && proctoringMode !== 'off' && proctoringMode !== null;
  const { videoRef, cameraStatus, fullscreenLost, reenterFullscreen } = useProctoring(
    proctoringActive ? attemptId : null,
    proctoringMode
  );

  useEffect(() => {
    loadAttempt();

    return () => {
      // Cleanup timers
      if (autosaveTimer.current) clearInterval(autosaveTimer.current);
      if (serverTimeTimer.current) clearInterval(serverTimeTimer.current);
    };
  }, [attemptId]);

  useEffect(() => {
    // Start autosave timer (every 15 seconds per SRS.md FR-16)
    if (attempt && attempt.status === 'in_progress') {
      autosaveTimer.current = setInterval(() => {
        autosaveAnswers();
      }, 15000);

      // Start server time check (every 30 seconds)
      serverTimeTimer.current = setInterval(() => {
        checkServerTime();
      }, 30000);
    }
  }, [attempt]);

  const loadAttempt = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/attempts/${attemptId}/`);

      setAttempt(response.data);
      setQuestions(response.data.questions || []);

      // Convert answers array to object keyed by question_id
      if (response.data.answers) {
        setAnswers(response.data.answers);
      }

      setRemainingTime(response.data.remaining_time_seconds);

      // Proctoring mode drives the client-side sensors (FR-20: off disables them)
      try {
        const examRes = await apiClient.get(`/exams/${response.data.exam}/`);
        setProctoringMode(examRes.data.proctoring_mode || 'off');
      } catch {
        setProctoringMode('off');
      }

      // Check if expired
      if (response.data.remaining_time_seconds <= 0) {
        handleAutoSubmit();
      }
    } catch (err) {
      setError('Failed to load exam');
    } finally {
      setLoading(false);
    }
  };

  const checkServerTime = async () => {
    try {
      const response = await apiClient.get(`/attempts/${attemptId}/check_time/`);
      setRemainingTime(response.data.remaining_seconds);

      if (response.data.expired || response.data.auto_submitted) {
        handleAutoSubmit();
      }
    } catch (err) {
      console.error('Failed to check server time');
    }
  };

  const handleAnswerChange = (questionId, field, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        [field]: value,
        question_id: questionId,
      }
    }));
  };

  const autosaveAnswers = async () => {
    if (saving) return;

    setSaving(true);
    try {
      // Save current question's answer
      const currentQuestion = questions[currentQuestionIndex];
      if (currentQuestion && answers[currentQuestion.question_id]) {
        await apiClient.post(
          `/attempts/${attemptId}/save_answer/`,
          answers[currentQuestion.question_id]
        );
        setLastSaved(new Date());
      }
    } catch (err) {
      console.error('Autosave failed');
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentAnswer = async () => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;

    try {
      setSaving(true);
      await apiClient.post(
        `/attempts/${attemptId}/save_answer/`,
        {
          question_id: currentQuestion.question_id,
          selected_option_ids: answers[currentQuestion.question_id]?.selected_option_ids || [],
          text_answer: answers[currentQuestion.question_id]?.text_answer || '',
          is_marked_for_review: answers[currentQuestion.question_id]?.is_marked_for_review || false,
          is_visited: true,
        }
      );
      setLastSaved(new Date());
    } catch (err) {
      setError('Failed to save answer');
    } finally {
      setSaving(false);
    }
  };

  const navigateQuestion = (index) => {
    saveCurrentAnswer();
    setCurrentQuestionIndex(index);
  };

  const markForReview = () => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) return;

    handleAnswerChange(currentQuestion.question_id, 'is_marked_for_review', true);
    saveCurrentAnswer();

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handleSubmitClick = () => {
    // Count answered/unanswered/marked questions
    const stats = getQuestionStats();
    setShowSubmitModal(true);
  };

  const handleSubmit = async () => {
    try {
      await autosaveAnswers(); // Save any unsaved answers first

      const response = await apiClient.post(`/attempts/${attemptId}/submit/`);

      setShowSubmitModal(false);
      navigate('/student/exams', {
        state: { message: 'Exam submitted successfully!' }
      });
    } catch (err) {
      setError('Failed to submit exam');
      setShowSubmitModal(false);
    }
  };

  const handleAutoSubmit = () => {
    // Show auto-submit message
    setError('Time\'s up! Your exam has been automatically submitted.');
    setTimeout(() => {
      navigate('/student/exams');
    }, 3000);
  };

  const getQuestionStats = () => {
    let answered = 0;
    let unanswered = 0;
    let marked = 0;

    questions.forEach(q => {
      const answer = answers[q.question_id];
      if (answer?.selected_option_ids?.length > 0 || answer?.text_answer) {
        answered++;
      } else {
        unanswered++;
      }
      if (answer?.is_marked_for_review) {
        marked++;
      }
    });

    return { answered, unanswered, marked, total: questions.length };
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const getTimerColor = () => {
    if (remainingTime <= 60) return 'timer-critical';
    if (remainingTime <= 300) return 'timer-warning';
    return 'timer-normal';
  };

  // Client-side countdown (display only, server is source of truth)
  useEffect(() => {
    if (remainingTime > 0 && attempt?.status === 'in_progress') {
      const timer = setInterval(() => {
        setRemainingTime(prev => Math.max(0, prev - 1));
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [remainingTime, attempt]);

  if (loading) return <div className="loading">Loading exam...</div>;

  const currentQuestion = questions[currentQuestionIndex];

  return (
    <div className="exam-taking-container">
      {/* Top bar with timer and monitoring indicator */}
      <div className="exam-top-bar">
        <div className="exam-info">
          <h2>{attempt?.exam_title}</h2>
        </div>

        <div className="timer-section">
          <div className={`timer ${getTimerColor()}`}>
            <span className="timer-label">Time Remaining</span>
            <span className="timer-value">{formatTime(remainingTime)}</span>
            {remainingTime <= 300 && (
              <span className="timer-warning-text">
                {remainingTime <= 60 ? 'Less than 1 minute!' : 'Less than 5 minutes'}
              </span>
            )}
          </div>

          <div className="autosave-indicator">
            {saving ? 'Saving...' : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : 'Not saved'}
          </div>
        </div>

        <div className="monitoring-badge">
          {proctoringMode === 'off' || proctoringMode === null
            ? 'Proctoring off'
            : cameraStatus === 'blocked'
              ? '⚠️ Camera blocked — please enable it'
              : '🎥 Monitoring active'}
        </div>
        {/* Hidden sensor video element (never displayed, never recorded) */}
        {proctoringActive && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {fullscreenLost && (
        <div className="error-banner">
          You exited fullscreen — a flag was logged for faculty review. Flags never
          auto-fail you.{' '}
          <button type="button" onClick={reenterFullscreen} className="btn-secondary">
            Return to fullscreen
          </button>
        </div>
      )}

      <div className="exam-content">
        {/* Main question area */}
        <div className="question-area">
          {currentQuestion && (
            <>
              <div className="question-header">
                <span className="question-number">
                  Question {currentQuestionIndex + 1} of {questions.length}
                </span>
                <span className="question-marks">
                  {currentQuestion.marks} marks
                </span>
              </div>

              <div className="question-text">
                {currentQuestion.question_text}
              </div>

              {/* MCQ Options */}
              {currentQuestion.question_type === 'mcq_single' && (
                <div className="options-list">
                  {currentQuestion.options.map((option) => (
                    <label key={option.id} className="option-item">
                      <input
                        type="radio"
                        name={`question-${currentQuestion.question_id}`}
                        checked={answers[currentQuestion.question_id]?.selected_option_ids?.includes(option.id)}
                        onChange={() => handleAnswerChange(
                          currentQuestion.question_id,
                          'selected_option_ids',
                          [option.id]
                        )}
                      />
                      <span className="option-text">{option.text}</span>
                    </label>
                  ))}
                </div>
              )}

              {currentQuestion.question_type === 'mcq_multi' && (
                <div className="options-list">
                  {currentQuestion.options.map((option) => {
                    const selectedIds = answers[currentQuestion.question_id]?.selected_option_ids || [];
                    return (
                      <label key={option.id} className="option-item">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(option.id)}
                          onChange={(e) => {
                            const newSelected = e.target.checked
                              ? [...selectedIds, option.id]
                              : selectedIds.filter(id => id !== option.id);
                            handleAnswerChange(currentQuestion.question_id, 'selected_option_ids', newSelected);
                          }}
                        />
                        <span className="option-text">{option.text}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Short Answer */}
              {currentQuestion.question_type === 'short_answer' && (
                <textarea
                  className="short-answer-input"
                  value={answers[currentQuestion.question_id]?.text_answer || ''}
                  onChange={(e) => handleAnswerChange(currentQuestion.question_id, 'text_answer', e.target.value)}
                  placeholder="Type your answer here..."
                  rows={8}
                />
              )}
            </>
          )}
        </div>

        {/* Question palette sidebar */}
        <div className="question-palette">
          <h3>Questions</h3>

          <div className="palette-grid">
            {questions.map((q, index) => {
              const answer = answers[q.question_id];
              let status = 'not-visited';
              if (answer?.is_visited) {
                status = answer?.selected_option_ids?.length > 0 || answer?.text_answer
                  ? 'answered'
                  : 'not-answered';
              }
              if (answer?.is_marked_for_review) {
                status = 'marked';
              }

              return (
                <button
                  key={q.question_id}
                  className={`palette-btn ${status} ${index === currentQuestionIndex ? 'current' : ''}`}
                  onClick={() => navigateQuestion(index)}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>

          <div className="palette-legend">
            <div className="legend-item">
              <span className="legend-color answered"></span>
              <span>Answered</span>
            </div>
            <div className="legend-item">
              <span className="legend-color marked"></span>
              <span>Marked for Review</span>
            </div>
            <div className="legend-item">
              <span className="legend-color not-answered"></span>
              <span>Not Answered</span>
            </div>
            <div className="legend-item">
              <span className="legend-color not-visited"></span>
              <span>Not Visited</span>
            </div>
          </div>

          <button
            className="btn-submit-exam"
            onClick={handleSubmitClick}
          >
            Submit Exam
          </button>
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="exam-bottom-bar">
        <button
          className="btn-secondary"
          onClick={() => navigateQuestion(currentQuestionIndex - 1)}
          disabled={currentQuestionIndex === 0}
        >
          ← Previous
        </button>

        <button
          className="btn-secondary"
          onClick={markForReview}
        >
          Mark for Review & Next
        </button>

        <button
          className="btn-primary"
          onClick={() => {
            saveCurrentAnswer();
            if (currentQuestionIndex < questions.length - 1) {
              setCurrentQuestionIndex(currentQuestionIndex + 1);
            }
          }}
        >
          Save & Next →
        </button>
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Submit Exam?</h2>

            <div className="submit-stats">
              <p>You have answered <strong>{getQuestionStats().answered}</strong> of <strong>{getQuestionStats().total}</strong> questions.</p>
              <ul>
                <li>Answered: {getQuestionStats().answered}</li>
                <li>Unanswered: {getQuestionStats().unanswered}</li>
                <li>Marked for Review: {getQuestionStats().marked}</li>
              </ul>
            </div>

            <p className="warning-text">⚠️ Once submitted, you cannot make changes.</p>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowSubmitModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSubmit}>
                Submit Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
