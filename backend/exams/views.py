from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q
from authentication.permissions import require_role
from authentication.models import User
from .models import Course, Question, QuestionOption, Exam, ExamQuestion, Attempt
from .serializers import (
    CourseSerializer, QuestionSerializer, ExamSerializer,
    ExamListSerializer, ExamQuestionSerializer
)


class CourseViewSet(viewsets.ModelViewSet):
    """
    Course CRUD viewset
    Faculty can manage their own courses
    """
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Filter courses based on user role"""
        user = self.request.user
        if user.is_admin() or user.is_superuser:
            return Course.objects.all()
        elif user.is_faculty():
            return Course.objects.filter(faculty=user)
        else:
            # Students see all courses (for exam enrollment context)
            return Course.objects.all()

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def create(self, request, *args, **kwargs):
        """Only faculty/admin can create courses"""
        return super().create(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        """Only faculty/admin can update courses (SRS.md FR-4)"""
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        """Only faculty/admin can partially update courses (SRS.md FR-4)"""
        return super().partial_update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def destroy(self, request, *args, **kwargs):
        """Only faculty/admin can delete courses (SRS.md FR-4)"""
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Auto-assign current faculty user"""
        if self.request.user.is_faculty():
            serializer.save(faculty=self.request.user)
        else:
            serializer.save()


class QuestionViewSet(viewsets.ModelViewSet):
    """
    Question bank CRUD viewset
    Implements SRS.md FR-6, FR-7, FR-8
    """
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """
        Filter questions by course, type, difficulty, topic
        Faculty see their course questions; students never see question bank directly
        """
        user = self.request.user
        queryset = Question.objects.select_related('course', 'created_by').prefetch_related('options')

        # Students should not access the question bank API directly
        if user.is_student():
            return queryset.none()

        # Faculty see questions from their courses
        if user.is_faculty() and not user.is_superuser:
            queryset = queryset.filter(course__faculty=user)

        # Apply filters
        course_id = self.request.query_params.get('course')
        if course_id:
            queryset = queryset.filter(course_id=course_id)

        question_type = self.request.query_params.get('type')
        if question_type:
            queryset = queryset.filter(type=question_type)

        difficulty = self.request.query_params.get('difficulty')
        if difficulty:
            queryset = queryset.filter(difficulty=difficulty)

        topic = self.request.query_params.get('topic')
        if topic:
            queryset = queryset.filter(topic__icontains=topic)

        return queryset

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def create(self, request, *args, **kwargs):
        """Only faculty/admin can create questions (SRS.md FR-6)"""
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Auto-assign created_by"""
        serializer.save(created_by=self.request.user)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        """Only faculty/admin can update questions"""
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        """Only faculty/admin can partially update questions (PATCH routes here, not update)"""
        return super().partial_update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def destroy(self, request, *args, **kwargs):
        """Only faculty/admin can delete questions"""
        return super().destroy(request, *args, **kwargs)


class ExamViewSet(viewsets.ModelViewSet):
    """
    Exam CRUD viewset
    Implements SRS.md FR-9 to FR-12
    """
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        """
        Use lightweight serializer for list view.
        Students also get the lightweight serializer on retrieve: question
        texts must only reach students via their attempt payload (NFR-6),
        never via the exam detail endpoint.
        """
        if self.action == 'list':
            return ExamListSerializer
        user = getattr(self.request, 'user', None)
        if self.action == 'retrieve' and user is not None and callable(getattr(user, 'is_student', None)) and user.is_student():
            return ExamListSerializer
        return ExamSerializer

    def get_queryset(self):
        """
        Faculty see their course exams
        Students see only published exams in the time window
        """
        user = self.request.user
        queryset = Exam.objects.select_related('course', 'created_by')

        if user.is_student():
            # Students see only published exams (SRS.md FR-12)
            queryset = queryset.filter(is_published=True)
        elif user.is_faculty() and not user.is_superuser:
            # Faculty see exams from their courses
            queryset = queryset.filter(course__faculty=user)

        # Filter by course
        course_id = self.request.query_params.get('course')
        if course_id:
            queryset = queryset.filter(course_id=course_id)

        return queryset

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def create(self, request, *args, **kwargs):
        """Only faculty/admin can create exams (SRS.md FR-9)"""
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Auto-assign created_by"""
        serializer.save(created_by=self.request.user)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        """Only faculty/admin can update exams"""
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        """Only faculty/admin can partially update exams (PATCH routes here, not update)"""
        return super().partial_update(request, *args, **kwargs)

    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def destroy(self, request, *args, **kwargs):
        """Only faculty/admin can delete exams"""
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def publish(self, request, pk=None):
        """
        Publish exam (SRS.md FR-12)
        POST /api/exams/{id}/publish/
        """
        exam = self.get_object()
        exam.is_published = True
        exam.save()
        return Response({'message': 'Exam published successfully'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def unpublish(self, request, pk=None):
        """
        Unpublish exam (SRS.md FR-12)
        POST /api/exams/{id}/unpublish/
        """
        exam = self.get_object()
        exam.is_published = False
        exam.save()
        return Response({'message': 'Exam unpublished successfully'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def add_questions(self, request, pk=None):
        """
        Add questions to exam
        POST /api/exams/{id}/add_questions/
        Body: {"question_ids": [1, 2, 3]}
        """
        exam = self.get_object()
        question_ids = request.data.get('question_ids', [])

        if not question_ids:
            return Response(
                {'error': 'question_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get the current max order
        max_order = exam.exam_questions.count()

        # Add questions
        for idx, question_id in enumerate(question_ids):
            try:
                question = Question.objects.get(id=question_id)
                ExamQuestion.objects.get_or_create(
                    exam=exam,
                    question=question,
                    defaults={'order': max_order + idx}
                )
            except Question.DoesNotExist:
                pass

        return Response(
            {'message': f'{len(question_ids)} questions added to exam'},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def preview(self, request, pk=None):
        """
        Preview exam as "dummy student" (SRS.md FR-11)
        GET /api/exams/{id}/preview/
        """
        exam = self.get_object()
        serializer = self.get_serializer(exam)
        return Response({
            'message': 'Preview mode',
            'exam': serializer.data
        })

    @action(detail=True, methods=['get'])
    @require_role(User.Role.FACULTY, User.Role.ADMIN)
    def monitor(self, request, pk=None):
        """
        Live-monitoring snapshot for an ongoing exam (SRS.md FR-25,
        UI_UX_SPEC §4.9). Short-poll friendly: in-progress attempts sorted by
        flag count descending, each with its latest events. A WebSocket feed
        is a documented future upgrade; polling this endpoint is the MVP.

        get_object() inherits the faculty-own-courses scoping (NFR-7).
        Integrity scores are faculty/admin-only — never exposed to students.
        GET /api/exams/{id}/monitor/
        """
        from django.db.models import Count, Q
        from proctoring.models import ProctoringEvent
        from proctoring.serializers import ProctoringEventSerializer

        exam = self.get_object()
        active = (
            exam.attempts.filter(status=Attempt.Status.IN_PROGRESS)
            .select_related('student')
            .annotate(
                flag_count=Count('proctoring_events'),
                unreviewed_count=Count(
                    'proctoring_events',
                    filter=Q(proctoring_events__reviewed=False),
                ),
            )
            .order_by('-flag_count', 'started_at')
        )
        recent_events = (
            ProctoringEvent.objects.filter(attempt__exam=exam)
            .select_related('attempt__student')
            .order_by('-timestamp')[:50]
        )
        return Response({
            'exam_id': exam.id,
            'exam_title': exam.title,
            'proctoring_mode': exam.proctoring_mode,
            'active_attempts': [
                {
                    'attempt_id': a.id,
                    'student_username': a.student.username,
                    'started_at': a.started_at,
                    'flag_count': a.flag_count,
                    'unreviewed_count': a.unreviewed_count,
                    'integrity_score': a.integrity_score,
                }
                for a in active
            ],
            'recent_events': ProctoringEventSerializer(recent_events, many=True).data,
        })
