from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from rest_framework import status

from exams.models import Attempt, AttemptAnswer, Course, Exam, Question
from proctoring.models import ProctoringEvent
from system.models import AuditLog

User = get_user_model()


class VoidAttemptTests(TestCase):
    """SRS.md FR-31: void with mandatory reason, scoped, audited, terminal."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='adm', email='adm@example.edu', password='x', role='admin')
        self.faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        self.other_faculty = User.objects.create_user(
            username='fac2', email='fac2@example.edu', password='x', role='faculty')
        self.student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        self.course = Course.objects.create(code='C', name='N', faculty=self.faculty)
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='E',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=120, question_count=1, marks_per_question=1.0,
            is_published=True, created_by=self.faculty)
        self.attempt = Attempt.objects.create(
            exam=self.exam, student=self.student,
            started_at=now - timedelta(minutes=30), submitted_at=now,
            status=Attempt.Status.SUBMITTED, score=1.0)
        self.url = f'/api/attempts/{self.attempt.id}/void/'

    def test_admin_void_with_reason(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(self.url, {'reason': 'Confirmed cheating'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.status, Attempt.Status.VOIDED)
        self.assertEqual(self.attempt.void_reason, 'Confirmed cheating')
        self.assertEqual(self.attempt.voided_by, self.admin)
        self.assertIsNotNone(self.attempt.voided_at)
        entry = AuditLog.objects.get(action=AuditLog.Action.ATTEMPT_VOID)
        self.assertEqual(entry.actor, self.admin)
        self.assertEqual(entry.target_id, self.attempt.id)
        self.assertEqual(entry.details['reason'], 'Confirmed cheating')

    def test_reason_mandatory(self):
        self.client.force_authenticate(user=self.admin)
        for body in ({}, {'reason': ''}, {'reason': '   '}):
            response = self.client.post(self.url, body, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_faculty_own_course_ok_other_course_forbidden(self):
        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(self.url, {'reason': 'Cheating'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.client.force_authenticate(user=self.other_faculty)
        response = self.client.post(self.url, {'reason': 'Cheating'})
        self.assertIn(response.status_code,
                      (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    def test_student_cannot_void(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.post(self.url, {'reason': 'x'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_double_void_rejected(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post(self.url, {'reason': 'first'})
        response = self.client.post(self.url, {'reason': 'second'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_voided_attempt_locked_out(self):
        """Terminal: no submit, no grading queue, no student result."""
        question = Question.objects.create(
            course=self.course, type='short_answer', text='Explain?',
            difficulty='easy', marks=1.0, created_by=self.faculty)
        AttemptAnswer.objects.create(attempt=self.attempt, question=question,
                                     text_answer='An answer')
        self.client.force_authenticate(user=self.admin)
        self.client.post(self.url, {'reason': 'Cheating'})

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/{self.attempt.id}/result/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/grading/answers/')
        self.assertEqual(response.data['results'], [])


class SweepEndpointTests(TestCase):
    """CRON-gated sweep: wrong/missing secret → 403, correct → sweep runs (NFR-14)."""

    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        self.student2 = User.objects.create_user(
            username='stu2', email='stu2@example.edu', password='x', role='student')
        self.faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        self.course = Course.objects.create(code='C', name='N', faculty=self.faculty)
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='E',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=120, question_count=1, marks_per_question=1.0,
            is_published=True, created_by=self.faculty)
        self.url = '/api/system/sweep/auto-submit/'
        self.url_noslash = '/api/system/sweep/auto-submit'
        self.secret = 'test-cron-secret'

    def _expired_attempt(self, student=None):
        student = student or self.student
        return Attempt.objects.create(
            exam=self.exam, student=student,
            end_time=timezone.now() - timedelta(minutes=1),
            status=Attempt.Status.IN_PROGRESS)

    def test_missing_secret_forbidden(self):
        from django.test import override_settings
        with override_settings(CRON_SECRET=self.secret):
            response = self.client.post(self.url, {})
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(response.json(), {"ok": False, "error": "forbidden"})
            self.assertLess(len(response.content), 200)

    def test_wrong_secret_forbidden(self):
        from django.test import override_settings
        with override_settings(CRON_SECRET=self.secret):
            response = self.client.post(
                self.url, {}, HTTP_X_CRON_SECRET='nope')
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(response.json(), {"ok": False, "error": "forbidden"})
            self.assertLess(len(response.content), 200)

    def test_unconfigured_secret_locked(self):
        from django.test import override_settings
        with override_settings(CRON_SECRET=''):
            response = self.client.post(
                self.url, {}, HTTP_X_CRON_SECRET='anything')
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(response.json(), {"ok": False, "error": "forbidden"})
            self.assertLess(len(response.content), 200)

    def test_get_method_rejected_with_405_json(self):
        from django.test import override_settings
        with override_settings(CRON_SECRET=self.secret):
            response = self.client.get(
                self.url, HTTP_X_CRON_SECRET=self.secret)
            self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
            self.assertEqual(response.json(), {"ok": False, "error": "method_not_allowed"})
            self.assertEqual(response.headers.get('Content-Type'), 'application/json')
            self.assertLess(len(response.content), 200)

    def test_correct_secret_runs_sweep_and_is_idempotent(self):
        from django.test import override_settings
        attempt = self._expired_attempt()
        with override_settings(CRON_SECRET=self.secret):
            # Run 1: Submits 1 expired attempt
            response = self.client.post(
                self.url, {}, HTTP_X_CRON_SECRET=self.secret)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.headers.get('Content-Type'), 'application/json')
            data = response.json()
            self.assertTrue(data['ok'])
            self.assertEqual(data['submitted'], 1)
            self.assertEqual(data['remaining'], 0)
            self.assertLess(len(response.content), 200)

            attempt.refresh_from_db()
            self.assertEqual(attempt.status, Attempt.Status.AUTO_SUBMITTED)
            self.assertIsNotNone(attempt.submitted_at)

            # Run 2: Idempotent - running again submits 0
            response2 = self.client.post(
                self.url, {}, HTTP_X_CRON_SECRET=self.secret)
            self.assertEqual(response2.status_code, status.HTTP_200_OK)
            data2 = response2.json()
            self.assertTrue(data2['ok'])
            self.assertEqual(data2['submitted'], 0)
            self.assertEqual(data2['remaining'], 0)

    def test_url_without_trailing_slash_resolves_directly(self):
        from django.test import override_settings
        attempt = self._expired_attempt()
        with override_settings(CRON_SECRET=self.secret):
            response = self.client.post(
                self.url_noslash, {}, HTTP_X_CRON_SECRET=self.secret)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.headers.get('Content-Type'), 'application/json')
            self.assertTrue(response.json()['ok'])

    def test_non_expired_and_submitted_attempts_untouched(self):
        from django.test import override_settings
        now = timezone.now()
        # Non-expired attempt
        live = Attempt.objects.create(
            exam=self.exam, student=self.student,
            end_time=now + timedelta(minutes=45),
            status=Attempt.Status.IN_PROGRESS)
        # Already-submitted attempt
        submitted = Attempt.objects.create(
            exam=self.exam, student=self.student2,
            end_time=now - timedelta(minutes=10),
            status=Attempt.Status.SUBMITTED,
            submitted_at=now - timedelta(minutes=12))

        with override_settings(CRON_SECRET=self.secret):
            response = self.client.post(
                self.url, {}, HTTP_X_CRON_SECRET=self.secret)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.json()['submitted'], 0)

        live.refresh_from_db()
        submitted.refresh_from_db()
        self.assertEqual(live.status, Attempt.Status.IN_PROGRESS)
        self.assertEqual(submitted.status, Attempt.Status.SUBMITTED)

    def test_failing_attempt_does_not_abort_batch(self):
        from django.test import override_settings
        from unittest.mock import patch
        from exams.auto_submit import auto_submit_attempt_if_expired

        att1 = self._expired_attempt(self.student)
        att2 = self._expired_attempt(self.student2)

        orig_auto_submit = auto_submit_attempt_if_expired

        def flaky_auto_submit(attempt, now=None):
            if attempt.id == att1.id:
                raise RuntimeError("Simulated transient grading failure")
            return orig_auto_submit(attempt, now=now)

        with override_settings(CRON_SECRET=self.secret):
            with patch('exams.auto_submit.auto_submit_attempt_if_expired', side_effect=flaky_auto_submit):
                response = self.client.post(
                    self.url, {}, HTTP_X_CRON_SECRET=self.secret)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                data = response.json()
                self.assertTrue(data['ok'])
                self.assertEqual(data['submitted'], 1)

    def test_management_commands_sweep_auto_submit(self):
        from django.core.management import call_command
        import io
        attempt = self._expired_attempt()
        out = io.StringIO()
        call_command('sweep_auto_submit', stdout=out)
        self.assertIn('Auto-submitted 1 expired attempt(s)', out.getvalue())
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, Attempt.Status.AUTO_SUBMITTED)

        out2 = io.StringIO()
        call_command('auto_submit_expired', stdout=out2)
        self.assertIn('Auto-submitted 0 expired attempt(s)', out2.getvalue())


class OverviewAndAuditTests(TestCase):
    """SRS.md FR-30: admin-only system snapshot + audit trail."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='adm', email='adm@example.edu', password='x', role='admin')
        self.faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        self.student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        self.course = Course.objects.create(code='C', name='N', faculty=self.faculty)
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='E',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=120, question_count=1, marks_per_question=1.0,
            is_published=True, created_by=self.faculty)
        self.attempt = Attempt.objects.create(
            exam=self.exam, student=self.student,
            started_at=now - timedelta(minutes=10), status=Attempt.Status.IN_PROGRESS)
        ProctoringEvent.objects.create(
            attempt=self.attempt, type='TAB_SWITCH', severity='medium')

    def test_overview_admin_only_with_counts(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/system/overview/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        self.assertEqual(data['total_exams'], 1)
        self.assertEqual(data['active_attempts'], 1)
        self.assertEqual(data['flagged_needing_review'], 1)
        self.assertEqual(data['users_by_role']['student'], 1)
        self.assertEqual(len(data['flagged_attempts']), 1)
        self.assertEqual(data['flagged_attempts'][0]['unreviewed_count'], 1)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/system/overview/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=self.student)
        response = self.client.get('/api/system/overview/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_publish_and_review_write_audit_entries(self):
        self.client.force_authenticate(user=self.faculty)
        self.client.post(f'/api/grading/exams/{self.exam.id}/publish/')
        event = ProctoringEvent.objects.get()
        self.client.post(f'/api/proctoring/events/{event.id}/review/')
        actions = set(AuditLog.objects.values_list('action', flat=True))
        self.assertIn(AuditLog.Action.RESULTS_PUBLISH, actions)
        self.assertIn(AuditLog.Action.FLAG_REVIEW, actions)

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/system/audit-log/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2)
        response = self.client.get(
            f'/api/system/audit-log/?action={AuditLog.Action.RESULTS_PUBLISH}')
        self.assertEqual(len(response.data['results']), 1)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/system/audit-log/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
