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
};
