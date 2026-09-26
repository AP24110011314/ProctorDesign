import apiClient from './apiClient';

/**
 * Grading & results API service
 * Implements SRS.md FR-26 to FR-29, UI_UX_SPEC.md §4.5/§4.10/§4.11
 *
 * All grading endpoints are faculty/admin-only server-side; the student
 * result endpoint is gated by results_published server-side (FR-28).
 */
export const gradingService = {
  // List answers awaiting manual grading (faculty/admin)
  // Backend contract: ?ungraded_only=1 (default) shows ungraded only,
  // ?ungraded_only=0 shows graded ones too.
  getQueue: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.exam_id) params.append('exam_id', filters.exam_id);
    params.append('ungraded_only', filters.ungraded_only === false ? '0' : '1');
    if (filters.page) params.append('page', filters.page);
    const response = await apiClient.get(`/grading/answers/?${params.toString()}`);
    return response.data;
  },

  // Assign final marks + feedback to one answer (faculty/admin)
  gradeAnswer: async (answerId, { marks_awarded, grading_feedback = '' }) => {
    const response = await apiClient.post(`/grading/answers/${answerId}/grade/`, {
      marks_awarded,
      grading_feedback,
    });
    return response.data;
  },

  // AI-assist suggestion (read-only; 403 when AI_ASSIST_GRADING_ENABLED=False)
  suggestMarks: async (answerId) => {
    const response = await apiClient.post(`/grading/answers/${answerId}/suggest/`);
    return response.data;
  },

  // Publish / unpublish results for an exam (faculty/admin)
  publishResults: async (examId) => {
    const response = await apiClient.post(`/grading/exams/${examId}/publish/`);
    return response.data;
  },

  unpublishResults: async (examId) => {
    const response = await apiClient.post(`/grading/exams/${examId}/unpublish/`);
    return response.data;
  },

  // Download CSV/PDF export of scores + integrity columns (faculty/admin)
  downloadReport: async (examId, filetype = 'csv') => {
    const response = await apiClient.get(
      `/grading/exams/${examId}/export/?filetype=${filetype}`,
      { responseType: 'blob' }
    );
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `exam_${examId}_results.${filetype}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  // Backwards-compatible alias
  downloadCsv: async (examId) => gradingService.downloadReport(examId, 'csv'),
};

/**
 * Attempt results API service
 */
export const resultService = {
  // Attempts list; supports ?exam_id= (faculty sees all, students own only)
  getAttempts: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.exam_id) params.append('exam_id', filters.exam_id);
    if (filters.page) params.append('page', filters.page);
    const response = await apiClient.get(`/attempts/?${params.toString()}`);
    return response.data;
  },

  // Published breakdown for one attempt (student, own attempt only)
  getResult: async (attemptId) => {
    const response = await apiClient.get(`/attempts/${attemptId}/result/`);
    return response.data;
  },
};
