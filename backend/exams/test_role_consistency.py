"""
Regression tests for the admin/student role mismatch.

Root cause: bootstrapped superusers kept the model default role='student'
(create_superuser() never set the custom role field, and ensure_admin's
repair condition could never fire). The SPA badge then showed "Student"
while superuser-bypass guards rendered the Admin Dashboard — and
role-scoped querysets using User.is_student() (no superuser exemption)
returned empty data, e.g. an empty Question Bank despite rows existing.

These tests pin the fixed behavior:
- login returns the backend-issued role truthfully;
- students still cannot see the admin Question Bank (restriction preserved);
- admins — including a legacy superuser whose role label is inconsistent —
  see bank data and admin-only system endpoints.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from exams.models import Course, Question

User = get_user_model()


class RoleConsistencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='admin1', email='admin@example.edu',
            password='AdminPass123!', role='admin',
            first_name='Ad', last_name='Min',
        )
        # Legacy inconsistent row: superuser powers, student label.
        self.legacy_superuser = User.objects.create_superuser(
            username='legacy', email='legacy@example.edu',
            password='LegacyPass123!',
        )
        self.legacy_superuser.role = 'student'
        self.legacy_superuser.save(update_fields=['role'])
        self.student = User.objects.create_user(
            username='student1', email='student@example.edu',
            password='StudentPass123!', role='student',
            first_name='Stu', last_name='Dent',
        )
        self.course = Course.objects.create(
            code='CS101', name='Intro', faculty=self.admin)
        self.question = Question.objects.create(
            course=self.course, type='mcq_single', text='What is 2 + 2?',
            difficulty='easy', marks=1.0, created_by=self.admin)

    def _results(self, response):
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        return data.get('results', data) if isinstance(data, dict) else data

    def test_admin_login_returns_admin_role(self):
        """The badge source of truth: login must report role='admin'."""
        response = self.client.post('/api/auth/login/', {
            'email': 'admin@example.edu', 'password': 'AdminPass123!',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['user']['role'], 'admin')

    def test_student_login_returns_student_role(self):
        response = self.client.post('/api/auth/login/', {
            'email': 'student@example.edu', 'password': 'StudentPass123!',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['user']['role'], 'student')

    def test_admin_sees_question_bank(self):
        self.client.force_authenticate(user=self.admin)
        results = self._results(self.client.get('/api/questions/'))
        self.assertEqual(len(results), 1)

    def test_legacy_superuser_with_student_label_sees_question_bank(self):
        """Defense-in-depth: superusers never get the student empty queryset."""
        self.client.force_authenticate(user=self.legacy_superuser)
        results = self._results(self.client.get('/api/questions/'))
        self.assertEqual(len(results), 1)

    def test_student_question_bank_still_empty(self):
        """The student restriction must survive the superuser exemption."""
        self.client.force_authenticate(user=self.student)
        results = self._results(self.client.get('/api/questions/'))
        self.assertEqual(len(results), 0)

    def test_overview_admin_200_student_403_anonymous_401(self):
        """401 means missing/invalid token; role denial is 403, never 401."""
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(
            self.client.get('/api/system/overview/').status_code,
            status.HTTP_200_OK)
        self.client.force_authenticate(user=self.student)
        self.assertEqual(
            self.client.get('/api/system/overview/').status_code,
            status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get('/api/system/overview/').status_code,
            status.HTTP_401_UNAUTHORIZED)

    def test_audit_log_admin_200_student_403(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(
            self.client.get('/api/system/audit-log/').status_code,
            status.HTTP_200_OK)
        self.client.force_authenticate(user=self.student)
        self.assertEqual(
            self.client.get('/api/system/audit-log/').status_code,
            status.HTTP_403_FORBIDDEN)
