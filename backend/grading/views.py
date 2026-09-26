import csv
from decimal import Decimal

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from authentication.models import User
from authentication.permissions import require_role
from exams.models import Attempt, AttemptAnswer, Exam
from .serializers import GradingQueueSerializer, GradeActionSerializer
from .services import recompute_attempt_score, suggest_marks


def _faculty_exam_queryset(user):
    """Exams the user may grade: own courses for faculty, everything for admin."""
    qs = Exam.objects.select_related('course')
    if user.is_superuser or user.is_admin():
        return qs
    return qs.filter(course__faculty=user)


def _ungraded_only_requested(request):
    """
    Parse ?ungraded_only= for the grading queue. Absent defaults to True
    (queue shows work awaiting grading). Accepts '1' and 'true' as true so
    clients sending boolean-style strings get the filtered queue; '0' and
    'false' show all answers including already-graded ones.
    """
    raw = request.query_params.get('ungraded_only', '1')
    return str(raw).lower() not in ('0', 'false', 'no')


class ManualGradingViewSet(viewsets.GenericViewSet):
    """
    Manual grading queue for subjective answers (SRS.md FR-27).
    Routes (mounted under /api/grading/answers/):
      GET  /                      queue, ?exam_id= optional, ?ungraded_only=1 default
      POST /{id}/grade/           assign final marks + feedback
      POST /{id}/suggest/         AI-assist suggestion (flag-gated, never writes)
    """
    permission_classes = [IsAuthenticated]
    serializer_class = GradingQueueSerializer

    def _base_queryset(self):
        """
        All short answers the user may grade: own courses for faculty,
        everything for admin. Voided attempts stay excluded (terminal).
        Deliberately NOT filtered by graded status so the grade/suggest
        detail actions can also correct an already-graded answer.
        """
        user = self.request.user
        return AttemptAnswer.objects.filter(
            question__type='short_answer',
            attempt__exam__in=_faculty_exam_queryset(user),
        # Voided attempts are invalidated: their answers leave the queue.
        ).exclude(attempt__status='voided'
        ).select_related('attempt__exam', 'attempt__student', 'question')

    def _get_gradable_answer(self):
        """Detail lookup for grade/suggest: faculty-scoped, any graded state."""
        from django.http import Http404
        answer = self._base_queryset().filter(pk=self.kwargs['pk']).first()
        if answer is None:
            raise Http404('Answer not found')
        return answer

    def get_queryset(self):
        user = self.request.user
        qs = self._base_queryset()
        if _ungraded_only_requested(self.request):
            qs = qs.filter(marks_awarded__isnull=True)
        exam_id = self.request.query_params.get('exam_id')
        if exam_id:
            qs = qs.filter(attempt__exam_id=exam_id)
        return qs.order_by('attempt__submitted_at', 'id')

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def grade(self, request, pk=None):
        answer = self._get_gradable_answer()
        serializer = GradeActionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        max_marks = Decimal(str(answer.attempt.exam.marks_per_question))
        marks = serializer.validated_data['marks_awarded']
        if marks < 0 or marks > max_marks:
            return Response(
                {'error': {
                    'code': 'marks_out_of_range',
                    'message': f'Marks must be between 0 and {max_marks}',
                }},
                status=status.HTTP_400_BAD_REQUEST,
            )

        answer.marks_awarded = marks
        answer.is_correct = None  # human-graded, not a binary auto verdict
        answer.grading_feedback = serializer.validated_data.get('grading_feedback', '')
        answer.graded_by = request.user
        answer.save(update_fields=['marks_awarded', 'is_correct', 'grading_feedback', 'graded_by'])

        total = recompute_attempt_score(answer.attempt)
        return Response({
            'message': 'Answer graded',
            'marks_awarded': str(marks),
            'attempt_score': str(total) if total is not None else None,
        })

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def suggest(self, request, pk=None):
        """AI-assist suggestion (stretch goal): read-only, flag-gated."""
        answer = self._get_gradable_answer()
        try:
            suggestion = suggest_marks(answer)
        except ValueError as exc:
            return Response(
                {'error': {'code': 'assist_unavailable', 'message': str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(suggestion)


class ResultsViewSet(viewsets.GenericViewSet):
    """
    Result publishing + export (SRS.md FR-28, FR-29).
    Routes (mounted under /api/grading/exams/):
      POST /{exam_id}/publish/     open the results gate for students
      POST /{exam_id}/unpublish/   close it again
      GET  /{exam_id}/export/?format=csv
    """
    permission_classes = [IsAuthenticated]

    def get_object(self):
        exam = _faculty_exam_queryset(self.request.user).filter(pk=self.kwargs['pk']).first()
        if exam is None:
            from django.http import Http404
            raise Http404('Exam not found')
        return exam

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def publish(self, request, pk=None):
        from system.models import AuditLog, log_action
        exam = self.get_object()
        exam.results_published = True
        exam.save(update_fields=['results_published'])
        log_action(request.user, AuditLog.Action.RESULTS_PUBLISH, exam, {})
        return Response({'message': 'Results published; students can now view their scores'})

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def unpublish(self, request, pk=None):
        from system.models import AuditLog, log_action
        exam = self.get_object()
        exam.results_published = False
        exam.save(update_fields=['results_published'])
        log_action(request.user, AuditLog.Action.RESULTS_UNPUBLISH, exam, {})
        return Response({'message': 'Results unpublished; student score access revoked'})

    @action(detail=True, methods=['get'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def export(self, request, pk=None):
        """
        Export of scores + integrity columns (FR-29): ?filetype=csv (default)
        or ?filetype=pdf. Uses ?filetype= (not ?format=): DRF reserves
        ?format= for renderer overrides and 404s unknown values before the
        view runs.
        """
        filetype = request.query_params.get('filetype', 'csv')
        if filetype not in ('csv', 'pdf'):
            return Response(
                {'error': {'code': 'unsupported_format',
                           'message': 'Only filetype=csv or filetype=pdf is supported'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        exam = self.get_object()
        max_total = exam.question_count * exam.marks_per_question

        header = [
            'student_username', 'student_name', 'email', 'attempt_status',
            'score', 'max_marks', 'integrity_score', 'submitted_at',
        ]
        attempts = Attempt.objects.filter(exam=exam).select_related('student').order_by('student__username')
        rows = [
            [
                attempt.student.username,
                attempt.student.get_full_name(),
                attempt.student.email,
                attempt.status,
                str(attempt.score) if attempt.score is not None else '',
                str(max_total),
                str(attempt.integrity_score) if attempt.integrity_score is not None else '',
                attempt.submitted_at.isoformat() if attempt.submitted_at else '',
            ]
            for attempt in attempts
        ]
        stamp = timezone.now().strftime('%Y%m%d')
        if filetype == 'pdf':
            return self._export_pdf(exam, header, rows, stamp)
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = (
            f'attachment; filename="exam_{exam.id}_results_{stamp}.csv"'
        )
        writer = csv.writer(response)
        writer.writerow(header)
        writer.writerows(rows)
        return response

    @staticmethod
    def _export_pdf(exam, header, rows, stamp):
        """Render the same report columns as a landscape PDF (reportlab)."""
        import io
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4))
        styles = getSampleStyleSheet()
        small = styles['Normal']
        small.fontSize = 7
        small.leading = 9
        table_data = [
            [Paragraph(col, small) for col in header],
            *[[Paragraph(cell or '—', small) for cell in row] for row in rows],
        ]
        table = Table(table_data, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        title = Paragraph(f'{exam.title} — results & integrity report', styles['Heading2'])
        doc.build([title, table])
        response = HttpResponse(buf.getvalue(), content_type='application/pdf')
        response['Content-Disposition'] = (
            f'attachment; filename="exam_{exam.id}_results_{stamp}.pdf"'
        )
        return response
