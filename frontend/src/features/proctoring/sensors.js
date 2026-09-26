import { useEffect, useMemo, useRef, useState } from 'react';
import { captureThumbnail, createFlagEmitter } from './flagEmitter';

/**
 * Isolated proctoring sensors (ARCHITECTURE.md §4). Each hook only emits
 * through the shared flagEmitter, so detection logic stays swappable without
 * touching the exam-taking UI.
 *
 * Face-detection note (SRS.md FR-20): real in-browser CV (face-api.js /
 * MediaPipe) is the documented swap-in at `useFaceCheck` — it is intentionally
 * not bundled here (tech lock: no new heavy dependency). Until then the hook
 * monitors stream health (camera cut/muted → NO_FACE, best-effort) and every
 * sensor can attach a compressed still via captureThumbnail (NFR-10).
 */

/** TAB_SWITCH on tab hide / window blur (FR-21). */
export const useTabVisibility = (emit, videoRef, active) => {
  useEffect(() => {
    if (!active || !emit) return;
    const onHide = async () => {
      const thumb = videoRef?.current
        ? await captureThumbnail(videoRef.current)
        : null;
      emit('TAB_SWITCH', { thumbnailBlob: thumb });
    };
    const onVis = () => {
      if (document.hidden) onHide();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onHide);
    };
  }, [active, emit, videoRef]);
};

/** FULLSCREEN_EXIT with a re-enter affordance for the UI banner (FR-19/21). */
export const useFullscreenGuard = (emit, active) => {
  const [fullscreenLost, setFullscreenLost] = useState(false);
  useEffect(() => {
    if (!active || !emit) return;
    const onChange = () => {
      if (!document.fullscreenElement) {
        setFullscreenLost(true);
        emit('FULLSCREEN_EXIT');
      } else {
        setFullscreenLost(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [active, emit]);

  const reenter = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return { fullscreenLost, reenter };
};

/** CLIPBOARD_EVENT + DEVTOOLS_ATTEMPT, best-effort (FR-21). */
export const useClipboardGuard = (emit, active) => {
  useEffect(() => {
    if (!active || !emit) return;
    const onClipboard = (kind) => (e) => {
      e.preventDefault();
      emit('CLIPBOARD_EVENT', { details: { kind } });
    };
    const onContext = (e) => {
      e.preventDefault();
      emit('DEVTOOLS_ATTEMPT', { details: { kind: 'contextmenu' } });
    };
    const onKeys = (e) => {
      const devtools =
        e.key === 'F12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) ||
        ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'U');
      if (devtools) {
        e.preventDefault();
        emit('DEVTOOLS_ATTEMPT', { details: { kind: 'keyboard' } });
      }
    };
    const copy = onClipboard('copy');
    const cut = onClipboard('cut');
    const paste = onClipboard('paste');
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKeys);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('keydown', onKeys);
    };
  }, [active, emit]);
};

/**
 * Webcam stream for thumbnails + stream-health face fallback (FR-20, degraded).
 * Returns { videoRef, status }: status is ready|blocked|lost.
 */
export const useProctoringVideo = (emit, active) => {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!active) return;
    let stream = null;
    let cancelled = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus('ready');
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          setStatus('lost');
          emit?.('NO_FACE', { details: { reason: 'track-ended' } });
        });
        stream.getVideoTracks()[0].addEventListener('mute', () => {
          emit?.('NO_FACE', { details: { reason: 'track-muted' } });
        });
      } catch {
        setStatus('blocked');
      }
    };
    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setStatus('idle');
    };
  }, [active, emit]);

  return { videoRef, status };
};

/**
 * Strict-mode microphone level sampling (FR-22): flags LOUD_NOISE only when
 * the ambient level stays above threshold for the sustained window.
 */
export const useMicrophoneLevel = (
  emit,
  active,
  { threshold = 0.25, sustainedMs = 3000, sampleMs = 200 } = {}
) => {
  useEffect(() => {
    if (!active || !emit) return;
    let stream = null;
    let raf = 0;
    let loudSince = 0;
    let cancelled = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms > threshold) {
            if (!loudSince) loudSince = performance.now();
            else if (performance.now() - loudSince > sustainedMs) {
              emit('LOUD_NOISE', { details: { rms: Number(rms.toFixed(3)) } });
              loudSince = performance.now(); // cooldown handled by emitter too
            }
          } else {
            loudSince = 0;
          }
          raf = requestAnimationFrame(() => setTimeout(tick, sampleMs));
        };
        tick();
        return () => {
          cancelAnimationFrame(raf);
          ctx.close();
          stream?.getTracks().forEach((t) => t.stop());
        };
      } catch {
        // Mic denied: stay silent, never flag from a missing sensor.
      }
    };
    const cleanupPromise = start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      cleanupPromise?.then?.((cleanup) => cleanup?.());
    };
  }, [active, emit, threshold, sustainedMs, sampleMs]);
};

/**
 * Composite proctoring hook for the exam-taking screen.
 * mode: 'off' | 'basic' | 'strict'. Returns { videoRef, cameraStatus,
 * fullscreenLost, reenterFullscreen }.
 */
export const useProctoring = (attemptId, mode) => {
  const active = Boolean(attemptId) && mode !== 'off' && mode != null;
  const emitter = useMemo(
    () => (attemptId ? createFlagEmitter(attemptId) : null),
    [attemptId]
  );
  const emit = emitter?.emit;

  const { videoRef, status } = useProctoringVideo(emit, active);
  const { fullscreenLost, reenter } = useFullscreenGuard(emit, active);
  useTabVisibility(emit, videoRef, active);
  useClipboardGuard(emit, active);
  useMicrophoneLevel(emit, active && mode === 'strict');

  return {
    videoRef,
    cameraStatus: active ? status : 'off',
    fullscreenLost,
    reenterFullscreen: reenter,
  };
};
