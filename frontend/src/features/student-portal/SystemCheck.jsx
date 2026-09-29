import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { proctoringService } from '../../shared/api-client/proctoringService';
import { dataUrlToBlob } from '../proctoring/flagEmitter';
import './SystemCheck.css';

/**
 * System Check screen before exam starts (UI_UX_SPEC.md §4.3)
 * Implements SRS.md FR-13, FR-14
 */
export const SystemCheck = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1: Camera check, 2: Reference photo, 3: Rules
  const [cameraReady, setCameraReady] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (step === 1 || step === 2) {
      if (!streamRef.current) {
        startCamera();
      } else if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
    } else {
      stopCamera();
    }
  }, [step]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }

      setCameraReady(true);
      setError('');
    } catch (err) {
      setError('Camera permission denied. Please enable camera access and retry.');
      setCameraReady(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0);
      const photoData = canvas.toDataURL('image/jpeg');
      setReferencePhoto(photoData);
      setStep(3);
      stopCamera();
    }
  };

  const retakePhoto = () => {
    setReferencePhoto(null);
    setStep(1);
  };

  const [starting, setStarting] = useState(false);

  const handleStartExam = async () => {
    if (!rulesAccepted) {
      setError('You must accept the exam rules to continue');
      return;
    }

    try {
      setStarting(true);
      setError('');
      // Create the server-side attempt first (server-authoritative timer)
      const started = await proctoringService.startExam(examId);
      const attemptId = started.attempt_id || started.id;
      // Upload the one-time reference still (FR-14); a failed upload must
      // not block the exam — faculty can review without it.
      if (referencePhoto) {
        try {
          await proctoringService.uploadReferencePhoto(
            attemptId,
            dataUrlToBlob(referencePhoto)
          );
        } catch {
          // best-effort only
        }
      }
      // Request fullscreen, then enter the exam
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      navigate(`/student/attempts/${attemptId}/take`);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.exam_id?.[0] ||
          'Could not start the exam. Please try again.'
      );
      setStarting(false);
    }
  };

  return (
    <div className="system-check-container">
      <div className="system-check-card">
        <h1>System Check</h1>
        <div className="stepper">
          <div className={`step ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className={`step ${step >= 2 ? 'active' : ''}`}>2</div>
          <div className={`step ${step >= 3 ? 'active' : ''}`}>3</div>
        </div>

        {error && <div className="error-message">{error}</div>}

        {/* Step 1: Camera Check */}
        {step === 1 && (
          <div className="check-step">
            <h2>Camera Check</h2>
            <p>We need to verify your camera is working properly.</p>

            <div className="video-container">
              <video ref={videoRef} autoPlay playsInline className="preview-video" />
            </div>

            {cameraReady ? (
              <div className="success-indicator">✓ Camera is working</div>
            ) : (
              <div className="waiting-indicator">Waiting for camera...</div>
            )}

            <div className="step-actions">
              <button
                className="btn-primary"
                onClick={() => setStep(2)}
                disabled={!cameraReady}
              >
                Next: Capture Reference Photo
              </button>
            </div>

            {!cameraReady && error && (
              <div className="help-text">
                <p>If your camera isn't working:</p>
                <ul>
                  <li>Check browser permissions (click the camera icon in address bar)</li>
                  <li>Make sure no other application is using the camera</li>
                  <li>Try refreshing the page</li>
                </ul>
                <button onClick={startCamera} className="btn-secondary">
                  Retry Camera
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Reference Photo */}
        {step === 2 && (
          <div className="check-step">
            <h2>Reference Photo</h2>
            <p>Capture a clear photo of your face for identity verification.</p>

            {!referencePhoto ? (
              <>
                <div className="video-container">
                  <video ref={videoRef} autoPlay playsInline className="preview-video" />
                  <div className="face-guide">
                    <div className="face-oval"></div>
                  </div>
                </div>

                <div className="instructions">
                  <p>Position your face within the oval and ensure good lighting</p>
                </div>

                <div className="step-actions">
                  <button className="btn-secondary" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button className="btn-primary" onClick={capturePhoto}>
                    Capture Photo
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="photo-preview">
                  <img src={referencePhoto} alt="Reference" />
                </div>

                <div className="step-actions">
                  <button className="btn-secondary" onClick={retakePhoto}>
                    Retake
                  </button>
                  <button className="btn-primary" onClick={() => setStep(3)}>
                    Confirm & Continue
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Rules & Acknowledgement */}
        {step === 3 && (
          <div className="check-step">
            <h2>Exam Rules & Instructions</h2>

            <div className="rules-container">
              <h3>Important: You must follow these rules during the exam</h3>
              <ul className="rules-list">
                <li>🎥 Your camera must remain on throughout the exam</li>
                <li>🖥️ Stay in fullscreen mode - exiting will be logged</li>
                <li>🚫 Do not switch tabs or open other applications</li>
                <li>👤 Only you should be visible in the camera frame</li>
                <li>🔇 Maintain a quiet environment</li>
                <li>📵 Keep your phone away and out of reach</li>
                <li>⏱️ Your exam will auto-submit when time expires</li>
                <li>💾 Answers are saved automatically every few seconds</li>
              </ul>

              <div className="warning-box">
                <strong>⚠️ Note:</strong> Suspicious activities will be flagged for review by faculty.
                The AI only raises flags - it does not automatically fail you.
              </div>

              <div className="acknowledgement">
                <label>
                  <input
                    type="checkbox"
                    checked={rulesAccepted}
                    onChange={(e) => setRulesAccepted(e.target.checked)}
                  />
                  <span>I understand and agree to follow these rules</span>
                </label>
              </div>
            </div>

            <div className="step-actions">
              <button className="btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                className="btn-primary btn-large"
                onClick={handleStartExam}
                disabled={!rulesAccepted || starting}
              >
                {starting ? 'Starting...' : 'Enter Fullscreen & Start Exam'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
