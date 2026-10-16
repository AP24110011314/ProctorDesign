"""
Idempotent admin bootstrap for environments without a shell (Render free tier).

Reads DJANGO_SUPERUSER_EMAIL / DJANGO_SUPERUSER_PASSWORD (+ optional
DJANGO_SUPERUSER_USERNAME, defaulting to the email local-part). Skips when a
user with that email/username already exists. Never logs or echoes the
password.

Usage (Render build command or one-off job):
    python manage.py ensure_admin
"""
import os

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Create the admin user from env vars if it does not exist (idempotent)'

    def handle(self, *args, **options):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        email = os.getenv('DJANGO_SUPERUSER_EMAIL', '').strip()
        password = os.getenv('DJANGO_SUPERUSER_PASSWORD', '')
        username = os.getenv('DJANGO_SUPERUSER_USERNAME', '').strip()

        if not email or not password:
            self.stdout.write(self.style.WARNING(
                'ensure_admin skipped: DJANGO_SUPERUSER_EMAIL and '
                'DJANGO_SUPERUSER_PASSWORD must both be set'
            ))
            return

        if not username:
            username = email.split('@')[0]

        existing = (
            User.objects.filter(email__iexact=email).first()
            or User.objects.filter(username=username).first()
        )
        if existing is not None:
            # Repair path: a superuser whose role field is not 'admin'
            # (e.g. created before this command set the role, since
            # create_superuser() leaves the model default 'student') would
            # otherwise be treated as a student by role-scoped querysets
            # while still passing superuser-bypass route guards — i.e. a
            # "Student" badge on the Admin Dashboard and an empty Question
            # Bank. Repairing the label grants no new privilege: superusers
            # already bypass role checks. Never touch non-superusers here.
            if existing.is_superuser and existing.role != 'admin':
                existing.role = 'admin'
                existing.save(update_fields=['role'])
                self.stdout.write(self.style.SUCCESS(
                    f'ensure_admin repaired: superuser "{existing.username}" role set to admin'
                ))
            else:
                self.stdout.write(self.style.SUCCESS(
                    f'ensure_admin skipped: admin "{existing.username}" already exists'
                ))
            return

        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
        )
        # create_superuser() does not know about our custom role field, so
        # the row keeps the model default ('student') unless we set it.
        # Always label bootstrapped superusers as admins for consistency
        # with role-scoped querysets and the SPA role badge.
        if getattr(user, 'role', None) != 'admin':
            user.role = 'admin'
            user.save(update_fields=['role'])
        self.stdout.write(self.style.SUCCESS(
            f'ensure_admin created superuser "{username}"'
        ))
