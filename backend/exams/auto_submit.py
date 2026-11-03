"""
Shared auto-submit sweep (deployment-readiness, no behavior change).

SRS.md NFR-14 requires server-authoritative deadline enforcement. The
Celery beat sweep did this every 60s, but Render's free tier has no
background worker. Four callers share this module so the deadline holds
without Celery:

- exams.tasks.auto_submit_expired_attempts (Celery, local dev)
- exams management commands ``auto_submit_expired`` & ``sweep_auto_submit``
- system sweep endpoint (external pinger, CRON_SECRET-gated)
- AttemptViewSet lazy checks (every student touch of an attempt)

No grading/randomization logic lives here — grading stays in
grading/services.py.
"""
import logging
from django.utils import timezone
from django.db import transaction
from django.db.models import Q

logger = logging.getLogger(__name__)


class SweepResult(dict):
    """Holds sweep execution stats while remaining backward-compatible with int comparison."""

    def __init__(self, submitted=0, remaining=0):
        super().__init__(submitted=submitted, remaining=remaining)
        self.submitted = submitted
        self.remaining = remaining

    def __int__(self):
        return self.submitted

    def __eq__(self, other):
        if isinstance(other, int):
            return self.submitted == other
        return super().__eq__(other)


def auto_submit_attempt_if_expired(attempt, now=None):
    """Auto-submit one IN_PROGRESS attempt past its deadline.

    Deadline is server-authoritative (NFR-14): attempt.end_time
    (started_at + duration), capped by exam.end_time if present.
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

    deadline = attempt.end_time
    if hasattr(attempt, 'exam') and attempt.exam and attempt.exam.end_time:
        deadline = min(deadline, attempt.exam.end_time)

    if now < deadline:
        return False

    attempt.status = attempt.Status.AUTO_SUBMITTED
    attempt.submitted_at = now
    attempt.save(update_fields=['status', 'submitted_at'])
    grade_attempt(attempt)
    return True


def sweep_expired_attempts(now=None, max_batch=200):
    """Force-submit every IN_PROGRESS attempt past its deadline.

    Idempotent, safe against overlapping runs (select_for_update(skip_locked=True)),
    processes at most 200 attempts per call, and one failing attempt does not
    abort the batch (catch, log, continue).
    Returns a SweepResult with 'submitted' and 'remaining'.
    """
    from .models import Attempt

    now = now or timezone.now()
    expired_filter = Q(end_time__lte=now) | (
        Q(exam__end_time__isnull=False) & Q(exam__end_time__lte=now)
    )

    candidate_ids = list(
        Attempt.objects.filter(status=Attempt.Status.IN_PROGRESS)
        .filter(expired_filter)
        .values_list('id', flat=True)[:max_batch]
    )

    submitted = 0
    for attempt_id in candidate_ids:
        try:
            with transaction.atomic():
                locked_attempt = (
                    Attempt.objects.select_for_update(skip_locked=True)
                    .select_related('exam')
                    .filter(id=attempt_id, status=Attempt.Status.IN_PROGRESS)
                    .first()
                )
                if not locked_attempt:
                    continue
                if auto_submit_attempt_if_expired(locked_attempt, now=now):
                    submitted += 1
        except Exception as exc:
            logger.exception("Failed to auto-submit attempt id=%s: %s", attempt_id, exc)
            continue

    remaining = Attempt.objects.filter(
        status=Attempt.Status.IN_PROGRESS
    ).filter(expired_filter).count()

    return SweepResult(submitted=submitted, remaining=remaining)
