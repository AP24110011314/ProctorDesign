import apiClient from './apiClient';

const API_ORIGIN =
  (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api').replace(/\/api\/?$/, '');

/**
 * Proctoring API service (SRS.md FR-14, FR-25).
 */
export const proctoringService = {
  // Start an attempt for an exam (student)
  startExam: async (examId) => {
    const response = await apiClient.post('/attempts/start_exam/', { exam_id: examId });
    return response.data;
  },

  // Upload the one-time reference still (FR-14)
  uploadReferencePhoto: async (attemptId, blob) => {
    const form = new FormData();
    form.append('photo', blob, 'reference.jpg');
    const response = await apiClient.post(
      `/attempts/${attemptId}/reference_photo/`,
      form
    );
    return response.data;
  },

  // Live-monitoring snapshot for an exam (faculty/admin, FR-25)
  getMonitor: async (examId) => {
    const response = await apiClient.get(`/exams/${examId}/monitor/`);
    return response.data;
  },

  // Flag list for review (faculty/admin)
  getEvents: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.attempt_id) params.append('attempt_id', filters.attempt_id);
    if (filters.exam_id) params.append('exam_id', filters.exam_id);
    if (filters.unreviewed_only) params.append('unreviewed_only', 'true');
    const response = await apiClient.get(`/proctoring/events/?${params.toString()}`);
    return response.data;
  },

  // Mark one flag human-reviewed (faculty/admin)
  reviewEvent: async (eventId) => {
    const response = await apiClient.post(`/proctoring/events/${eventId}/review/`);
    return response.data;
  },

  // Evidence thumbnails are served as relative /media/... URLs in dev
  evidenceUrl: (path) => (path ? `${API_ORIGIN}${path}` : null),
};
