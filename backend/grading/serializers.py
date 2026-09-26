from rest_framework import serializers
from exams.models import AttemptAnswer


class GradingQueueSerializer(serializers.ModelSerializer):
    """One ungraded short answer awaiting faculty review (FR-27)."""
    exam_id = serializers.IntegerField(source='attempt.exam_id', read_only=True)
    exam_title = serializers.CharField(source='attempt.exam.title', read_only=True)
    student_username = serializers.CharField(source='attempt.student.username', read_only=True)
    student_name = serializers.CharField(source='attempt.student.get_full_name', read_only=True)
    question_text = serializers.CharField(source='question.text', read_only=True)
    model_answer = serializers.CharField(source='question.model_answer', read_only=True)
    max_marks = serializers.DecimalField(
        source='attempt.exam.marks_per_question', max_digits=5, decimal_places=2, read_only=True
    )
    submitted_at = serializers.DateTimeField(source='attempt.submitted_at', read_only=True)

    class Meta:
        model = AttemptAnswer
        fields = [
            'id', 'exam_id', 'exam_title', 'student_username', 'student_name',
            'question', 'question_text', 'model_answer', 'text_answer',
            'max_marks', 'submitted_at',
        ]


class GradeActionSerializer(serializers.Serializer):
    """Faculty assigns final marks + optional feedback (FR-27)."""
    marks_awarded = serializers.DecimalField(max_digits=5, decimal_places=2)
    grading_feedback = serializers.CharField(required=False, allow_blank=True, default='')
