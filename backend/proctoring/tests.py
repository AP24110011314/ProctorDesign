import io
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from PIL import Image
from rest_framework.test import APIClient
from rest_framework import status

from exams.models import Attempt, Course, Exam
from exams.tasks import cleanup_old_proctoring_data
from proctoring.models import ProctoringEvent
from proctoring.services import compute_integrity_score

User = get_user_model()
MEDIA_TMP = tempfile.mkdtemp()


def make_image(name='thumb.jpg', size=(64, 64), fmt='JPEG'):
    buf = io.BytesIO()
    Image.new('RGB', size, color='red').save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/jpeg')


def make_noise_png(name='big.png', size=(1200, 1200)):
    """Uncompressible noise PNG, reliably over the 2 MB thumbnail cap."""
    import random
    rnd = random.Random(42)
    img = Image.new('RGB', size)
    img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
                 for _ in range(size[0] * size[1])])
    buf = io.BytesIO()
    img.save(buf, 'PNG', compress_level=0)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class ProctoringIngestTests(TestCase):
    """Flag ingest: FR-20–FR-23, NFR-10 privacy limits, flood guard config."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        self.student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        self.other = User.objects.create_user(
            username='oth', email='oth@example.edu', password='x', role='student')
        self.course = Course.objects.create(code='C', name='N', faculty=self.faculty)
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='E',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=120, question_count=1, marks_per_question=1.0,
            proctoring_mode='basic', is_published=True, created_by=self.faculty)
        self.attempt = Attempt.objects.create(
            exam=self.exam, student=self.student,
            started_at=now - timedelta(minutes=10), status=Attempt.Status.IN_PROGRESS)

    def post_event(self, payload, fmt='json'):
        return self.client.post(
            f'/api/attempts/{self.attempt.id}/events/', payload, format=fmt)

    def test_valid_flag_server_computes_severity(self):
        """FR-23: flag stored; severity comes from the server map, not the client."""
        self.client.force_authenticate(user=self.student)
        response = self.post_event({'type': 'TAB_SWITCH', 'severity': 'low'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['severity'], 'medium')
        event = ProctoringEvent.objects.get()
        self.assertEqual(event.severity, 'medium')
        self.attempt.refresh_from_db()
        self.assertEqual(str(self.attempt.integrity_score), '96.00')

    def test_invalid_type_rejected(self):
        self.client.force_authenticate(user=self.student)
        response = self.post_event({'type': 'CHEATED_HARD'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_video_evidence_rejected(self):
        """NFR-10: never store video — non-image evidence is refused."""
        self.client.force_authenticate(user=self.student)
        fake_video = SimpleUploadedFile('clip.mp4', b'\x00' * 100, content_type='video/mp4')
        response = self.post_event({'type': 'NO_FACE', 'evidence': fake_video}, fmt='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ProctoringEvent.objects.count(), 0)

    def test_oversized_thumbnail_rejected(self):
        self.client.force_authenticate(user=self.student)
        response = self.post_event(
            {'type': 'NO_FACE', 'evidence': make_noise_png()}, fmt='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ProctoringEvent.objects.count(), 0)

    def test_valid_thumbnail_accepted(self):
        self.client.force_authenticate(user=self.student)
        response = self.post_event(
            {'type': 'MULTIPLE_FACES', 'evidence': make_image()}, fmt='multipart')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        event = ProctoringEvent.objects.get()
        self.assertTrue(bool(event.evidence))

    def test_submitted_attempt_rejected(self):
        self.attempt.status = Attempt.Status.SUBMITTED
        self.attempt.save(update_fields=['status'])
        self.client.force_authenticate(user=self.student)
        response = self.post_event({'type': 'TAB_SWITCH'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_proctoring_off_rejected(self):
        self.exam.proctoring_mode = 'off'
        self.exam.save(update_fields=['proctoring_mode'])
        self.client.force_authenticate(user=self.student)
        response = self.post_event({'type': 'TAB_SWITCH'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_other_student_gets_404(self):
        self.client.force_authenticate(user=self.other)
        response = self.post_event({'type': 'TAB_SWITCH'})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_faculty_cannot_report(self):
        self.client.force_authenticate(user=self.faculty)
        response = self.post_event({'type': 'TAB_SWITCH'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_integrity_accumulates_score_untouched(self):
        """FR-24: weighted deductions; exam score never touched by flagging."""
        self.client.force_authenticate(user=self.student)
        for _ in range(5):
            response = self.post_event({'type': 'MULTIPLE_FACES'})
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.attempt.refresh_from_db()
        self.assertEqual(str(self.attempt.integrity_score), '50.00')
        self.assertIsNone(self.attempt.score)


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class ReferencePhotoTests(TestCase):
    """FR-14: one-time reference still at exam start."""

    def setUp(self):
        self.client = APIClient()
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
            started_at=now - timedelta(minutes=5), status=Attempt.Status.IN_PROGRESS)
        self.url = f'/api/attempts/{self.attempt.id}/reference_photo/'

    def test_upload_reference_photo(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.post(self.url, {'photo': make_image()}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.attempt.refresh_from_db()
        self.assertTrue(bool(self.attempt.reference_photo))

    def test_missing_photo_rejected(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.post(self.url, {}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_image_rejected(self):
        self.client.force_authenticate(user=self.student)
        fake = SimpleUploadedFile('clip.mp4', b'\x00' * 10, content_type='video/mp4')
        response = self.client.post(self.url, {'photo': fake}, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ReviewAndMonitorTests(TestCase):
    """Faculty review workflow (FR-24/25) with NFR-7 course scoping."""

    def setUp(self):
        self.client = APIClient()
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
            started_at=now - timedelta(minutes=10), status=Attempt.Status.IN_PROGRESS)
        self.event = ProctoringEvent.objects.create(
            attempt=self.attempt, type='TAB_SWITCH', severity='medium')

    def test_student_cannot_list_events(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get('/api/proctoring/events/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_faculty_sees_own_course_only(self):
        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/proctoring/events/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.client.force_authenticate(user=self.other_faculty)
        response = self.client.get('/api/proctoring/events/')
        self.assertEqual(response.data['results'], [])

    def test_review_marks_event(self):
        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/proctoring/events/{self.event.id}/review/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.event.refresh_from_db()
        self.assertTrue(self.event.reviewed)
        self.assertEqual(self.event.reviewed_by, self.faculty)
        self.assertIsNotNone(self.event.reviewed_at)

    def test_monitor_snapshot_sorted_and_scoped(self):
        """FR-25: active attempts by flag count desc; students locked out."""
        second = User.objects.create_user(
            username='stu2', email='stu2@example.edu', password='x', role='student')
        quiet = Attempt.objects.create(
            exam=self.exam, student=second,
            started_at=timezone.now() - timedelta(minutes=5),
            status=Attempt.Status.IN_PROGRESS)
        ProctoringEvent.objects.create(
            attempt=self.attempt, type='MULTIPLE_FACES', severity='high')

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/exams/{self.exam.id}/monitor/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        active = response.data['active_attempts']
        self.assertEqual([a['attempt_id'] for a in active], [self.attempt.id, quiet.id])
        self.assertEqual(active[0]['flag_count'], 2)
        self.assertIn('integrity_score', active[0])
        self.assertTrue(len(response.data['recent_events']) >= 2)

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/exams/{self.exam.id}/monitor/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.other_faculty)
        response = self.client.get(f'/api/exams/{self.exam.id}/monitor/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class RetentionTests(TestCase):
    """NFR-11: evidence + rows auto-expire after the retention window."""

    def test_cleanup_removes_only_expired(self):
        faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        course = Course.objects.create(code='C', name='N', faculty=faculty)
        now = timezone.now()
        exam = Exam.objects.create(
            course=course, title='E',
            start_time=now - timedelta(days=200), end_time=now - timedelta(days=100),
            duration_minutes=60, question_count=1, marks_per_question=1.0,
            is_published=True, created_by=faculty)
        attempt = Attempt.objects.create(
            exam=exam, student=student,
            started_at=now - timedelta(days=100), status=Attempt.Status.SUBMITTED,
            submitted_at=now - timedelta(days=100))
        old = ProctoringEvent.objects.create(
            attempt=attempt, type='TAB_SWITCH', severity='medium', evidence=make_image())
        old_path = old.evidence.path
        ProctoringEvent.objects.filter(pk=old.pk).update(
            timestamp=now - timedelta(days=100))
        fresh = ProctoringEvent.objects.create(
            attempt=attempt, type='TAB_SWITCH', severity='medium')

        result = cleanup_old_proctoring_data()

        self.assertIn('Removed 1 event', result)
        self.assertFalse(ProctoringEvent.objects.filter(pk=old.pk).exists())
        self.assertTrue(ProctoringEvent.objects.filter(pk=fresh.pk).exists())
        import os
        self.assertFalse(os.path.exists(old_path))


class IntegrityScoringTests(TestCase):
    """FR-24 scoring rule as pure unit tests (NFR-17)."""

    def test_no_flags_is_100(self):
        self.assertEqual(compute_integrity_score([]), 100.0)

    def test_weighted_deductions(self):
        self.assertEqual(compute_integrity_score(['low', 'medium', 'high']), 85.0)

    def test_floor_at_zero(self):
        self.assertEqual(compute_integrity_score(['high'] * 20), 0.0)
