import apiClient from './apiClient';

/**
 * System oversight API service (SRS.md FR-30, FR-31, UI_UX_SPEC §4.13).
 * All endpoints are admin-only server-side (overview + audit log);
 * void is admin + own-course faculty.
 */
export const adminService = {
  getOverview: async () => {
    const response = await apiClient.get('/system/overview/');
    return response.data;
  },

  getAuditLog: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.action) params.append('action', filters.action);
    if (filters.page) params.append('page', filters.page);
    const response = await apiClient.get(`/system/audit-log/?${params.toString()}`);
    return response.data;
  },

  voidAttempt: async (attemptId, reason) => {
    const response = await apiClient.post(`/attempts/${attemptId}/void/`, { reason });
    return response.data;
  },

  // -- Admin course management (create/edit/deactivate, never delete) --
  listCourses: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.q) params.append('q', filters.q);
    if (filters.is_active) params.append('is_active', filters.is_active);
    if (filters.page) params.append('page', filters.page);
    const query = params.toString();
    const response = await apiClient.get(`/admin/courses/${query ? `?${query}` : ''}`);
    return response.data;
  },

  getCourse: async (id) => {
    const response = await apiClient.get(`/admin/courses/${id}/`);
    return response.data;
  },

  createCourse: async (courseData) => {
    const response = await apiClient.post('/admin/courses/', courseData);
    return response.data;
  },

  updateCourse: async (id, courseData) => {
    const response = await apiClient.patch(`/admin/courses/${id}/`, courseData);
    return response.data;
  },

  getFacultyOptions: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const response = await apiClient.get(`/admin/faculty/${query ? `?${query}` : ''}`);
    return response.data;
  },

  listFaculty: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const response = await apiClient.get(`/admin/faculty/${query ? `?${query}` : ''}`);
    return response.data;
  },

  createFaculty: async (facultyData) => {
    const response = await apiClient.post('/admin/faculty/', facultyData);
    return response.data;
  },
};
