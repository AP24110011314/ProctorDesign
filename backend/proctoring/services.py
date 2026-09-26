"""
Proctoring business logic: severity mapping, integrity scoring, upload validation.

SRS.md FR-24: the integrity score is a weighted function of flag counts and
severity, visible to faculty/admin only, and NEVER alters the exam score.
"""
from django.conf import settings

from .models import ProctoringEvent

# Server-authoritative severity per event type. Clients may send a severity
# hint but it is ignored on ingest (see views): a tampered client must not be
# able to downplay its own flags.
SEVERITY_BY_TYPE = {
    ProctoringEvent.EventType.NO_FACE: ProctoringEvent.Severity.MEDIUM,
    ProctoringEvent.EventType.MULTIPLE_FACES: ProctoringEvent.Severity.HIGH,
    ProctoringEvent.EventType.FACE_MISMATCH: ProctoringEvent.Severity.HIGH,
    ProctoringEvent.EventType.TAB_SWITCH: ProctoringEvent.Severity.MEDIUM,
    ProctoringEvent.EventType.FULLSCREEN_EXIT: ProctoringEvent.Severity.MEDIUM,
    ProctoringEvent.EventType.CLIPBOARD_EVENT: ProctoringEvent.Severity.LOW,
    ProctoringEvent.EventType.DEVTOOLS_ATTEMPT: ProctoringEvent.Severity.MEDIUM,
    ProctoringEvent.EventType.LOUD_NOISE: ProctoringEvent.Severity.LOW,
}

# Deduction weights per severity. Pure function of flag counts — the exam
# score is computed independently in grading/services.py and never touched here.
SEVERITY_WEIGHTS = {
    ProctoringEvent.Severity.HIGH: 10.0,
    ProctoringEvent.Severity.MEDIUM: 4.0,
    ProctoringEvent.Severity.LOW: 1.0,
}

ALLOWED_EVIDENCE_CONTENT_TYPES = {'image/jpeg', 'image/png', 'image/webp'}


def compute_integrity_score(severities):
    """
    Weighted integrity score 0–100 from an iterable of severity strings.
    No flags → 100. Pure function, unit-tested (NFR-17).
    """
    deduction = sum(SEVERITY_WEIGHTS.get(s, 0) for s in severities)
    return max(0.0, 100.0 - deduction)


def refresh_attempt_integrity(attempt):
    """Recompute and persist attempt.integrity_score from all its events."""
    severities = attempt.proctoring_events.values_list('severity', flat=True)
    attempt.integrity_score = compute_integrity_score(severities)
    attempt.save(update_fields=['integrity_score'])
    return attempt.integrity_score


def validate_evidence(upload):
    """
    Privacy/size gate for flag thumbnails (NFR-10): still images only, never
    video; bounded by PROCTORING_SNAPSHOT_MAX_SIZE_MB. Returns an error string
    or None when valid.
    """
    if upload.content_type not in ALLOWED_EVIDENCE_CONTENT_TYPES:
        return 'Only JPEG/PNG/WebP still thumbnails are accepted — video is never stored'
    max_bytes = settings.PROCTORING_SNAPSHOT_MAX_SIZE_MB * 1024 * 1024
    if upload.size > max_bytes:
        return f'Thumbnail exceeds {settings.PROCTORING_SNAPSHOT_MAX_SIZE_MB} MB limit'
    return None
