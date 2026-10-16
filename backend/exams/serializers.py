from datetime import datetime as dt_datetime
import re

from django.utils import timezone as dj_timezone
from rest_framework import serializers
from .models import Course, Question, QuestionOption, Exam, ExamQuestion


# Matches an explicit offset designator at the end of an ISO 8601 string:
# "Z" or "+05:30" / "-0430".
OFFSET_RE = re.compile(r'(Z|[+-]\d{2}:?\d{2})$', re.IGNORECASE)


class OffsetAwareDateTimeField(serializers.DateTimeField):
    """
    DateTimeField that rejects timezone-naive input.

    DRF would otherwise silently assume UTC for a bare wall-clock
    (TIME_ZONE='UTC'), shifting an IST schedule by +5:30 at write time.
    Exam times must arrive as absolute instants with an explicit offset.
    """
    default_error_messages = {
        'naive': 'Must include a timezone offset (e.g. +05:30 for IST).',
    }

    def to_internal_value(self, value):
        if isinstance(value, str) and not OFFSET_RE.search(value.strip()):
            self.fail('naive')
        result = super().to_internal_value(value)
        if isinstance(result, dt_datetime) and dj_timezone.is_naive(result):
            self.fail('naive')
        return result


class CourseSerializer(serializers.ModelSerializer):
    """Basic course serializer"""
    faculty_name = serializers.CharField(source='faculty.get_full_name', read_only=True)

    class Meta:
        model = Course
        fields = ['id', 'code', 'name', 'description', 'faculty', 'faculty_name', 'created_at']
        read_only_fields = ['id', 'created_at']


class QuestionOptionSerializer(serializers.ModelSerializer):
    """
    Serializer for question options
    Per SRS.md NFR-6: Never expose is_correct to student-facing API payloads
    """
    class Meta:
        model = QuestionOption
        fields = ['id', 'text', 'is_correct', 'order']

    def to_representation(self, instance):
        """Hide is_correct from students (checked in view layer)"""
        data = super().to_representation(instance)
        request = self.context.get('request')

        # Only show is_correct to faculty/admin, never to students
        if request and hasattr(request, 'user'):
            user = request.user
            if not user.is_authenticated or user.role == 'student':
                data.pop('is_correct', None)

        return data


class QuestionSerializer(serializers.ModelSerializer):
    """
    Question serializer with options
    Implements SRS.md FR-6, FR-7, FR-8
    """
    options = QuestionOptionSerializer(many=True, required=False)
    course_name = serializers.CharField(source='course.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)

    class Meta:
        model = Question
        fields = [
            'id', 'course', 'course_name', 'type', 'text', 'difficulty',
            'topic', 'marks', 'model_answer', 'options', 'created_by',
            'created_by_name', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def create(self, validated_data):
        """Create question with options"""
        options_data = validated_data.pop('options', [])
        question = Question.objects.create(**validated_data)

        # Create options if MCQ
        for option_data in options_data:
            QuestionOption.objects.create(question=question, **option_data)

        return question

    def update(self, instance, validated_data):
        """Update question and replace options"""
        options_data = validated_data.pop('options', None)

        # Update question fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Replace options if provided
        if options_data is not None:
            instance.options.all().delete()
            for option_data in options_data:
                QuestionOption.objects.create(question=instance, **option_data)

        return instance

    def _validate_active_course(self, data):
        course = data.get('course')
        if course is None and self.instance is not None and 'course' not in data:
            return
        target = course if course is not None else getattr(self.instance, 'course', None)
        if target is not None and not target.is_active:
            raise serializers.ValidationError(
                {'course': 'This course is deactivated and cannot accept new questions.'}
            )

    def validate(self, data):
        """Validate that MCQ questions have options with at least one correct answer"""
        self._validate_active_course(data)
        question_type = data.get('type', self.instance.type if self.instance else None)
        options = data.get('options', [])

        if question_type in ['mcq_single', 'mcq_multi']:
            if not options:
                raise serializers.ValidationError("MCQ questions must have options")

            if len(options) < 2:
                raise serializers.ValidationError("MCQ questions must have at least 2 options")

            correct_count = sum(1 for opt in options if opt.get('is_correct', False))

            if correct_count == 0:
                raise serializers.ValidationError("At least one option must be marked as correct")

            if question_type == 'mcq_single' and correct_count > 1:
                raise serializers.ValidationError("Single correct MCQ must have exactly one correct option")

        return data


class ExamQuestionSerializer(serializers.ModelSerializer):
    """Serializer for exam-question junction"""
    question_text = serializers.CharField(source='question.text', read_only=True)
    question_type = serializers.CharField(source='question.type', read_only=True)

    class Meta:
        model = ExamQuestion
        fields = ['id', 'question', 'question_text', 'question_type', 'order']


class ExamSerializer(serializers.ModelSerializer):
    """
    Exam configuration serializer
    Implements SRS.md FR-9 to FR-12
    """
    course_name = serializers.CharField(source='course.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    exam_questions = ExamQuestionSerializer(many=True, read_only=True)
    total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    # Timezone contract (see OffsetAwareDateTimeField): naive wall-clocks
    # are rejected here instead of being silently stored as UTC.
    start_time = OffsetAwareDateTimeField()
    end_time = OffsetAwareDateTimeField()

    class Meta:
        model = Exam
        fields = [
            'id', 'course', 'course_name', 'title',
            'start_time', 'end_time', 'duration_minutes',
            'question_count', 'marks_per_question', 'total_marks',
            'negative_marking', 'negative_marks_value',
            'shuffle_questions', 'shuffle_options',
            'proctoring_mode', 'is_published', 'results_published',
            'exam_questions', 'created_by', 'created_by_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at', 'total_marks']

    def validate(self, data):
        """Validate exam configuration"""
        course = data.get('course')
        if course is None and self.instance is not None and 'course' not in data:
            pass
        else:
            target = course if course is not None else getattr(self.instance, 'course', None)
            if target is not None and not target.is_active:
                raise serializers.ValidationError(
                    {'course': 'This course is deactivated and cannot accept new exams.'}
                )

        start_time = data.get('start_time')
        end_time = data.get('end_time')

        if start_time and end_time and start_time >= end_time:
            raise serializers.ValidationError("End time must be after start time")

        if data.get('negative_marking') and data.get('negative_marks_value', 0) <= 0:
            raise serializers.ValidationError("Negative marks value must be greater than 0 when negative marking is enabled")

        return data


class ExamListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for exam lists"""
    course_name = serializers.CharField(source='course.name', read_only=True)
    total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)

    class Meta:
        model = Exam
        fields = [
            'id', 'course_name', 'title', 'start_time', 'end_time',
            'duration_minutes', 'total_marks', 'is_published',
            'results_published', 'proctoring_mode'
        ]
