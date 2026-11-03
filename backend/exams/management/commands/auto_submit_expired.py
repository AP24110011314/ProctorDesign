"""
Idempotent auto-submit sweep as a management command.

Free-tier Render has no background worker, so the deadline sweep runs via:
- this command (Render build step / manual run / external cron that shells in), or
- POST /api/system/sweep/auto-submit/ (external pinger, CRON_SECRET-gated).

Both share exams/auto_submit.py; Celery beat calls the same code locally.
"""
from django.core.management.base import BaseCommand
from exams.auto_submit import sweep_expired_attempts


class Command(BaseCommand):
    help = 'Auto-submit in-progress attempts past their deadline (NFR-14)'

    def handle(self, *args, **options):
        result = sweep_expired_attempts()
        self.stdout.write(self.style.SUCCESS(
            f'Auto-submitted {result["submitted"]} expired attempt(s) ({result["remaining"]} remaining)'
        ))
