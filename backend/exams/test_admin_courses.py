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
    Assigned faculty is free text (any name); it links the faculty login
    only when the typed name matches an active faculty account.
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
            code='CS101', name='Programming',
            faculty=self.faculty, faculty_name='Test Faculty',
        )

    # -- admin happy paths -------------------------------------------------

    def test_admin_can_create_course_with_typed_faculty_name(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': 'CS102', 'name': 'Data Structures',
            'description': 'Intro DS', 'faculty_name': 'Test Faculty',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(code='CS102')
        self.assertEqual(course.faculty_name, 'Test Faculty')
        # Typed name matched the registered faculty → login linked.
        self.assertEqual(course.faculty, self.faculty)
        self.assertEqual(response.data['linked_faculty']['email'], 'faculty@example.edu')
        self.assertTrue(course.is_active)
        self.assertTrue(AuditLog.objects.filter(
            action=AuditLog.Action.COURSE_CREATE, target_id=course.id).exists())

    def test_admin_can_create_course_with_any_name_label_only(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': 'CS103', 'name': 'Guest Lecture',
            'faculty_name': 'Dr. Visiting Scholar',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(code='CS103')
        self.assertEqual(course.faculty_name, 'Dr. Visiting Scholar')
        self.assertIsNone(course.faculty)
        self.assertIsNone(response.data['linked_faculty'])

    def test_faculty_name_is_required(self):
        self.client.force_authenticate(user=self.admin)
        for bad in ('', '   '):
            response = self.client.post('/api/admin/courses/', {
                'code': 'CS104', 'name': 'No Owner', 'faculty_name': bad,
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('faculty_name', response.data)

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

    def test_admin_can_edit_course_and_reassign_by_typing_name(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/admin/courses/{self.course.id}/', {
            'name': 'Programming I', 'faculty_name': 'faculty2',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.course.refresh_from_db()
        self.assertEqual(self.course.name, 'Programming I')
        self.assertEqual(self.course.faculty_name, 'faculty2')
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
        payload = {'code': 'CS999', 'name': 'Nope', 'faculty_name': 'Nobody'}
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
                'code': code, 'name': 'Dup', 'faculty_name': 'Someone',
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('code', response.data)

    def test_code_is_trimmed_and_name_required(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': '  CS105  ', 'name': '  Algorithms  ',
            'faculty_name': '  Test Faculty  ',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(pk=response.data['id'])
        self.assertEqual(course.code, 'CS105')
        self.assertEqual(course.faculty_name, 'Test Faculty')
        self.assertEqual(course.faculty, self.faculty)

        response = self.client.post('/api/admin/courses/', {
            'code': 'CS106', 'name': '   ', 'faculty_name': 'Someone',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_names_matching_non_faculty_or_inactive_accounts_stay_labels(self):
        # Role + active checks survive inside the name resolution: only
        # active faculty logins ever get linked.
        self.client.force_authenticate(user=self.admin)
        for label in ('student1', 'student@example.edu', 'admin1', 'faculty3',
                       'faculty3@example.edu'):
            response = self.client.post('/api/admin/courses/', {
                'code': f'CX{abs(hash(label)) % 10000}',
                'name': 'Label only', 'faculty_name': label,
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            course = Course.objects.get(pk=response.data['id'])
            self.assertEqual(course.faculty_name, label)
            self.assertIsNone(course.faculty)
            self.assertIsNone(response.data['linked_faculty'])

    def test_name_matching_by_email_links_faculty(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/admin/courses/', {
            'code': 'CS107', 'name': 'Email Match',
            'faculty_name': 'FACULTY2@EXAMPLE.EDU',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        course = Course.objects.get(code='CS107')
        self.assertEqual(course.faculty, self.faculty2)

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
            'faculty_name': 'faculty2',
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

    def test_admin_can_create_new_faculty(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'username': 'newprof',
            'email': 'newprof@proctox.edu',
            'password': 'SecurePass123!',
            'first_name': 'Alan',
            'last_name': 'Turing',
        }
        response = self.client.post('/api/admin/faculty/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['username'], 'newprof')
        self.assertEqual(response.data['role'], 'faculty')

        new_user = User.objects.get(username='newprof')
        self.assertEqual(new_user.role, User.Role.FACULTY)
        self.assertTrue(new_user.check_password('SecurePass123!'))

        # Verify audit log recorded
        entry = AuditLog.objects.filter(action=AuditLog.Action.FACULTY_CREATE, target_id=new_user.id).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.actor, self.admin)

    def test_admin_create_faculty_validations(self):
        self.client.force_authenticate(user=self.admin)
        # Duplicate username
        res1 = self.client.post('/api/admin/faculty/', {
            'username': 'faculty1',
            'email': 'unique@proctox.edu',
            'password': 'Password123!',
        }, format='json')
        self.assertEqual(res1.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', res1.data)

        # Duplicate email
        res2 = self.client.post('/api/admin/faculty/', {
            'username': 'unique_user',
            'email': 'faculty@example.edu',
            'password': 'Password123!',
        }, format='json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', res2.data)

        # Short password
        res3 = self.client.post('/api/admin/faculty/', {
            'username': 'unique_user2',
            'email': 'unique2@proctox.edu',
            'password': 'short',
        }, format='json')
        self.assertEqual(res3.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', res3.data)

    def test_non_admin_cannot_create_faculty(self):
        payload = {
            'username': 'sneakyperson',
            'email': 'sneaky@proctox.edu',
            'password': 'Password123!',
        }
        for user in (self.faculty, self.student):
            self.client.force_authenticate(user=user)
            response = self.client.post('/api/admin/faculty/', payload, format='json')
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

