"""
Shared auto-submit sweep (deployment-readiness, no behavior change).

SRS.md NFR-14 requires server-authoritative deadline enforcement. The
Celery beat sweep did this every 60s, but Render's free tier has no
background worker. Three callers share this module so the deadline holds
without Celery:

- exams.tasks.auto_submit_expired_attempts (Celery, local dev)
- exams management command ``auto_submit_expired`` (Render build/cron)
- system sweep endpoint (external pinger, CRON_SECRET-gated)
- AttemptViewSet lazy checks (every student touch of an attempt)

No grading/randomization logic lives here — grading stays in
grading/services.py.
"""
from django.utils import timezone


def auto_submit_attempt_if_expired(attempt, now=None):
    """Auto-submit one IN_PROGRESS attempt past its end_time.

    Returns True when the attempt was transitioned (and graded),
    False when nothing needed doing. Idempotent: already-submitted,
    voided, or unexpired attempts are untouched.
    """
    from grading.services import grade_attempt

    now = now or timezone.now()
    if attempt.status != attempt.Status.IN_PROGRESS:
        return False
    # Refresh end_time in case the caller holds a stale instance.
    attempt.refresh_from_db(fields=['status', 'end_time'])
    if attempt.status != attempt.Status.IN_PROGRESS:
        return False
    if now < attempt.end_time:
        return False
    attempt.status = attempt.Status.AUTO_SUBMITTED
    attempt.submitted_at = now
    attempt.save(update_fields=['status', 'submitted_at'])
    grade_attempt(attempt)
    return True


def sweep_expired_attempts(now=None):
    """Force-submit every IN_PROGRESS attempt past its end_time.

    Returns the number of attempts transitioned. Bounded per call so a
    single ping cannot hold the request open on huge backlogs.
    """
    from .models import Attempt

    now = now or timezone.now()
    expired_ids = list(
        Attempt.objects.filter(
            status=Attempt.Status.IN_PROGRESS,
            end_time__lte=now,
        ).values_list('id', flat=True)[:500]
    )
    count = 0
    for attempt_id in expired_ids:
        try:
            attempt = Attempt.objects.get(id=attempt_id)
        except Attempt.DoesNotExist:
            continue
        if auto_submit_attempt_if_expired(attempt, now=now):
            count += 1
    return count
