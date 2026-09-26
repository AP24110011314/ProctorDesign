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
