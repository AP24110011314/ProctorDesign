from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from rest_framework import status
from .models import (
    Course, Exam, ExamQuestion, Question, QuestionOption,
    Attempt, AttemptAnswer,
)

User = get_user_model()


class AttemptFilterAndResultTests(TestCase):
    """?exam_id filter + student result-detail endpoint (UI_UX_SPEC §4.5)."""

    def setUp(self):
        self.client = APIClient()
        self.faculty = User.objects.create_user(
            username='fac', email='fac@example.edu', password='x', role='faculty')
        self.student = User.objects.create_user(
            username='stu', email='stu@example.edu', password='x', role='student')
        self.other_student = User.objects.create_user(
            username='stu2', email='stu2@example.edu', password='x', role='student')
        self.course = Course.objects.create(code='C', name='N', faculty=self.faculty)

        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='E1',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=60, question_count=1, marks_per_question=2.0,
            is_published=True, created_by=self.faculty,
        )
        self.exam2 = Exam.objects.create(
            course=self.course, title='E2',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=60, question_count=1, marks_per_question=2.0,
            is_published=True, created_by=self.faculty,
        )
        self.question = Question.objects.create(
            course=self.course, type='mcq_single', text='2+2?',
            difficulty='easy', marks=1.0, created_by=self.faculty)
        self.opt_wrong = QuestionOption.objects.create(
            question=self.question, text='3', is_correct=False, order=0)
        self.opt_right = QuestionOption.objects.create(
            question=self.question, text='4', is_correct=True, order=1)
        ExamQuestion.objects.create(exam=self.exam, question=self.question, order=0)

        self.attempt = Attempt.objects.create(
            exam=self.exam, student=self.student, status=Attempt.Status.SUBMITTED,
            started_at=now - timedelta(minutes=30), submitted_at=now, score=2.0)
        AttemptAnswer.objects.create(
            attempt=self.attempt, question=self.question,
            selected_option_ids=[self.opt_right.id],
            is_correct=True, marks_awarded=2.0)
        # Same student, other exam -> filter must exclude it
        Attempt.objects.create(
            exam=self.exam2, student=self.student, status=Attempt.Status.SUBMITTED,
            started_at=now - timedelta(minutes=30), submitted_at=now, score=0.0)

    def test_exam_id_filter_faculty(self):
        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/attempts/?exam_id={self.exam.id}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {a['exam'] for a in response.data['results']}
        self.assertEqual(ids, {self.exam.id})

    def test_exam_id_filter_student_scoped_to_self(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/?exam_id={self.exam.id}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for a in response.data['results']:
            self.assertEqual(a['student'], self.student.id)

    def test_result_unpublished_is_neutral_403(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/{self.attempt.id}/result/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['error']['code'], 'not_published')
        self.assertNotIn('score', response.data)

    def test_result_other_student_forbidden(self):
        # Scoped queryset 404s before the view's ownership check: either way, no data leaks.
        self.client.force_authenticate(user=self.other_student)
        response = self.client.get(f'/api/attempts/{self.attempt.id}/result/')
        self.assertIn(response.status_code,
                      (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    def test_result_published_breakdown_no_answer_leak(self):
        self.exam.results_published = True
        self.exam.save(update_fields=['results_published'])
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/{self.attempt.id}/result/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(str(response.data['score']), '2.00')
        self.assertEqual(len(response.data['items']), 1)
        item = response.data['items'][0]
        self.assertTrue(item['is_correct'])
        self.assertEqual(item['selected_options'], ['4'])
        body = str(response.data)
        self.assertNotIn('model_answer', body)
        for key in ('is_correct_option', 'correct_option', 'correct_answer'):
            self.assertNotIn(key, body)
