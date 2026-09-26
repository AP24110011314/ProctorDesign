import apiClient from '../../shared/api-client/apiClient';

/**
 * Single funnel for all client-side proctoring sensors
 * (ARCHITECTURE.md §4: isolated hooks emit only through here).
 *
 * - Per-type cooldowns stop a stuck sensor from flooding the backend
 *   (server also enforces 60/min per student).
 * - Fire-and-forget: reporting must never break the exam on network errors.
 * - Thumbnails go as multipart files; plain flags go as JSON.
 */
const DEFAULT_COOLDOWNS_MS = {
  NO_FACE: 60_000,
  MULTIPLE_FACES: 60_000,
  FACE_MISMATCH: 60_000,
  TAB_SWITCH: 10_000,
  FULLSCREEN_EXIT: 10_000,
  CLIPBOARD_EVENT: 15_000,
  DEVTOOLS_ATTEMPT: 30_000,
  LOUD_NOISE: 60_000,
};

export const createFlagEmitter = (attemptId, cooldowns = {}) => {
  const limits = { ...DEFAULT_COOLDOWNS_MS, ...cooldowns };
  const lastSent = {};

  const emit = async (type, { thumbnailBlob = null, details = {} } = {}) => {
    if (!attemptId) return;
    const now = Date.now();
    if (lastSent[type] && now - lastSent[type] < (limits[type] ?? 30_000)) return;
    lastSent[type] = now;

    try {
      if (thumbnailBlob) {
        const form = new FormData();
        form.append('type', type);
        form.append('evidence', thumbnailBlob, 'thumb.jpg');
        form.append('client_timestamp', new Date().toISOString());
        form.append('details', JSON.stringify(details));
        await apiClient.post(`/attempts/${attemptId}/events/`, form);
      } else {
        await apiClient.post(`/attempts/${attemptId}/events/`, {
          type,
          client_timestamp: new Date().toISOString(),
          details,
        });
      }
    } catch {
      // Proctoring is best-effort: never interrupt the exam over a failed flag.
    }
  };

  return { emit };
};

/** Canvas thumbnail from a live <video> element (compressed still, NFR-10). */
export const captureThumbnail = (videoEl, width = 320) => {
  if (!videoEl || !videoEl.videoWidth) return null;
  const scale = width / videoEl.videoWidth;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(videoEl.videoHeight * scale);
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.6);
  });
};

export const dataUrlToBlob = (dataUrl) => {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
};
