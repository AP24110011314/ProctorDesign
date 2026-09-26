from rest_framework import serializers
from .models import Attempt, AttemptAnswer, AttemptQuestion, Exam, Question, QuestionOption
from django.utils import timezone


class AttemptQuestionSerializer(serializers.ModelSerializer):
    """
    Serializer for attempt questions with randomized order
    Per-student question view (SRS.md FR-10)
    """
    question_id = serializers.IntegerField(source='question.id', read_only=True)
    question_text = serializers.CharField(source='question.text', read_only=True)
    question_type = serializers.CharField(source='question.type', read_only=True)
    marks = serializers.DecimalField(source='question.marks', max_digits=5, decimal_places=2, read_only=True)

    # Options will be included and shuffled per student
    options = serializers.SerializerMethodField()

    class Meta:
        model = AttemptQuestion
        fields = ['question_id', 'question_text', 'question_type', 'marks', 'order', 'options', 'shuffled_option_order']

    def get_options(self, obj):
        """Return shuffled options for MCQ questions (never expose is_correct to students per NFR-6)"""
        if obj.question.type in ['mcq_single', 'mcq_multi']:
            options = list(obj.question.options.all())

            # Apply shuffled order if available
            if obj.shuffled_option_order:
                options.sort(key=lambda opt: obj.shuffled_option_order.index(opt.id) if opt.id in obj.shuffled_option_order else 999)

            # Never expose is_correct to students
            return [{'id': opt.id, 'text': opt.text} for opt in options]
        return []


class AttemptAnswerSerializer(serializers.ModelSerializer):
    """
    Serializer for student answers (autosave)
    Implements SRS.md FR-16, FR-17
    """
    class Meta:
        model = AttemptAnswer
        fields = [
            'question', 'selected_option_ids', 'text_answer',
            'is_marked_for_review', 'is_visited', 'updated_at'
        ]
        read_only_fields = ['updated_at']


class AttemptSerializer(serializers.ModelSerializer):
    """
    Serializer for exam attempts
    Implements SRS.md FR-13 to FR-19
    """
    exam_title = serializers.CharField(source='exam.title', read_only=True)
    student_username = serializers.CharField(source='student.username', read_only=True)
    remaining_time_seconds = serializers.IntegerField(read_only=True)
    questions = AttemptQuestionSerializer(source='attempt_questions', many=True, read_only=True)
    answers = serializers.SerializerMethodField()

    class Meta:
        model = Attempt
        fields = [
            'id', 'exam', 'exam_title', 'student', 'student_username',
            'started_at', 'end_time', 'submitted_at',
            'status', 'remaining_time_seconds', 'score', 'integrity_score',
            'questions', 'answers'
        ]
        # 'exam' is read-only: re-pointing an attempt at another exam via
        # PUT/PATCH would bypass the start_exam flow (SRS.md FR-4).
        read_only_fields = ['id', 'exam', 'student', 'started_at', 'end_time', 'submitted_at', 'status', 'score', 'integrity_score']

    def to_representation(self, instance):
        """
        Results gate (SRS.md FR-28): students see their score only after
        the faculty publishes results. Faculty/admin always see it.
        Integrity scores are faculty/admin-only and never exposed to
        students (ARCHITECTURE.md §8).
        """
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        is_student = (
            callable(getattr(user, 'is_student', None))
            and user.is_student()
            and not getattr(user, 'is_superuser', False)
        )
        if is_student:
            data.pop('integrity_score', None)
            if not instance.exam.results_published:
                data.pop('score', None)
        return data

    def get_answers(self, obj):
        """Return student's current answers"""
        answers = obj.answers.all()
        return {ans.question_id: AttemptAnswerSerializer(ans).data for ans in answers}


class AttemptResultItemSerializer(serializers.Serializer):
    """
    One graded item in a student's result breakdown (UI_UX_SPEC §4.5).
    Exposes per-question correctness + feedback only. Never exposes the
    correct option ids or the faculty model answer (NFR-6).
    """
    question_id = serializers.IntegerField()
    question_text = serializers.CharField()
    question_type = serializers.CharField()
    selected_options = serializers.ListField(child=serializers.CharField())
    text_answer = serializers.CharField()
    is_correct = serializers.BooleanField(allow_null=True)
    marks_awarded = serializers.DecimalField(max_digits=5, decimal_places=2, allow_null=True)
    max_marks = serializers.DecimalField(max_digits=5, decimal_places=2)
    grading_feedback = serializers.CharField()


class StartExamSerializer(serializers.Serializer):
    """
    Serializer for starting an exam
    """
    exam_id = serializers.IntegerField()

    def validate_exam_id(self, value):
        """Validate exam exists and is published"""
        try:
            exam = Exam.objects.get(id=value)
        except Exam.DoesNotExist:
            raise serializers.ValidationError("Exam not found")

        if not exam.is_published:
            raise serializers.ValidationError("Exam is not published")

        # Check if exam is within time window
        now = timezone.now()
        if now < exam.start_time:
            raise serializers.ValidationError("Exam has not started yet")

        if now > exam.end_time:
            raise serializers.ValidationError("Exam time window has ended")

        return value


class SubmitAnswerSerializer(serializers.Serializer):
    """
    Serializer for autosaving individual answers (SRS.md FR-16)
    """
    question_id = serializers.IntegerField()
    selected_option_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True
    )
    text_answer = serializers.CharField(required=False, allow_blank=True)
    is_marked_for_review = serializers.BooleanField(required=False, default=False)
    is_visited = serializers.BooleanField(required=False, default=False)
