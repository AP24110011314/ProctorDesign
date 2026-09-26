import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Protected route wrapper (SRS.md FR-4: RBAC)
 * Per UI_UX_SPEC.md §5: RoleGuardRoute wraps routes to redirect unauthorized roles
 */
export const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Superusers bypass role checks server-side, so the UX guard lets them
  // through too (their `role` field may be anything).
  if (
    allowedRoles.length > 0 &&
    !allowedRoles.includes(user.role) &&
    !user.is_superuser
  ) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
