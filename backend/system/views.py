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


import logging
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name='dispatch')
class AutoSubmitSweepView(View):
    """Cron sweep without Celery (free-tier production).

    POST /api/system/sweep/auto-submit/ — called every minute by external pinger
    (e.g. cron-job.org).
    - Method: POST only (anything else returns 405 JSON: {"ok": false, "error": "method_not_allowed"}).
    - Auth: Compare X-CRON-SECRET header with settings.CRON_SECRET via hmac.compare_digest.
      Unset/empty CRON_SECRET or invalid/missing secret returns 403 JSON: {"ok": false, "error": "forbidden"}.
    - Response: tiny JSON: {"ok": true, "submitted": N, "remaining": M}.
    - Errors: unexpected exceptions return 500 JSON: {"ok": false, "error": "internal"}.
    """
    http_method_names = ['post']

    def dispatch(self, request, *args, **kwargs):
        if request.method.lower() != 'post':
            response = JsonResponse({"ok": False, "error": "method_not_allowed"}, status=405)
            response['Allow'] = 'POST'
            return response
        return super().dispatch(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        expected = getattr(settings, 'CRON_SECRET', '') or ''
        expected = str(expected).strip()
        if not expected:
            return JsonResponse({"ok": False, "error": "forbidden"}, status=403)

        secret_header = (
            request.META.get('HTTP_X_CRON_SECRET') or
            request.headers.get('X-CRON-SECRET', '')
        )
        secret_header = str(secret_header).strip()

        if not secret_header or not hmac.compare_digest(secret_header, expected):
            return JsonResponse({"ok": False, "error": "forbidden"}, status=403)

        try:
            from exams.auto_submit import sweep_expired_attempts
            result = sweep_expired_attempts(max_batch=200)
            return JsonResponse({
                "ok": True,
                "submitted": result["submitted"],
                "remaining": result["remaining"],
                "auto_submitted": result["submitted"],
            }, status=200)
        except Exception as exc:
            logger.exception("Unexpected error in AutoSubmitSweepView: %s", exc)
            return JsonResponse({"ok": False, "error": "internal"}, status=500)


def api_bad_request_handler(request, exception=None):
    if request.path.startswith('/api/'):
        return JsonResponse({"ok": False, "error": "bad_request"}, status=400)
    from django.views.defaults import bad_request
    return bad_request(request, exception)


def api_permission_denied_handler(request, exception=None):
    if request.path.startswith('/api/'):
        return JsonResponse({"ok": False, "error": "forbidden"}, status=403)
    from django.views.defaults import permission_denied
    return permission_denied(request, exception)


def api_not_found_handler(request, exception=None):
    if request.path.startswith('/api/'):
        return JsonResponse({"ok": False, "error": "not_found"}, status=404)
    from django.views.defaults import page_not_found
    return page_not_found(request, exception)


def api_server_error_handler(request):
    if request.path.startswith('/api/'):
        return JsonResponse({"ok": False, "error": "internal"}, status=500)
    from django.views.defaults import server_error
    return server_error(request)


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
