from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from authentication.models import User
from authentication.permissions import require_role
from .models import ProctoringEvent
from .serializers import ProctoringEventSerializer


class EventReportThrottle(SimpleRateThrottle):
    """
    Flood guard on flag ingest (ARCHITECTURE.md §8): a compromised or buggy
    client must not be able to drown the flag pipeline. Rate configured via
    DEFAULT_THROTTLE_RATES['event_reports'].
    """
    scope = 'event_reports'

    def get_cache_key(self, request, view):
        if not request.user.is_authenticated:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}


class ProctoringEventViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Faculty/admin review of flags (SRS.md FR-24/FR-25).

    NFR-7 per-request scoping: faculty see events for attempts in their own
    courses only; admins see all. Students have no access here — their only
    flag touchpoint is reporting on their own in-progress attempt
    (POST /api/attempts/{id}/events/).
    """
    serializer_class = ProctoringEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = ProctoringEvent.objects.select_related('attempt__student', 'attempt__exam__course')
        if user.is_admin() or user.is_superuser:
            pass
        elif user.is_faculty():
            qs = qs.filter(attempt__exam__course__faculty=user)
        else:
            return ProctoringEvent.objects.none()
        attempt_id = self.request.query_params.get('attempt_id')
        if attempt_id:
            qs = qs.filter(attempt_id=attempt_id)
        exam_id = self.request.query_params.get('exam_id')
        if exam_id:
            qs = qs.filter(attempt__exam_id=exam_id)
        unreviewed = self.request.query_params.get('unreviewed_only')
        if unreviewed == 'true':
            qs = qs.filter(reviewed=False)
        return qs

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def review(self, request, pk=None):
        """Mark a flag human-reviewed (flags are for review, never auto-fail)."""
        from system.models import AuditLog, log_action
        event = self.get_object()
        event.reviewed = True
        event.reviewed_by = request.user
        event.reviewed_at = timezone.now()
        event.save(update_fields=['reviewed', 'reviewed_by', 'reviewed_at'])
        log_action(request.user, AuditLog.Action.FLAG_REVIEW, event, {})
        return Response(ProctoringEventSerializer(event).data)
