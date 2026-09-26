from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone


class Course(models.Model):
    """
    Course model - organizes questions and exams by course
    Per ARCHITECTURE.md §5
    """
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    faculty = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='courses',
        limit_choices_to={'role': 'faculty'}
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'courses'
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.name}"


class Question(models.Model):
    """
    Question model supporting MCQ and short answer types
    Implements SRS.md FR-6, FR-7, FR-8
    """

    class QuestionType(models.TextChoices):
        MCQ_SINGLE = 'mcq_single', 'Single Correct MCQ'
        MCQ_MULTI = 'mcq_multi', 'Multi Correct MCQ'
        SHORT_ANSWER = 'short_answer', 'Short Answer'

    class Difficulty(models.TextChoices):
        EASY = 'easy', 'Easy'
        MEDIUM = 'medium', 'Medium'
        HARD = 'hard', 'Hard'

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='questions')
    type = models.CharField(max_length=20, choices=QuestionType.choices)
    text = models.TextField(help_text="Question text")
    model_answer = models.TextField(
        blank=True,
        default='',
        help_text="Reference answer for short-answer questions: shown to graders and used only for AI-assist suggestions (never auto-applied)"
    )
    difficulty = models.CharField(max_length=10, choices=Difficulty.choices, default=Difficulty.MEDIUM)
    topic = models.CharField(max_length=200, blank=True, help_text="Topic/tag for filtering")
    marks = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=1.0,
        validators=[MinValueValidator(0.0)]
    )

    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_questions'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'questions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['course', 'type']),
            models.Index(fields=['difficulty']),
            models.Index(fields=['topic']),
        ]

    def __str__(self):
        return f"[{self.type}] {self.text[:50]}..."


class QuestionOption(models.Model):
    """
    Options for MCQ questions
    Implements SRS.md FR-8: stores options in a way that supports per-student randomization
    """
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='options')
    text = models.TextField()
    is_correct = models.BooleanField(default=False)
    order = models.IntegerField(default=0, help_text="Default display order (will be randomized per student)")

    class Meta:
        db_table = 'question_options'
        ordering = ['order']
        indexes = [
            models.Index(fields=['question', 'order']),
        ]

    def __str__(self):
        return f"{self.text[:30]}... ({'Correct' if self.is_correct else 'Incorrect'})"


class Exam(models.Model):
    """
    Exam configuration model
    Implements SRS.md FR-9 to FR-12
    """

    class ProctoringMode(models.TextChoices):
        OFF = 'off', 'Off'
        BASIC = 'basic', 'Basic'
        STRICT = 'strict', 'Strict'

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='exams')
    title = models.CharField(max_length=200)

    # Time configuration
    start_time = models.DateTimeField(help_text="When students can start taking the exam")
    end_time = models.DateTimeField(help_text="Last time a student can start the exam")
    duration_minutes = models.IntegerField(
        validators=[MinValueValidator(1)],
        help_text="How long students have to complete the exam once started"
    )

    # Question configuration
    question_count = models.IntegerField(
        validators=[MinValueValidator(1)],
        help_text="Number of questions to draw from the bank per student"
    )
    marks_per_question = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=1.0,
        validators=[MinValueValidator(0.0)]
    )

    # Scoring
    negative_marking = models.BooleanField(default=False)
    negative_marks_value = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0.0,
        validators=[MinValueValidator(0.0)],
        help_text="Marks deducted for wrong answers (if negative_marking is enabled)"
    )

    # Randomization
    shuffle_questions = models.BooleanField(default=True, help_text="Randomize question order per student")
    shuffle_options = models.BooleanField(default=True, help_text="Randomize option order per student")

    # Proctoring
    proctoring_mode = models.CharField(
        max_length=10,
        choices=ProctoringMode.choices,
        default=ProctoringMode.BASIC
    )

    # Publishing
    is_published = models.BooleanField(
        default=False,
        help_text="Students can only see/join published exams (SRS.md FR-12)"
    )
    results_published = models.BooleanField(
        default=False,
        help_text="Students can only view results after this is set (SRS.md FR-28)"
    )

    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_exams'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'exams'
        ordering = ['-start_time']
        indexes = [
            models.Index(fields=['course', 'is_published']),
            models.Index(fields=['start_time', 'end_time']),
        ]

    def __str__(self):
        return f"{self.title} ({self.course.code})"

    @property
    def total_marks(self):
        """Calculate total marks for the exam"""
        return self.question_count * self.marks_per_question


class ExamQuestion(models.Model):
    """
    Junction table linking exams to specific questions
    Allows exam-specific configuration per question
    Per ARCHITECTURE.md §5
    """
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='exam_questions')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='exam_questions')
    order = models.IntegerField(default=0, help_text="Order in the question pool (before per-student randomization)")

    class Meta:
        db_table = 'exam_questions'
        unique_together = ['exam', 'question']
        ordering = ['order']

    def __str__(self):
        return f"{self.exam.title} - Q{self.order}"


# Attempt models (Phase 3)

class Attempt(models.Model):
    """
    Student exam attempt model
    Implements SRS.md FR-13 to FR-19
    """

    class Status(models.TextChoices):
        IN_PROGRESS = 'in_progress', 'In Progress'
        SUBMITTED = 'submitted', 'Submitted'
        AUTO_SUBMITTED = 'auto_submitted', 'Auto Submitted'
        VOIDED = 'voided', 'Voided'

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='attempts')
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='attempts',
        limit_choices_to={'role': 'student'}
    )

    # Timing (server-authoritative per SRS.md NFR-14)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(
        help_text="Server-computed end time = started_at + exam.duration_minutes (source of truth)"
    )

    # Status
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.IN_PROGRESS
    )

    # Scoring (computed after submission)
    score = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Total score after grading"
    )

    integrity_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Proctoring integrity score (Phase 5)"
    )

    # Invalidation by admin/faculty with mandatory reason (SRS.md FR-31).
    # Voided attempts can no longer submit (can_submit requires IN_PROGRESS)
    # and are excluded from grading queues and student results.
    void_reason = models.TextField(blank=True, default='')
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='voided_attempts',
    )
    voided_at = models.DateTimeField(null=True, blank=True)

    # Reference photo for basic face-match at exam start (SRS.md FR-14).
    # Client-captured still only; server OpenCV match is a future extension
    # (ARCHITECTURE.md §2), not continuous monitoring.
    reference_photo = models.ImageField(
        upload_to='proctoring/reference/',
        null=True,
        blank=True,
        help_text="One-time reference still captured at exam start (FR-14)",
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attempts'
        unique_together = ['exam', 'student']  # One attempt per student per exam
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['student', 'status']),
            models.Index(fields=['exam', 'status']),
            models.Index(fields=['end_time', 'status']),  # For auto-submit sweep
        ]

    def __str__(self):
        return f"{self.student.get_full_name()} - {self.exam.title} ({self.status})"

    def save(self, *args, **kwargs):
        """Set end_time on creation based on exam duration"""
        if not self.pk and not self.end_time:
            from django.utils import timezone as tz
            self.end_time = self.started_at + tz.timedelta(minutes=self.exam.duration_minutes)
        super().save(*args, **kwargs)

    @property
    def remaining_time_seconds(self):
        """Calculate remaining time (server-authoritative)"""
        if self.status != self.Status.IN_PROGRESS:
            return 0

        now = timezone.now()
        if now >= self.end_time:
            return 0

        return int((self.end_time - now).total_seconds())

    @property
    def is_expired(self):
        """Check if attempt has exceeded end_time"""
        return timezone.now() >= self.end_time

    def can_submit(self):
        """Check if attempt can be submitted"""
        return self.status == self.Status.IN_PROGRESS


class AttemptAnswer(models.Model):
    """
    Student's answer to a question in an attempt
    Implements SRS.md FR-16 (autosave), FR-17 (mark for review)
    """
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE)

    # Answer data (depends on question type)
    selected_option_ids = models.JSONField(
        default=list,
        blank=True,
        help_text="List of selected option IDs for MCQ questions"
    )
    text_answer = models.TextField(
        blank=True,
        help_text="Text answer for short-answer questions"
    )

    # Navigation state
    is_marked_for_review = models.BooleanField(
        default=False,
        help_text="Student marked this question for review (SRS.md FR-17)"
    )
    is_visited = models.BooleanField(
        default=False,
        help_text="Student has visited this question"
    )

    # Grading (computed after submission)
    is_correct = models.BooleanField(
        null=True,
        blank=True,
        help_text="Auto-graded result for objective questions"
    )
    marks_awarded = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Marks awarded after grading"
    )
    graded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='graded_answers',
        help_text="Faculty who graded this answer (for subjective questions)"
    )
    grading_feedback = models.TextField(
        blank=True,
        help_text="Optional feedback from grader"
    )

    # Timestamps (for autosave tracking)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attempt_answers'
        unique_together = ['attempt', 'question']
        ordering = ['question']
        indexes = [
            models.Index(fields=['attempt', 'question']),
        ]

    def __str__(self):
        return f"Answer: {self.attempt.student.username} - Q{self.question.id}"


class AttemptQuestion(models.Model):
    """
    Per-student randomized question order for an attempt
    Implements SRS.md FR-10: deterministic randomization per (student_id, exam_id)
    """
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name='attempt_questions')
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
    order = models.IntegerField(help_text="Randomized order for this student")
    shuffled_option_order = models.JSONField(
        default=list,
        help_text="Randomized option IDs order for this student (for MCQ questions)"
    )

    class Meta:
        db_table = 'attempt_questions'
        unique_together = ['attempt', 'question']
        ordering = ['order']

    def __str__(self):
        return f"{self.attempt.student.username} - {self.attempt.exam.title} - Q{self.order + 1}"
