import axios from 'axios';
import { isDemoModeActive, activateDemoMode, handleMockRequest } from './demoMockService';

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const API_BASE_URL = RAW_API_BASE.replace(/\/+$/, '');

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Request interceptor to add JWT token & route through demo mock if active
apiClient.interceptors.request.use(
  async (config) => {
    // If demo mode is active or we are on a hosted deployment without a remote backend
    if (isDemoModeActive()) {
      config.adapter = () => handleMockRequest(config);
      return config;
    }

    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token refresh & graceful demo fallback
let refreshPromise = null;

const isAuthEndpoint = (url = '') =>
  url.includes('/auth/login/') ||
  url.includes('/auth/register/') ||
  url.includes('/auth/token/refresh/') ||
  url.includes('/auth/logout/');

const clearTokensAndRedirect = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  window.dispatchEvent(new Event('auth:session-expired'));
  const path = window.location.pathname;
  if (path !== '/login' && path !== '/register') {
    window.location.href = '/login';
  }
};

const doRefresh = async () => {
  if (isDemoModeActive()) {
    const role = (JSON.parse(localStorage.getItem('user') || '{}').role) || 'student';
    const access = `demo_jwt_access_token_${role}_${Date.now()}`;
    localStorage.setItem('access_token', access);
    return access;
  }

  if (!refreshPromise) {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      return Promise.reject(new Error('No refresh token'));
    }
    refreshPromise = axios
      .post(`${API_BASE_URL}/auth/token/refresh/`, { refresh: refreshToken })
      .then((response) => {
        const { access, refresh: newRefresh } = response.data;
        localStorage.setItem('access_token', access);
        if (newRefresh) {
          localStorage.setItem('refresh_token', newRefresh);
        }
        return access;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Detect network failure (backend unreachable, mixed content block, offline, etc.)
    const isNetworkError =
      !error.response ||
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNREFUSED' ||
      (error.message && error.message.includes('Network Error'));

    if (isNetworkError && originalRequest) {
      // Gracefully switch to Demo Mode so preview deployments remain fully usable
      activateDemoMode();
      try {
        return await handleMockRequest(originalRequest);
      } catch (mockErr) {
        return Promise.reject(mockErr);
      }
    }

    // If login failed against a live backend (e.g. unseeded remote database on a hosted preview)
    // and the user provided documented demo credentials, fall back to the demo mock store
    const isLoginEndpoint = originalRequest?.url?.includes('/auth/login/');
    if (isLoginEndpoint && originalRequest && error.response?.status === 401) {
      let isDemoCreds = false;
      try {
        const body = typeof originalRequest.data === 'string' ? JSON.parse(originalRequest.data) : (originalRequest.data || {});
        const ident = String(body.email || body.username || '').trim().toLowerCase();
        const pass = String(body.password || '').trim();
        const validDemo =
          ((ident === 'admin' || ident === 'admin@proctox.edu') && pass === 'AdminPass123!') ||
          ((ident === 'faculty' || ident === 'faculty@proctox.edu') && pass === 'FacultyPass123!') ||
          ((ident === 'student' || ident === 'student@proctox.edu') && pass === 'StudentPass123!');
        if (validDemo) isDemoCreds = true;
      } catch {}

      if (isDemoCreds) {
        activateDemoMode();
        try {
          return await handleMockRequest(originalRequest);
        } catch (mockErr) {
          return Promise.reject(mockErr);
        }
      }
    }

    // Only attempt refresh for authenticated API calls
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint(originalRequest.url || '')
    ) {
      return Promise.reject(error);
    }

    if (!localStorage.getItem('refresh_token')) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const access = await doRefresh();
      originalRequest.headers.Authorization = `Bearer ${access}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      clearTokensAndRedirect();
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;
