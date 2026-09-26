"""
RBAC (Role-Based Access Control) utilities
Implements SRS.md FR-4: Role-based endpoint restrictions
"""

from functools import wraps
from rest_framework.response import Response
from rest_framework import status
from .models import User


def require_role(*allowed_roles):
    """
    Decorator to enforce role-based access control on views.

    Usage:
        @api_view(['GET'])
        @permission_classes([IsAuthenticated])
        @require_role(User.Role.FACULTY, User.Role.ADMIN)
        def faculty_only_view(request):
            ...

    For ViewSet methods:
        @require_role(User.Role.FACULTY, User.Role.ADMIN)
        def create(self, request, *args, **kwargs):
            ...

    Per AI_RULES.md §5: All new endpoints require explicit role check (default-deny)
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapped_view(self_or_request, *args, **kwargs):
            # Handle both ViewSet methods (self, request) and function views (request)
            if hasattr(self_or_request, 'request'):
                # ViewSet method: first arg is self
                request = self_or_request.request
                func_args = (self_or_request,) + args
            else:
                # Function view: first arg is request
                request = self_or_request
                func_args = (request,) + args

            # Check if user is authenticated (should be handled by DRF permission_classes)
            if not request.user or not request.user.is_authenticated:
                return Response(
                    {'error': {'code': 'unauthorized', 'message': 'Authentication required'}},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            # Superusers bypass all role checks
            if request.user.is_superuser:
                return view_func(*func_args, **kwargs)

            # Check if user's role is in allowed_roles
            if request.user.role not in allowed_roles:
                return Response(
                    {'error': {'code': 'forbidden', 'message': 'You do not have permission to access this resource'}},
                    status=status.HTTP_403_FORBIDDEN
                )

            return view_func(*func_args, **kwargs)

        return wrapped_view
    return decorator


def is_student(user):
    """Check if user is a student"""
    return user.is_authenticated and (user.role == User.Role.STUDENT or user.is_superuser)


def is_faculty(user):
    """Check if user is faculty"""
    return user.is_authenticated and (user.role == User.Role.FACULTY or user.is_superuser)


def is_admin(user):
    """Check if user is admin"""
    return user.is_authenticated and (user.role == User.Role.ADMIN or user.is_superuser)


def is_faculty_or_admin(user):
    """Check if user is faculty or admin"""
    return user.is_authenticated and (
        user.role in [User.Role.FACULTY, User.Role.ADMIN] or user.is_superuser
    )
