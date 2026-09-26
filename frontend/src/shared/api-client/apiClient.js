import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add JWT token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token refresh
// Single-flight: concurrent 401s share one refresh call. Without this,
// N parallel 401s fire N refresh POSTs and ROTATE_REFRESH_TOKENS +
// BLACKLIST_AFTER_ROTATION blacklists all but the first (backend
// config/settings.py), logging the user out spuriously.
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
  // ProtectedRoute already redirects unauthenticated users via React Router;
  // only hard-redirect when tokens existed but refresh failed, and avoid
  // looping when already on a public auth page.
  const path = window.location.pathname;
  if (path !== '/login' && path !== '/register') {
    window.location.href = '/login';
  }
};

const doRefresh = async () => {
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
        // Backends with ROTATE_REFRESH_TOKENS return a new refresh token.
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

    // Only attempt refresh for authenticated API calls: skip auth endpoints
    // themselves, non-401s, already-retried requests, and requests that
    // never had a token (logged-out user — ProtectedRoute handles redirect).
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
      // Refresh token expired/invalid/blacklisted — drop stale credentials.
      clearTokensAndRedirect();
      return Promise.reject(refreshError);
    }
  }
);

export default apiClient;
