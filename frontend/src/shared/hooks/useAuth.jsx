import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../api-client/authService';

const AuthContext = createContext(null);

// Roles the backend actually issues (authentication.User.Role). Compared
// case-insensitively after normalization; unknown values are kept as-is on
// the user object (never silently remapped to 'student') but grant no
// role — RoleBasedRedirect sends them to /unauthorized unless superuser.
const KNOWN_ROLES = new Set(['student', 'faculty', 'admin']);

/**
 * Normalize a user object from the API or localStorage.
 * Returns null when the payload cannot be trusted (corrupt JSON shape,
 * missing identity) so callers never resurrect a stale/foreign session.
 * The role is lowercased to tolerate casing drift ('ADMIN' vs 'admin')
 * without ever defaulting a missing/invalid role to 'student'.
 */
const normalizeUser = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.id == null && !raw.email && !raw.username) return null;
  const role =
    typeof raw.role === 'string' && raw.role.trim()
      ? raw.role.trim().toLowerCase()
      : raw.role ?? null;
  return { ...raw, role };
};

/** Persist a fresh login/register payload; throws on malformed responses. */
const persistSession = (data) => {
  const user = normalizeUser(data?.user);
  const access = data?.tokens?.access;
  const refresh = data?.tokens?.refresh;
  if (!user || !access || !refresh) {
    throw new Error('Malformed authentication response');
  }
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
  localStorage.setItem('user', JSON.stringify(user));
  return user;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the session on refresh. A corrupt or unrecognizable entry is
    // discarded (credentials cleared) rather than displayed.
    try {
      const stored = authService.getCurrentUser();
      const normalized = normalizeUser(stored);
      if (stored && !normalized) {
        authService.logout();
        setUser(null);
      } else {
        setUser(normalized);
      }
    } catch {
      authService.logout();
      setUser(null);
    }
    setLoading(false);

    // Token refresh failed elsewhere (apiClient cleared storage): drop the
    // in-memory user too so the badge can never outlive the session.
    const handleExpired = () => setUser(null);
    window.addEventListener('auth:session-expired', handleExpired);
    return () => window.removeEventListener('auth:session-expired', handleExpired);
  }, []);

  const login = async (email, password) => {
    // Clear any previous session first so a stale user object can never
    // survive a new login (e.g. admin signing in after a student on a
    // shared machine).
    authService.logout();
    setUser(null);
    const data = await authService.login(email, password);
    const normalized = { ...data, user: persistSession(data) };
    setUser(normalized.user);
    return normalized;
  };

  const register = async (userData) => {
    authService.logout();
    setUser(null);
    const data = await authService.register(userData);
    const normalized = { ...data, user: persistSession(data) };
    setUser(normalized.user);
    return normalized;
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  const role = typeof user?.role === 'string' ? user.role : null;
  const value = {
    user,
    login,
    register,
    logout,
    loading,
    isAuthenticated: !!user,
    isStudent: role === 'student',
    isFaculty: role === 'faculty',
    isAdmin: role === 'admin' || user?.is_superuser === true,
    isSuperuser: user?.is_superuser === true,
    hasKnownRole: role != null && KNOWN_ROLES.has(role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
