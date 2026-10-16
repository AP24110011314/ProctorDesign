"""
Regression tests for the exam scheduling timezone bug.

Contract: exam times are absolute instants. Clients send ISO 8601 with an
explicit offset (IST wall-clock "+05:30"); Django (USE_TZ=True,
TIME_ZONE=UTC) stores UTC in PostgreSQL `timestamptz`; naive input is
rejected instead of being silently assumed UTC (which shifted every IST
wall-clock by +5:30 and displayed e.g. 15:50 for an intended 10:20 AM).

Covers: create at 10:20 AM IST, save/retrieve, publish stability,
end_time, double-conversion safety, midnight boundary, naive rejection.
"""
from datetime import datetime, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from exams.models import Course, Exam

User = get_user_model()
UTC = dt_timezone.utc


class ExamTimezoneTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.faculty = User.objects.create_user(
            username='faculty1', email='faculty@example.edu',
            password='FacultyPass123!', role='faculty',
            first_name='Fac', last_name='Ulty',
        )
        self.course = Course.objects.create(
            code='CS101', name='Intro', faculty=self.faculty)
        self.client.force_authenticate(user=self.faculty)

    def _payload(self, start, end):
        return {
            'course': self.course.id,
            'title': 'Midterm',
            'start_time': start,
            'end_time': end,
            'duration_minutes': 180,
            'question_count': 5,
        }

    def test_create_1020_ist_stores_0450_utc(self):
        """Admin enters 16 Oct 2026, 10:20 AM IST -> stored 04:50Z."""
        response = self.client.post('/api/exams/', self._payload(
            '2026-10-16T10:20:00+05:30', '2026-10-16T13:20:00+05:30',
        ), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        exam = Exam.objects.get(pk=response.data['id'])
        self.assertEqual(exam.start_time, datetime(2026, 10, 16, 4, 50, tzinfo=UTC))
        self.assertEqual(exam.end_time, datetime(2026, 10, 16, 7, 50, tzinfo=UTC))
        # API echoes the same instant in UTC.
        self.assertEqual(response.data['start_time'], '2026-10-16T04:50:00Z')
        self.assertEqual(response.data['end_time'], '2026-10-16T07:50:00Z')

    def test_retrieve_returns_same_instant(self):
        """List + detail agree with the stored instant (no per-view shift)."""
        created = self.client.post('/api/exams/', self._payload(
            '2026-10-16T10:20:00+05:30', '2026-10-16T13:20:00+05:30',
        ), format='json').data
        for url in ('/api/exams/', f"/api/exams/{created['id']}/"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            item = response.data['results'][0] if 'results' in response.data else response.data
            self.assertEqual(item['start_time'], '2026-10-16T04:50:00Z')
            self.assertEqual(item['end_time'], '2026-10-16T07:50:00Z')

    def test_publish_preserves_instant(self):
        """Publishing flips flags only — the window must not move."""
        exam_id = self.client.post('/api/exams/', self._payload(
            '2026-10-16T10:20:00+05:30', '2026-10-16T13:20:00+05:30',
        ), format='json').data['id']
        response = self.client.post(f'/api/exams/{exam_id}/publish/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        detail = self.client.get(f'/api/exams/{exam_id}/').data
        self.assertEqual(detail['start_time'], '2026-10-16T04:50:00Z')
        self.assertEqual(detail['end_time'], '2026-10-16T07:50:00Z')
        self.assertTrue(detail['is_published'])

    def test_update_with_returned_utc_value_does_not_double_shift(self):
        """Saving the API-returned Z value back is idempotent."""
        exam_id = self.client.post('/api/exams/', self._payload(
            '2026-10-16T10:20:00+05:30', '2026-10-16T13:20:00+05:30',
        ), format='json').data['id']
        payload = self._payload('2026-10-16T04:50:00Z', '2026-10-16T07:50:00Z')
        response = self.client.put(f'/api/exams/{exam_id}/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exam = Exam.objects.get(pk=exam_id)
        self.assertEqual(exam.start_time, datetime(2026, 10, 16, 4, 50, tzinfo=UTC))

    def test_naive_datetimes_rejected(self):
        """A bare wall-clock must 400, never be silently stored as UTC."""
        response = self.client.post('/api/exams/', self._payload(
            '2026-10-16T10:20:00', '2026-10-16T13:20:00',
        ), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('start_time', response.data)
        self.assertEqual(Exam.objects.count(), 0)

    def test_midnight_ist_boundary(self):
        """00:20 IST on the 16th is 18:50 UTC on the 15th — same instant."""
        response = self.client.post('/api/exams/', self._payload(
            '2026-10-16T00:20:00+05:30', '2026-10-16T02:20:00+05:30',
        ), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        exam = Exam.objects.get(pk=response.data['id'])
        self.assertEqual(exam.start_time, datetime(2026, 10, 15, 18, 50, tzinfo=UTC))
        self.assertEqual(exam.end_time, datetime(2026, 10, 15, 20, 50, tzinfo=UTC))
        self.assertEqual(response.data['start_time'], '2026-10-15T18:50:00Z')
