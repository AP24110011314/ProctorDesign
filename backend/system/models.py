from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """
    Append-only audit trail for sensitive admin/faculty actions
    (SRS.md FR-31, UI_UX_SPEC §4.13): who did what to which object, when.
    Written via log_action(); never updated or deleted through the API.
    """

    class Action(models.TextChoices):
        ATTEMPT_VOID = 'attempt.void', 'Attempt Voided'
        RESULTS_PUBLISH = 'results.publish', 'Results Published'
        RESULTS_UNPUBLISH = 'results.unpublish', 'Results Unpublished'
        FLAG_REVIEW = 'flag.review', 'Flag Reviewed'

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='audit_entries',
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    target_type = models.CharField(max_length=30)
    target_id = models.PositiveIntegerField()
    details = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_log'
        ordering = ['-timestamp']

    def __str__(self):
        return f'{self.action} on {self.target_type}#{self.target_id} by {self.actor_id}'


def log_action(actor, action, target, details=None):
    """Append one audit entry. Target is any model instance with a pk."""
    return AuditLog.objects.create(
        actor=actor,
        action=action,
        target_type=type(target).__name__,
        target_id=target.pk,
        details=details or {},
    )
