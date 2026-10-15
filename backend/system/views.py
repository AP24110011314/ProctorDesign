import hmac

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from rest_framework import serializers, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import User
from authentication.permissions import require_role
from exams.models import Attempt, Exam
from proctoring.models import ProctoringEvent
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(
        source='actor.username', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ['id', 'actor', 'actor_username', 'action',
                  'target_type', 'target_id', 'details', 'timestamp']
        read_only_fields = fields


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Append-only trail: admin can read, nobody writes via the API."""
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = AuditLog.objects.select_related('actor').all()
        action = self.request.query_params.get('action')
        if action:
            qs = qs.filter(action=action)
        return qs

    @require_role(User.Role.ADMIN)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)


class AutoSubmitSweepView(APIView):
    """Cron sweep without Celery (free-tier production).

    POST /api/system/sweep/auto-submit/ — called every minute by a free
    external pinger (e.g. cron-job.org). Auth is the shared CRON_SECRET
    (header ``X-CRON-SECRET`` or ``?secret=``), not JWT, so no login session
    is needed. This is the one intentional exception to the default-deny
    @require_role rule: the secret *is* the gate, and an unset CRON_SECRET
    locks the endpoint (403) rather than opening it.

    Runs exams/auto_submit.py — the same code as Celery beat + lazy checks.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def _provided_secret(self, request):
        header = request.headers.get('X-CRON-SECRET', '')
        if header:
            return header
        query = request.query_params.get('secret', '')
        if query:
            return query
        try:
            body = request.data.get('secret', '') if isinstance(request.data, dict) else ''
        except Exception:
            body = ''
        return body or ''

    def post(self, request):
        expected = getattr(settings, 'CRON_SECRET', '') or ''
        if not expected:
            return Response(
                {'error': {'code': 'sweep_disabled',
                           'message': 'Auto-submit sweep is not configured'}},
                status=403,
            )
        if not hmac.compare_digest(str(self._provided_secret(request)), str(expected)):
            return Response(
                {'error': {'code': 'forbidden',
                           'message': 'Invalid sweep secret'}},
                status=403,
            )
        from exams.auto_submit import sweep_expired_attempts

        count = sweep_expired_attempts()
        return Response({'auto_submitted': count})

    def get(self, request):
        # Pingers that only support GET should use POST; fail closed.
        return self.post(request)


class OverviewView(APIView):
    """
    System-wide activity snapshot (SRS.md FR-30, UI_UX_SPEC §4.13).
    Admin only.
    """
    permission_classes = [IsAuthenticated]

    @require_role(User.Role.ADMIN)
    def get(self, request):
        UserModel = get_user_model()
        flagged_attempts = (
            Attempt.objects.filter(proctoring_events__reviewed=False)
            .annotate(unreviewed_count=Count(
                'proctoring_events', filter=Q(proctoring_events__reviewed=False)))
            .select_related('student', 'exam')
            .order_by('-unreviewed_count')[:20]
        )
        return Response({
            'total_exams': Exam.objects.count(),
            'active_attempts': Attempt.objects.filter(
                status=Attempt.Status.IN_PROGRESS).count(),
            'flagged_needing_review': Attempt.objects.filter(
                proctoring_events__reviewed=False).distinct().count(),
            'pending_grading': Attempt.objects.filter(
                answers__question__type='short_answer',
                answers__marks_awarded__isnull=True,
            ).exclude(status=Attempt.Status.VOIDED).distinct().count(),
            'voided_attempts': Attempt.objects.filter(
                status=Attempt.Status.VOIDED).count(),
            'users_by_role': {
                r: UserModel.objects.filter(role=r).count()
                for r in ('student', 'faculty', 'admin')
            },
            'flagged_attempts': [
                {
                    'attempt_id': a.id,
                    'student_username': a.student.username,
                    'exam_id': a.exam_id,
                    'exam_title': a.exam.title,
                    'status': a.status,
                    'unreviewed_count': a.unreviewed_count,
                    'integrity_score': a.integrity_score,
                }
                for a in flagged_attempts
            ],
        })
