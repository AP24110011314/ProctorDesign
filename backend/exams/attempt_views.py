import random
from rest_framework import parsers, viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db import transaction
from authentication.permissions import require_role
from authentication.models import User
from .models import Exam, Attempt, AttemptAnswer, AttemptQuestion, ExamQuestion
from proctoring.views import EventReportThrottle
from .attempt_serializers import (
    AttemptSerializer, StartExamSerializer,
    SubmitAnswerSerializer, AttemptAnswerSerializer,
    AttemptResultItemSerializer,
)


def generate_randomized_questions(student_id, exam):
    """
    Generate deterministic randomized question set per student
    Implements SRS.md FR-10: deterministic randomization per (student_id, exam_id)

    Draws exactly exam.question_count questions from the linked pool (or the
    whole pool if it is smaller). Determinism comes from seeding one RNG per
    (student_id, exam_id) and shuffling before slicing, so the same student
    always gets the same head of the shuffled pool. Note: hash() of an
    int-tuple is stable across processes on a fixed deployment (verified),
    matching the ARCHITECTURE.md §3.2 recipe.
    """
    # Use (student_id, exam_id) as seed for deterministic randomization
    seed = hash((student_id, exam.id))
    rng = random.Random(seed)

    # Get all questions linked to this exam
    exam_questions = list(exam.exam_questions.select_related('question').all())

    # Shuffle if enabled
    if exam.shuffle_questions:
        rng.shuffle(exam_questions)

    # Draw the configured number of questions (FR-9/FR-10)
    selected_questions = exam_questions[:exam.question_count]

    randomized_questions = []
    for idx, eq in enumerate(selected_questions):
        question = eq.question

        # Shuffle options for MCQ if enabled
        shuffled_option_order = []
        if exam.shuffle_options and question.type in ['mcq_single', 'mcq_multi']:
            options = list(question.options.all().values_list('id', flat=True))
            rng.shuffle(options)
            shuffled_option_order = options

        randomized_questions.append({
            'question': question,
            'order': idx,
            'shuffled_option_order': shuffled_option_order
        })

    return randomized_questions


class AttemptViewSet(viewsets.ModelViewSet):
    """
    Exam attempt viewset
    Implements SRS.md FR-13 to FR-19
    """
    serializer_class = AttemptSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Students see only their own attempts; optional ?exam_id= filter for all roles."""
        user = self.request.user
        if user.is_student():
            qs = Attempt.objects.filter(student=user).select_related('exam')
        elif user.is_faculty() or user.is_admin():
            # Faculty/Admin see all attempts (for monitoring, Phase 5)
            qs = Attempt.objects.all().select_related('exam', 'student')
        else:
            return Attempt.objects.none()
        exam_id = self.request.query_params.get('exam_id')
        if exam_id:
            qs = qs.filter(exam_id=exam_id)
        return qs

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        """
        Students must mutate attempts only via save_answer/submit actions.
        Direct PUT is faculty/admin only (prevents status/score tampering).
        """
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        """Same guard as update: PATCH routes here, not to update."""
        return super().partial_update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def destroy(self, request, *args, **kwargs):
        """
        Students cannot delete attempts (would allow deleting an
        in-progress attempt and re-starting for an illicit retake).
        """
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'])
    @require_role(User.Role.STUDENT)
    def start_exam(self, request):
        """
        Start a new exam attempt (SRS.md FR-13, FR-14)
        POST /api/attempts/start_exam/
        Body: {"exam_id": 1}

        Creates attempt with server-computed end_time (NFR-14: server-authoritative timer)
        """
        serializer = StartExamSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        exam_id = serializer.validated_data['exam_id']
        exam = Exam.objects.get(id=exam_id)
        student = request.user

        # Check if student already has an attempt for this exam
        existing_attempt = Attempt.objects.filter(exam=exam, student=student).first()
        if existing_attempt:
            if existing_attempt.status == Attempt.Status.IN_PROGRESS:
                # Return existing in-progress attempt
                return Response(
                    AttemptSerializer(existing_attempt, context={'request': request}).data,
                    status=status.HTTP_200_OK
                )
            else:
                return Response(
                    {'error': 'You have already completed this exam'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Create new attempt with server-computed end_time
        with transaction.atomic():
            attempt = Attempt.objects.create(
                exam=exam,
                student=student,
                started_at=timezone.now()
                # end_time is auto-computed in model save() method
            )

            # Generate and store randomized questions for this student
            randomized_questions = generate_randomized_questions(student.id, exam)

            for rq in randomized_questions:
                AttemptQuestion.objects.create(
                    attempt=attempt,
                    question=rq['question'],
                    order=rq['order'],
                    shuffled_option_order=rq['shuffled_option_order']
                )

                # Create empty answer placeholder
                AttemptAnswer.objects.create(
                    attempt=attempt,
                    question=rq['question']
                )

        return Response(
            AttemptSerializer(attempt, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'])
    @require_role(User.Role.STUDENT)
    def save_answer(self, request, pk=None):
        """
        Autosave answer for a question (SRS.md FR-16)
        POST /api/attempts/{attempt_id}/save_answer/
        Body: {
            "question_id": 1,
            "selected_option_ids": [2, 3],  // for MCQ
            "text_answer": "...",           // for short answer
            "is_marked_for_review": false,
            "is_visited": true
        }
        """
        attempt = self.get_object()

        # Verify attempt belongs to current student
        if attempt.student != request.user:
            return Response(
                {'error': 'Unauthorized'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Check if attempt is still in progress
        if attempt.status != Attempt.Status.IN_PROGRESS:
            return Response(
                {'error': 'Attempt is not in progress'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if time has expired (server-side check)
        if attempt.is_expired:
            # Auto-submit if expired
            self._auto_submit_attempt(attempt)
            return Response(
                {'error': 'Time expired', 'auto_submitted': True},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = SubmitAnswerSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        question_id = serializer.validated_data['question_id']

        # Update or create answer
        answer, created = AttemptAnswer.objects.update_or_create(
            attempt=attempt,
            question_id=question_id,
            defaults={
                'selected_option_ids': serializer.validated_data.get('selected_option_ids', []),
                'text_answer': serializer.validated_data.get('text_answer', ''),
                'is_marked_for_review': serializer.validated_data.get('is_marked_for_review', False),
                'is_visited': serializer.validated_data.get('is_visited', True),
            }
        )

        return Response(
            {'message': 'Answer saved', 'updated_at': answer.updated_at},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    @require_role(User.Role.STUDENT)
    def check_time(self, request, pk=None):
        """
        Check remaining time (server-authoritative, SRS.md NFR-14)
        GET /api/attempts/{attempt_id}/check_time/
        """
        attempt = self.get_object()

        if attempt.student != request.user:
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

        if attempt.is_expired and attempt.status == Attempt.Status.IN_PROGRESS:
            # Auto-submit if expired
            self._auto_submit_attempt(attempt)
            return Response({
                'remaining_seconds': 0,
                'expired': True,
                'auto_submitted': True
            })

        return Response({
            'remaining_seconds': attempt.remaining_time_seconds,
            'expired': attempt.is_expired,
            'server_time': timezone.now().isoformat()
        })

    @action(detail=True, methods=['post'])
    @require_role(User.Role.STUDENT)
    def submit(self, request, pk=None):
        """
        Submit exam attempt (SRS.md FR-18)
        POST /api/attempts/{attempt_id}/submit/
        """
        attempt = self.get_object()

        if attempt.student != request.user:
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

        if not attempt.can_submit():
            return Response(
                {'error': 'Attempt cannot be submitted'},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            attempt.status = Attempt.Status.SUBMITTED
            attempt.submitted_at = timezone.now()
            attempt.save()

            # Auto-grade objective questions synchronously (SRS.md FR-26)
            from grading.services import grade_attempt
            grade_attempt(attempt)

        return Response(
            {'message': 'Exam submitted successfully'},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    @require_role(User.Role.STUDENT)
    def result(self, request, pk=None):
        """
        Published result breakdown for the owning student (UI_UX_SPEC §4.5,
        SRS.md FR-28). Unpublished or unsubmitted attempts get a neutral
        403 without revealing scores. Never exposes correct option ids or
        the faculty model answer (NFR-6).
        GET /api/attempts/{attempt_id}/result/
        """
        attempt = self.get_object()

        if attempt.student != request.user:
            return Response(
                {'error': {'code': 'forbidden', 'message': 'Not your attempt'}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if attempt.status not in (Attempt.Status.SUBMITTED, Attempt.Status.AUTO_SUBMITTED):
            return Response(
                {'error': {'code': 'not_submitted', 'message': 'Result is not available yet'}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not attempt.exam.results_published:
            return Response(
                {'error': {'code': 'not_published', 'message': 'Result is not published yet'}},
                status=status.HTTP_403_FORBIDDEN,
            )

        answers = list(attempt.answers.select_related('question').order_by('question_id'))
        # Build the option-text map from the answered questions themselves, not
        # from AttemptQuestion rows (those may be absent for legacy attempts).
        from .models import QuestionOption
        option_text_by_id = dict(
            QuestionOption.objects.filter(
                question_id__in=[a.question_id for a in answers]
            ).values_list('id', 'text')
        )

        items = []
        for ans in answers:
            items.append({
                'question_id': ans.question_id,
                'question_text': ans.question.text,
                'question_type': ans.question.type,
                'selected_options': [
                    option_text_by_id.get(oid, '') for oid in (ans.selected_option_ids or [])
                ],
                'text_answer': ans.text_answer or '',
                'is_correct': ans.is_correct,
                'marks_awarded': ans.marks_awarded,
                'max_marks': attempt.exam.marks_per_question,
                'grading_feedback': ans.grading_feedback or '',
            })
        serializer = AttemptResultItemSerializer(items, many=True)
        return Response({
            'attempt_id': attempt.id,
            'exam_id': attempt.exam_id,
            'exam_title': attempt.exam.title,
            'score': attempt.score,
            'max_score': float(attempt.exam.marks_per_question) * attempt.exam.question_count,
            'submitted_at': attempt.submitted_at,
            'items': serializer.data,
        })

    @action(detail=True, methods=['post'],
             parser_classes=[parsers.JSONParser, parsers.MultiPartParser],
             throttle_classes=[EventReportThrottle])
    @require_role(User.Role.STUDENT)
    def events(self, request, pk=None):
        """
        Report one proctoring flag (SRS.md FR-20–FR-23, ARCHITECTURE.md §3.3).
        POST /api/attempts/{attempt_id}/events/

        Own in-progress attempt only, and only when the exam's proctoring
        mode is not 'off'. Severity is server-computed from the event type —
        any client-sent severity is ignored. Optional ``evidence`` is a
        compressed still thumbnail (NFR-10: never video).
        Accepts JSON or multipart (for the thumbnail file).
        """
        from proctoring.models import ProctoringEvent
        from proctoring.services import (
            SEVERITY_BY_TYPE, refresh_attempt_integrity, validate_evidence,
        )

        attempt = self.get_object()
        if attempt.student != request.user:
            return Response(
                {'error': {'code': 'forbidden', 'message': 'Not your attempt'}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if attempt.status != Attempt.Status.IN_PROGRESS:
            return Response(
                {'error': {'code': 'not_in_progress',
                           'message': 'Flags are only accepted on an active attempt'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if attempt.exam.proctoring_mode == Exam.ProctoringMode.OFF:
            return Response(
                {'error': {'code': 'proctoring_off',
                           'message': 'Proctoring is disabled for this exam'}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event_type = request.data.get('type')
        valid_types = set(ProctoringEvent.EventType.values)
        if event_type not in valid_types:
            return Response(
                {'error': {'code': 'invalid_type',
                           'message': f'type must be one of {sorted(valid_types)}'}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        evidence = request.FILES.get('evidence')
        if evidence is not None:
            error = validate_evidence(evidence)
            if error:
                return Response(
                    {'error': {'code': 'invalid_evidence', 'message': error}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        metadata = {}
        client_timestamp = request.data.get('client_timestamp')
        if client_timestamp:
            metadata['client_timestamp'] = str(client_timestamp)
        details = request.data.get('details')
        if isinstance(details, dict):
            metadata['details'] = details

        event = ProctoringEvent.objects.create(
            attempt=attempt,
            type=event_type,
            severity=SEVERITY_BY_TYPE[event_type],
            evidence=evidence,
            metadata=metadata,
        )
        integrity = refresh_attempt_integrity(attempt)
        return Response(
            {'id': event.id, 'type': event.type, 'severity': event.severity,
             'integrity_score': str(integrity)},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], parser_classes=[parsers.MultiPartParser])
    @require_role(User.Role.STUDENT)
    def reference_photo(self, request, pk=None):
        """
        Capture the one-time reference still at exam start (SRS.md FR-14).
        POST /api/attempts/{attempt_id}/reference-photo/ (multipart, ``photo``).
        Still image only, size-bounded like flag thumbnails.
        """
        from proctoring.services import validate_evidence

        attempt = self.get_object()
        if attempt.student != request.user:
            return Response(
                {'error': {'code': 'forbidden', 'message': 'Not your attempt'}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if attempt.status != Attempt.Status.IN_PROGRESS:
            return Response(
                {'error': {'code': 'not_in_progress',
                           'message': 'Reference photo is captured at exam start'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        photo = request.FILES.get('photo')
        if photo is None:
            return Response(
                {'error': {'code': 'missing_photo',
                           'message': 'Multipart field "photo" is required'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        error = validate_evidence(photo)
        if error:
            return Response(
                {'error': {'code': 'invalid_photo', 'message': error}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        attempt.reference_photo = photo
        attempt.save(update_fields=['reference_photo'])
        return Response({'message': 'Reference photo saved'})

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def void(self, request, pk=None):
        """
        Invalidate an attempt, e.g. confirmed cheating (SRS.md FR-31,
        UI_UX_SPEC §4.11). A non-empty ``reason`` is mandatory and is written
        to the audit log. Faculty may void attempts in their own courses only
        (NFR-7); admins may void any attempt. Voiding is terminal: a voided
        attempt can no longer submit, be graded, or show results.
        POST /api/attempts/{attempt_id}/void/  {"reason": "..."}
        """
        from system.models import AuditLog, log_action

        attempt = self.get_object()
        user = request.user
        if user.is_faculty() and not user.is_superuser:
            if attempt.exam.course.faculty_id != user.id:
                return Response(
                    {'error': {'code': 'forbidden',
                               'message': 'Not your course'}},
                    status=status.HTTP_403_FORBIDDEN,
                )
        if attempt.status == Attempt.Status.VOIDED:
            return Response(
                {'error': {'code': 'already_voided',
                           'message': 'Attempt is already voided'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response(
                {'error': {'code': 'reason_required',
                           'message': 'A reason is mandatory when voiding an attempt'}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        attempt.status = Attempt.Status.VOIDED
        attempt.void_reason = reason
        attempt.voided_by = user
        attempt.voided_at = timezone.now()
        attempt.save(update_fields=['status', 'void_reason', 'voided_by', 'voided_at'])
        log_action(user, AuditLog.Action.ATTEMPT_VOID, attempt, {'reason': reason})
        return Response({
            'attempt_id': attempt.id,
            'status': attempt.status,
            'void_reason': attempt.void_reason,
        })

    def _auto_submit_attempt(self, attempt):
        """Helper to auto-submit expired attempt (graded like a manual submit)"""
        attempt.status = Attempt.Status.AUTO_SUBMITTED
        attempt.submitted_at = timezone.now()
        attempt.save()
        from grading.services import grade_attempt
        grade_attempt(attempt)
