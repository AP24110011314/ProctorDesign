from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from system.models import AuditLog
from .models import Course, Exam

User = get_user_model()


class AdminCourseTests(TestCase):
    """
    Admin course management: create/edit/list via /api/admin/courses/.
    No hard delete — deactivation via is_active instead.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username='admin1', email='admin@example.edu',
            password='AdminPass123!', role='admin',
        )
        self.faculty = User.objects.create_user(
            username='faculty1', email='faculty@example.edu',
            password='FacultyPass123!', role='faculty',
            first_name='Test', last_name='Faculty',
        )
        self.faculty2 = User.objects.create_user(
            username='faculty2', email='faculty2@example.edu',
            password='FacultyPass123!', role='faculty',
        )
        self.student = User.objects.create_user(
            username='student1', email='student@example.edu',
            password='StudentPass123!', role='student',
        )
        self.inactive_faculty = User.objects.create_user(
            username='faculty3', email='faculty3@example.edu',
            password='FacultyPass123!', role='faculty', is_active=False,
        )
        self.course = Course.objects.create(
            code='CS101', name='Programming', faculty=self.faculty,
        )

    # -- admin happy paths -------------------------------------------------

    def test_admin_can_create_course(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': 'CS102', 'name': 'Data Structures',
            'description': 'Intro DS', 'faculty': self.faculty.id,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(code='CS102')
        self.assertEqual(course.faculty, self.faculty)
        self.assertTrue(course.is_active)
        self.assertTrue(AuditLog.objects.filter(
            action=AuditLog.Action.COURSE_CREATE, target_id=course.id).exists())

    def test_admin_can_list_search_and_filter_courses(self):
        Course.objects.create(code='MA101', name='Calculus', is_active=False)
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/admin/courses/', format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = [c['code'] for c in response.data['results']]
        self.assertIn('CS101', codes)
        self.assertIn('MA101', codes)

        response = self.client.get('/api/admin/courses/?q=calc', format='json')
        codes = [c['code'] for c in response.data['results']]
        self.assertEqual(codes, ['MA101'])

        response = self.client.get('/api/admin/courses/?is_active=false', format='json')
        codes = [c['code'] for c in response.data['results']]
        self.assertEqual(codes, ['MA101'])

    def test_admin_can_edit_course_and_reassign_faculty(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/admin/courses/{self.course.id}/', {
            'name': 'Programming I', 'faculty': self.faculty2.id,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.course.refresh_from_db()
        self.assertEqual(self.course.name, 'Programming I')
        self.assertEqual(self.course.faculty, self.faculty2)

    def test_admin_can_deactivate_and_reactivate(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/admin/courses/{self.course.id}/', {
            'is_active': False,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Course.objects.get(pk=self.course.pk).is_active)
        self.assertTrue(AuditLog.objects.filter(
            action=AuditLog.Action.COURSE_DEACTIVATE,
            target_id=self.course.id).exists())

        response = self.client.patch(f'/api/admin/courses/{self.course.id}/', {
            'is_active': True,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(Course.objects.get(pk=self.course.pk).is_active)
        self.assertTrue(AuditLog.objects.filter(
            action=AuditLog.Action.COURSE_REACTIVATE,
            target_id=self.course.id).exists())

    def test_courses_cannot_be_hard_deleted(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f'/api/admin/courses/{self.course.id}/')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Course.objects.filter(pk=self.course.pk).exists())

    def test_admin_faculty_options_lists_only_active_faculty(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/admin/faculty/', format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        usernames = [f['username'] for f in response.data]
        self.assertIn('faculty1', usernames)
        self.assertIn('faculty2', usernames)
        self.assertNotIn('student1', usernames)
        self.assertNotIn('faculty3', usernames)  # inactive
        self.assertNotIn('admin1', usernames)

    # -- RBAC ----------------------------------------------------------------

    def test_faculty_and_student_get_403(self):
        payload = {'code': 'CS999', 'name': 'Nope'}
        for user in (self.faculty, self.student):
            self.client.force_authenticate(user=user)
            self.assertEqual(
                self.client.get('/api/admin/courses/', format='json').status_code,
                status.HTTP_403_FORBIDDEN)
            self.assertEqual(
                self.client.get(f'/api/admin/courses/{self.course.id}/').status_code,
                status.HTTP_403_FORBIDDEN)
            self.assertEqual(
                self.client.post('/api/admin/courses/', payload, format='json').status_code,
                status.HTTP_403_FORBIDDEN)
            self.assertEqual(
                self.client.patch(
                    f'/api/admin/courses/{self.course.id}/',
                    {'name': 'Nope'}, format='json').status_code,
                status.HTTP_403_FORBIDDEN)
            self.assertEqual(
                self.client.get('/api/admin/faculty/', format='json').status_code,
                status.HTTP_403_FORBIDDEN)

    # -- validation ------------------------------------------------------------

    def test_duplicate_code_rejected_case_insensitive(self):
        self.client.force_authenticate(user=self.admin)
        for code in ('CS101', 'cs101', '  Cs101  '):
            response = self.client.post('/api/admin/courses/', {
                'code': code, 'name': 'Dup',
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('code', response.data)

    def test_code_is_trimmed_and_name_required(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': '  CS103  ', 'name': '  Algorithms  ',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(pk=response.data['id'])
        self.assertEqual(course.code, 'CS103')

        response = self.client.post('/api/admin/courses/', {
            'code': 'CS104', 'name': '   ',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_assigning_non_faculty_or_inactive_faculty_rejected(self):
        self.client.force_authenticate(user=self.admin)
        for user_id in (self.student.id, self.inactive_faculty.id, self.admin.id):
            response = self.client.post('/api/admin/courses/', {
                'code': f'CX{user_id}', 'name': 'Bad assign', 'faculty': user_id,
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('faculty', response.data)

    # -- deactivation semantics -------------------------------------------------

    def test_deactivated_course_hidden_from_faculty_options_but_old_exam_loads(self):
        exam = Exam.objects.create(
            course=self.course, title='Midterm',
            start_time='2026-10-01T10:00:00Z', end_time='2026-10-01T12:00:00Z',
            duration_minutes=60, question_count=10, marks_per_question=1.0,
            created_by=self.faculty,
        )
        self.course.is_active = False
        self.course.save()

        # Faculty course dropdown: deactivated course no longer listed
        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/courses/', format='json')
        payload = response.data
        items = payload['results'] if isinstance(payload, dict) else payload
        ids = [c['id'] for c in items]
        self.assertNotIn(self.course.id, ids)

        # Existing exam still loads for the owning faculty
        response = self.client.get(f'/api/exams/{exam.id}/', format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # ... but no new exam or question can target the deactivated course
        exam_data = {
            'course': self.course.id, 'title': 'New exam',
            'start_time': '2026-10-01T10:00:00Z', 'end_time': '2026-10-01T12:00:00Z',
            'duration_minutes': 60, 'question_count': 10,
        }
        response = self.client.post('/api/exams/', exam_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('course', response.data)

        question_data = {
            'course': self.course.id, 'type': 'mcq_single', 'text': 'Q?',
            'difficulty': 'easy', 'marks': 1.0,
            'options': [
                {'text': 'A', 'is_correct': True, 'order': 0},
                {'text': 'B', 'is_correct': False, 'order': 1},
            ],
        }
        response = self.client.post('/api/questions/', question_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('course', response.data)

    def test_reassigning_faculty_keeps_existing_exams(self):
        exam = Exam.objects.create(
            course=self.course, title='Midterm',
            start_time='2026-10-01T10:00:00Z', end_time='2026-10-01T12:00:00Z',
            duration_minutes=60, question_count=10, marks_per_question=1.0,
            created_by=self.faculty,
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/admin/courses/{self.course.id}/', {
            'faculty': self.faculty2.id,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Exam row is untouched (still belongs to the same course)
        exam.refresh_from_db()
        self.assertEqual(exam.course_id, self.course.id)

        # New owning faculty can see it; previous owner no longer does
        self.client.force_authenticate(user=self.faculty2)
        response = self.client.get(f'/api/exams/{exam.id}/', format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/exams/{exam.id}/', format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
