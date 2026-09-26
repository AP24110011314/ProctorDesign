from django.conf import settings
from django.db import models


class ProctoringEvent(models.Model):
    """
    One proctoring flag for an attempt (SRS.md FR-20–FR-23).

    Privacy by design (NFR-10): only flagged-moment thumbnails are stored via
    ``evidence`` — never continuous video. Server-side OpenCV is reserved for
    one-time reference-photo matching and offline reprocessing, not per-frame
    monitoring (ARCHITECTURE.md §2).

    Flags never auto-disqualify: they exist for human review (``reviewed``),
    and the integrity score never alters the exam score (FR-24).
    """

    class EventType(models.TextChoices):
        NO_FACE = 'NO_FACE', 'No Face Detected'
        MULTIPLE_FACES = 'MULTIPLE_FACES', 'Multiple Faces Detected'
        FACE_MISMATCH = 'FACE_MISMATCH', 'Face Mismatch'
        TAB_SWITCH = 'TAB_SWITCH', 'Tab Switch / Window Blur'
        FULLSCREEN_EXIT = 'FULLSCREEN_EXIT', 'Fullscreen Exit'
        CLIPBOARD_EVENT = 'CLIPBOARD_EVENT', 'Copy/Paste Attempted'
        DEVTOOLS_ATTEMPT = 'DEVTOOLS_ATTEMPT', 'Devtools Attempt'
        LOUD_NOISE = 'LOUD_NOISE', 'Loud Noise'

    class Severity(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'

    attempt = models.ForeignKey(
        'exams.Attempt',
        on_delete=models.CASCADE,
        related_name='proctoring_events',
    )
    type = models.CharField(max_length=20, choices=EventType.choices)
    # Server-computed from the type map; any client-sent severity is ignored
    # so a tampered client cannot downplay its own flags.
    severity = models.CharField(max_length=10, choices=Severity.choices)
    timestamp = models.DateTimeField(auto_now_add=True)
    evidence = models.ImageField(
        upload_to='proctoring/%Y/%m/',
        null=True,
        blank=True,
        help_text='Compressed flagged-moment thumbnail only (NFR-10)',
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text='Client timestamp, durations, thresholds — never video',
    )

    # Human-review workflow: flags are for review, never auto-fail.
    reviewed = models.BooleanField(default=False)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_events',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'proctoring_events'
        ordering = ['-timestamp']

    def __str__(self):
        return f'{self.type} ({self.severity}) on attempt {self.attempt_id}'
