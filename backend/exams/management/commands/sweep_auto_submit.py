"""
Management command to run the auto-submit deadline sweep (NFR-14).
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
