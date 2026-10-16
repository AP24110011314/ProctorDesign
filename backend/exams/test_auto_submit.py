"""
Deployment-readiness tests: server-side deadline without Celery.

SRS.md NFR-14 requires the deadline to hold even with no background worker.
Covers the shared sweep (exams/auto_submit.py) and the lazy enforcement on
student touches (fetch, autosave, submit), plus the idempotent admin bootstrap.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from .auto_submit import auto_submit_attempt_if_expired, sweep_expired_attempts
from .models import Attempt, Course, Exam, Question, QuestionOption

User = get_user_model()


class LazyAutoSubmitTests(TestCase):
    """Expired attempts auto-submit when next touched (no Celery needed)."""

    def setUp(self):
        self.client = APIClient()
        self.faculty = User.objects.create_user(
            username='faculty1', email='faculty@example.edu',
            password='FacultyPass123!', role='faculty')
        self.student = User.objects.create_user(
            username='student1', email='student@example.edu',
            password='StudentPass123!', role='student')
        self.course = Course.objects.create(
            code='CS101', name='Programming', faculty=self.faculty)
        self.question = Question.objects.create(
            course=self.course, type='mcq_single', text='What is 2 + 2?',
            difficulty='easy', marks=1.0, created_by=self.faculty)
        QuestionOption.objects.create(
            question=self.question, text='3', is_correct=False, order=0)
        QuestionOption.objects.create(
            question=self.question, text='4', is_correct=True, order=1)
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='Timed Exam',
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=2),
            duration_minutes=60, question_count=1, marks_per_question=1.0,
            is_published=True, created_by=self.faculty)
        from .models import ExamQuestion
        ExamQuestion.objects.create(exam=self.exam, question=self.question, order=0)

    def _expired_attempt(self):
        now = timezone.now()
        return Attempt.objects.create(
            exam=self.exam, student=self.student,
            end_time=now - timedelta(minutes=1))

    def test_fetch_auto_submits_expired_attempt(self):
        attempt = self._expired_attempt()
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/{attempt.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, Attempt.Status.AUTO_SUBMITTED)
        self.assertIsNotNone(attempt.submitted_at)

    def test_autosave_on_expired_attempt_returns_auto_submitted(self):
        attempt = self._expired_attempt()
        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/attempts/{attempt.id}/save_answer/',
            {'question_id': self.question.id, 'is_visited': True})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(response.data.get('auto_submitted'))
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, Attempt.Status.AUTO_SUBMITTED)

    def test_submit_after_expiry_records_auto_submit(self):
        attempt = self._expired_attempt()
        self.client.force_authenticate(user=self.student)
        response = self.client.post(f'/api/attempts/{attempt.id}/submit/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data.get('auto_submitted'))
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, Attempt.Status.AUTO_SUBMITTED)

    def test_unexpired_attempt_untouched_by_lazy_check(self):
        attempt = Attempt.objects.create(
            exam=self.exam, student=self.student,
            end_time=timezone.now() + timedelta(minutes=30))
        self.assertFalse(auto_submit_attempt_if_expired(attempt))
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, Attempt.Status.IN_PROGRESS)

    def test_sweep_only_transitions_expired(self):
        expired = self._expired_attempt()
        live = Attempt.objects.create(
            exam=self.exam, student=self.faculty,  # any owner; sweep is owner-agnostic
            end_time=timezone.now() + timedelta(minutes=30))
        # Unique (exam, student) — faculty attempt above is a second row; fine.
        count = sweep_expired_attempts()
        self.assertEqual(count, 1)
        expired.refresh_from_db()
        live.refresh_from_db()
        self.assertEqual(expired.status, Attempt.Status.AUTO_SUBMITTED)
        self.assertEqual(live.status, Attempt.Status.IN_PROGRESS)


class EnsureAdminCommandTests(TestCase):
    """Idempotent admin bootstrap for shell-less (free-tier) deploys."""

    def test_skipped_without_env(self):
        from django.core.management import call_command
        call_command('ensure_admin')
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 0)

    def test_creates_then_skips(self):
        import os
        from unittest import mock
        from django.core.management import call_command

        env = {
            'DJANGO_SUPERUSER_EMAIL': 'boss@example.edu',
            'DJANGO_SUPERUSER_PASSWORD': 'SuperSecret123!',
        }
        with mock.patch.dict(os.environ, env, clear=False):
            call_command('ensure_admin')
            call_command('ensure_admin')  # second run must skip, not crash
        user = User.objects.get(email='boss@example.edu')
        self.assertTrue(user.is_superuser)
        # create_superuser() leaves the model default role; the command must
        # label bootstrapped superusers as admins (badge + queryset scoping).
        self.assertEqual(user.role, 'admin')
        self.assertEqual(User.objects.filter(email='boss@example.edu').count(), 1)

    def test_repairs_legacy_superuser_role(self):
        """A pre-existing superuser stuck with role='student' gets repaired
        (label fix only — no privilege change, no-op for non-superusers)."""
        import os
        from unittest import mock
        from django.core.management import call_command

        legacy = User.objects.create_superuser(
            username='legacy', email='legacy@example.edu', password='x')
        legacy.role = 'student'
        legacy.save(update_fields=['role'])
        plain = User.objects.create_user(
            username='plain', email='plain@example.edu', password='x',
            role='student')

        env = {
            'DJANGO_SUPERUSER_EMAIL': 'legacy@example.edu',
            'DJANGO_SUPERUSER_PASSWORD': 'SuperSecret123!',
        }
        with mock.patch.dict(os.environ, env, clear=False):
            call_command('ensure_admin')
        legacy.refresh_from_db()
        plain.refresh_from_db()
        self.assertEqual(legacy.role, 'admin')
        self.assertEqual(plain.role, 'student')
        self.assertEqual(User.objects.filter(email='legacy@example.edu').count(), 1)
