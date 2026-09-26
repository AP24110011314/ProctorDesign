"""
Celery tasks for background jobs
Implements auto-submit sweep per ARCHITECTURE.md §3.5 and SRS.md NFR-14
"""

from celery import shared_task
from django.utils import timezone
from .models import Attempt


@shared_task
def auto_submit_expired_attempts():
    """
    Auto-submit sweep: finds attempts past their end_time and force-submits them
    This is the server-side timer enforcement per SRS.md NFR-14 and AI_RULES.md §4

    Run this task every 30-60 seconds via Celery beat
    """
    now = timezone.now()

    # Find all in-progress attempts that have exceeded their end_time
    expired_attempts = Attempt.objects.filter(
        status=Attempt.Status.IN_PROGRESS,
        end_time__lte=now
    )

    from grading.services import grade_attempt

    count = 0
    for attempt in expired_attempts:
        attempt.status = Attempt.Status.AUTO_SUBMITTED
        attempt.submitted_at = now
        attempt.save()
        grade_attempt(attempt)
        count += 1

    return f"Auto-submitted {count} expired attempt(s)"


@shared_task
def cleanup_old_proctoring_data():
    """
    Data retention cleanup per SRS.md NFR-11.
    Deletes flag evidence files + event rows older than
    PROCTORING_DATA_RETENTION_DAYS, and orphaned reference photos from
    attempts whose exam ended before the window.

    Run periodically via Celery beat (ARCHITECTURE.md §3.5).
    """
    from datetime import timedelta
    from django.conf import settings
    from proctoring.models import ProctoringEvent

    cutoff = timezone.now() - timedelta(days=settings.PROCTORING_DATA_RETENTION_DAYS)

    old_events = ProctoringEvent.objects.filter(timestamp__lt=cutoff)
    files_removed = 0
    for event in old_events.iterator():
        if event.evidence:
            event.evidence.delete(save=False)
            files_removed += 1
    events_removed, _ = old_events.delete()

    # Reference photos belong to attempts; drop them once the exam window +
    # retention period have both passed.
    stale_attempts = Attempt.objects.filter(
        exam__end_time__lt=cutoff, reference_photo__isnull=False
    ).exclude(reference_photo='')
    photos_removed = 0
    for attempt in stale_attempts.iterator():
        attempt.reference_photo.delete(save=False)
        attempt.reference_photo = None
        attempt.save(update_fields=['reference_photo'])
        photos_removed += 1

    return (f'Removed {events_removed} event(s) ({files_removed} evidence file(s)) '
            f'and {photos_removed} reference photo(s)')
