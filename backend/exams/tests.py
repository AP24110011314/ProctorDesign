from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from .models import Course, Question, QuestionOption, Exam

User = get_user_model()


class QuestionBankTests(TestCase):
    """
    Test suite for Question Bank functionality (SRS.md FR-6, FR-7, FR-8)
    """

    def setUp(self):
        self.client = APIClient()

        # Create users
        self.faculty = User.objects.create_user(
            username='faculty1',
            email='faculty@example.edu',
            password='FacultyPass123!',
            role='faculty',
            first_name='Test',
            last_name='Faculty'
        )

        self.student = User.objects.create_user(
            username='student1',
            email='student@example.edu',
            password='StudentPass123!',
            role='student',
            first_name='Test',
            last_name='Student'
        )

        # Create course
        self.course = Course.objects.create(
            code='CS101',
            name='Introduction to Programming',
            faculty=self.faculty
        )

    def test_faculty_can_create_mcq_question(self):
        """Test FR-6: Faculty can create questions"""
        self.client.force_authenticate(user=self.faculty)

        question_data = {
            'course': self.course.id,
            'type': 'mcq_single',
            'text': 'What is 2 + 2?',
            'difficulty': 'easy',
            'topic': 'Basic Math',
            'marks': 1.0,
            'options': [
                {'text': '3', 'is_correct': False, 'order': 0},
                {'text': '4', 'is_correct': True, 'order': 1},
                {'text': '5', 'is_correct': False, 'order': 2},
                {'text': '6', 'is_correct': False, 'order': 3},
            ]
        }

        response = self.client.post('/api/questions/', question_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Question.objects.count(), 1)
        self.assertEqual(QuestionOption.objects.count(), 4)

    def test_mcq_must_have_correct_answer(self):
        """Test FR-8: MCQ validation requires correct answer"""
        self.client.force_authenticate(user=self.faculty)

        question_data = {
            'course': self.course.id,
            'type': 'mcq_single',
            'text': 'Invalid question?',
            'difficulty': 'easy',
            'marks': 1.0,
            'options': [
                {'text': 'Option 1', 'is_correct': False, 'order': 0},
                {'text': 'Option 2', 'is_correct': False, 'order': 1},
            ]
        }

        response = self.client.post('/api/questions/', question_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_student_cannot_access_question_bank(self):
        """Test that students cannot access question bank directly"""
        self.client.force_authenticate(user=self.student)
        response = self.client.get('/api/questions/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # DRF pagination returns {'count', 'next', 'previous', 'results'}
        results = response.data.get('results', response.data)
        self.assertEqual(len(results), 0)  # Empty queryset

    def test_correct_answers_hidden_from_students(self):
        """Test NFR-6: Correct answers never exposed to students"""
        # Create question as faculty
        question = Question.objects.create(
            course=self.course,
            type='mcq_single',
            text='Test question',
            difficulty='easy',
            marks=1.0,
            created_by=self.faculty
        )
        QuestionOption.objects.create(question=question, text='Wrong', is_correct=False, order=0)
        QuestionOption.objects.create(question=question, text='Correct', is_correct=True, order=1)

        # Student tries to access (even though they shouldn't via question bank)
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/questions/{question.id}/')

        # Should be empty or forbidden based on queryset filtering
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ExamConfigurationTests(TestCase):
    """
    Test suite for Exam Configuration (SRS.md FR-9 to FR-12)
    """

    def setUp(self):
        self.client = APIClient()

        self.faculty = User.objects.create_user(
            username='faculty1',
            email='faculty@example.edu',
            password='FacultyPass123!',
            role='faculty',
            first_name='Test',
            last_name='Faculty'
        )

        self.student = User.objects.create_user(
            username='student1',
            email='student@example.edu',
            password='StudentPass123!',
            role='student'
        )

        self.course = Course.objects.create(
            code='CS101',
            name='Programming',
            faculty=self.faculty
        )

    def test_faculty_can_create_exam(self):
        """Test FR-9: Faculty can create exams"""
        self.client.force_authenticate(user=self.faculty)

        exam_data = {
            'course': self.course.id,
            'title': 'Midterm Exam',
            'start_time': '2026-10-01T10:00:00Z',
            'end_time': '2026-10-01T12:00:00Z',
            'duration_minutes': 60,
            'question_count': 20,
            'marks_per_question': 1.0,
            'negative_marking': False,
            'shuffle_questions': True,
            'shuffle_options': True,
            'proctoring_mode': 'basic'
        }

        response = self.client.post('/api/exams/', exam_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Exam.objects.count(), 1)

    def test_student_cannot_create_exam(self):
        """Test FR-9: Students cannot create exams"""
        self.client.force_authenticate(user=self.student)

        exam_data = {
            'course': self.course.id,
            'title': 'Unauthorized Exam',
            'start_time': '2026-10-01T10:00:00Z',
            'end_time': '2026-10-01T12:00:00Z',
            'duration_minutes': 60,
            'question_count': 20,
            'marks_per_question': 1.0
        }

        response = self.client.post('/api/exams/', exam_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_exam_publish_unpublish(self):
        """Test FR-12: Publish/unpublish exam"""
        self.client.force_authenticate(user=self.faculty)

        exam = Exam.objects.create(
            course=self.course,
            title='Test Exam',
            start_time='2026-10-01T10:00:00Z',
            end_time='2026-10-01T12:00:00Z',
            duration_minutes=60,
            question_count=10,
            marks_per_question=1.0,
            created_by=self.faculty,
            is_published=False
        )

        # Publish
        response = self.client.post(f'/api/exams/{exam.id}/publish/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exam.refresh_from_db()
        self.assertTrue(exam.is_published)

        # Unpublish
        response = self.client.post(f'/api/exams/{exam.id}/unpublish/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exam.refresh_from_db()
        self.assertFalse(exam.is_published)

    def test_student_only_sees_published_exams(self):
        """Test FR-12: Students can only see published exams"""
        # Create published and unpublished exams
        published_exam = Exam.objects.create(
            course=self.course,
            title='Published Exam',
            start_time='2026-10-01T10:00:00Z',
            end_time='2026-10-01T12:00:00Z',
            duration_minutes=60,
            question_count=10,
            marks_per_question=1.0,
            is_published=True
        )

        unpublished_exam = Exam.objects.create(
            course=self.course,
            title='Unpublished Exam',
            start_time='2026-10-01T14:00:00Z',
            end_time='2026-10-01T16:00:00Z',
            duration_minutes=60,
            question_count=10,
            marks_per_question=1.0,
            is_published=False
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get('/api/exams/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # DRF pagination returns {'count', 'next', 'previous', 'results'}
        results = response.data.get('results', response.data)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['title'], 'Published Exam')


class AccessControlRegressionTests(TestCase):
    """
    Regression tests for RBAC holes (SRS.md FR-4, NFR-5) and the
    student exam-detail question leak (NFR-6).
    """

    def setUp(self):
        self.client = APIClient()

        self.faculty = User.objects.create_user(
            username='faculty1',
            email='faculty@example.edu',
            password='FacultyPass123!',
            role='faculty',
            first_name='Test',
            last_name='Faculty'
        )

        self.student = User.objects.create_user(
            username='student1',
            email='student@example.edu',
            password='StudentPass123!',
            role='student'
        )

        self.course = Course.objects.create(
            code='CS101',
            name='Programming',
            faculty=self.faculty
        )

        self.exam = Exam.objects.create(
            course=self.course,
            title='Published Exam',
            start_time='2026-10-01T10:00:00Z',
            end_time='2026-10-01T12:00:00Z',
            duration_minutes=60,
            question_count=10,
            marks_per_question=1.0,
            is_published=True,
            created_by=self.faculty
        )

    def test_student_cannot_update_course(self):
        """FR-4: PUT on courses is faculty/admin only"""
        self.client.force_authenticate(user=self.student)
        response = self.client.put(
            f'/api/courses/{self.course.id}/',
            {'code': 'CS101', 'name': 'Hacked', 'description': ''},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_cannot_patch_course(self):
        """FR-4: PATCH on courses is faculty/admin only"""
        self.client.force_authenticate(user=self.student)
        response = self.client.patch(
            f'/api/courses/{self.course.id}/',
            {'name': 'Hacked'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_cannot_delete_course(self):
        """FR-4: DELETE on courses is faculty/admin only"""
        self.client.force_authenticate(user=self.student)
        response = self.client.delete(f'/api/courses/{self.course.id}/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Course.objects.filter(id=self.course.id).exists())

    def test_student_cannot_patch_exam(self):
        """FR-4: PATCH on exams is faculty/admin only (e.g. flipping results_published)"""
        self.client.force_authenticate(user=self.student)
        response = self.client.patch(
            f'/api/exams/{self.exam.id}/',
            {'results_published': True},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.exam.refresh_from_db()
        self.assertFalse(self.exam.results_published)

    def test_student_cannot_patch_question(self):
        """FR-4: PATCH on questions is faculty/admin only"""
        question = Question.objects.create(
            course=self.course,
            type='mcq_single',
            text='What is 2 + 2?',
            created_by=self.faculty
        )
        self.client.force_authenticate(user=self.student)
        response = self.client.patch(
            f'/api/questions/{question.id}/',
            {'text': 'Hacked?'},
            format='json'
        )
        # 403 from the role guard (404 would also be acceptable via empty
        # student queryset, but the explicit guard must win)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_exam_detail_hides_questions(self):
        """NFR-6: student exam detail must not include question texts"""
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/exams/{self.exam.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('exam_questions', response.data)

    def test_faculty_exam_detail_keeps_questions(self):
        """Faculty preview path still returns full exam configuration"""
        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/exams/{self.exam.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('exam_questions', response.data)
