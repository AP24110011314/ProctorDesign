from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from rest_framework import status
from rest_framework.test import APIClient

from exams.models import (
    Attempt, AttemptAnswer, Course, Exam, ExamQuestion, Question, QuestionOption,
)
from grading.services import grade_mcq_answer

User = get_user_model()


class AutoGradingTests(TestCase):
    """Unit tests for MCQ auto-grading rules (SRS.md FR-26, NFR-17)."""

    def setUp(self):
        self.faculty = User.objects.create_user(
            username='faculty1', email='faculty@example.edu',
            password='FacultyPass123!', role='faculty',
        )
        self.course = Course.objects.create(code='CS101', name='Programming', faculty=self.faculty)
        self.exam = Exam.objects.create(
            course=self.course, title='Plain Exam',
            start_time=timezone.now() - timedelta(hours=1),
            end_time=timezone.now() + timedelta(hours=2),
            duration_minutes=60, question_count=10, marks_per_question=2.0,
            created_by=self.faculty,
        )
        self.neg_exam = Exam.objects.create(
            course=self.course, title='Negative Exam',
            start_time=timezone.now() - timedelta(hours=1),
            end_time=timezone.now() + timedelta(hours=2),
            duration_minutes=60, question_count=10, marks_per_question=2.0,
            negative_marking=True, negative_marks_value=Decimal('0.50'),
            created_by=self.faculty,
        )
        self.single = Question.objects.create(
            course=self.course, type='mcq_single', text='2+2?',
            created_by=self.faculty,
        )
        self.opt_wrong = QuestionOption.objects.create(
            question=self.single, text='3', is_correct=False, order=0)
        self.opt_right = QuestionOption.objects.create(
            question=self.single, text='4', is_correct=True, order=1)

        self.multi = Question.objects.create(
            course=self.course, type='mcq_multi', text='Pick evens',
            created_by=self.faculty,
        )
        self.m_a = QuestionOption.objects.create(question=self.multi, text='2', is_correct=True, order=0)
        self.m_b = QuestionOption.objects.create(question=self.multi, text='3', is_correct=False, order=1)
        self.m_c = QuestionOption.objects.create(question=self.multi, text='4', is_correct=True, order=2)

    def test_exact_single_match_earns_full_marks(self):
        correct, marks = grade_mcq_answer(self.single, [self.opt_right.id], self.exam)
        self.assertTrue(correct)
        self.assertEqual(marks, Decimal('2.0'))

    def test_wrong_single_earns_zero_without_negative(self):
        correct, marks = grade_mcq_answer(self.single, [self.opt_wrong.id], self.exam)
        self.assertFalse(correct)
        self.assertEqual(marks, Decimal('0'))

    def test_wrong_single_penalised_with_negative_marking(self):
        correct, marks = grade_mcq_answer(self.single, [self.opt_wrong.id], self.neg_exam)
        self.assertFalse(correct)
        self.assertEqual(marks, Decimal('-0.50'))

    def test_blank_answer_never_penalised(self):
        correct, marks = grade_mcq_answer(self.single, [], self.neg_exam)
        self.assertFalse(correct)
        self.assertEqual(marks, Decimal('0'))

    def test_multi_exact_set_earns_full_marks(self):
        correct, marks = grade_mcq_answer(self.multi, [self.m_a.id, self.m_c.id], self.exam)
        self.assertTrue(correct)
        self.assertEqual(marks, Decimal('2.0'))

    def test_multi_subset_earns_zero(self):
        """No partial credit per the documented scoring rule."""
        correct, marks = grade_mcq_answer(self.multi, [self.m_a.id], self.exam)
        self.assertFalse(correct)
        self.assertEqual(marks, Decimal('0'))

    def test_multi_superset_earns_zero(self):
        correct, marks = grade_mcq_answer(
            self.multi, [self.m_a.id, self.m_b.id, self.m_c.id], self.exam)
        self.assertFalse(correct)
        self.assertEqual(marks, Decimal('0'))


class GradingFlowTests(TestCase):
    """End-to-end: submit auto-grades, queue lists, faculty grades, results publish (FR-26–28)."""

    def setUp(self):
        self.client = APIClient()
        self.faculty = User.objects.create_user(
            username='faculty1', email='faculty@example.edu',
            password='FacultyPass123!', role='faculty',
            first_name='Test', last_name='Faculty',
        )
        self.student = User.objects.create_user(
            username='student1', email='student@example.edu',
            password='StudentPass123!', role='student',
            first_name='Test', last_name='Student',
        )
        self.other_faculty = User.objects.create_user(
            username='faculty2', email='faculty2@example.edu',
            password='FacultyPass123!', role='faculty',
        )
        self.course = Course.objects.create(code='CS101', name='Programming', faculty=self.faculty)

        self.q_single = Question.objects.create(
            course=self.course, type='mcq_single', text='2+2?',
            created_by=self.faculty)
        self.s_wrong = QuestionOption.objects.create(
            question=self.q_single, text='3', is_correct=False, order=0)
        self.s_right = QuestionOption.objects.create(
            question=self.q_single, text='4', is_correct=True, order=1)

        self.q_short = Question.objects.create(
            course=self.course, type='short_answer', text='Explain photosynthesis',
            model_answer='Photosynthesis converts light energy into chemical energy in plants',
            created_by=self.faculty)

        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course, title='Graded Exam',
            start_time=now - timedelta(hours=1), end_time=now + timedelta(hours=2),
            duration_minutes=60, question_count=2, marks_per_question=2.0,
            is_published=True, created_by=self.faculty,
        )
        ExamQuestion.objects.create(exam=self.exam, question=self.q_single, order=0)
        ExamQuestion.objects.create(exam=self.exam, question=self.q_short, order=1)

    def _submitted_attempt(self):
        """Student starts, answers (single correct, short text), submits."""
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']
        self.client.post(f'/api/attempts/{attempt_id}/save_answer/', {
            'question_id': self.q_single.id,
            'selected_option_ids': [self.s_right.id],
            'is_visited': True,
        }, format='json')
        self.client.post(f'/api/attempts/{attempt_id}/save_answer/', {
            'question_id': self.q_short.id,
            'text_answer': 'Plants use light energy to make food from water and air',
            'is_visited': True,
        }, format='json')
        response = self.client.post(f'/api/attempts/{attempt_id}/submit/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return attempt_id

    def _results(self, response):
        return response.data.get('results', response.data)

    def test_submit_auto_grades_objective_only(self):
        """FR-26: MCQ graded on submit; short answer left for the queue."""
        attempt_id = self._submitted_attempt()
        attempt = Attempt.objects.get(id=attempt_id)
        self.assertEqual(attempt.score, Decimal('2.00'))

        short = AttemptAnswer.objects.get(attempt=attempt, question=self.q_short)
        self.assertIsNone(short.marks_awarded)
        single = AttemptAnswer.objects.get(attempt=attempt, question=self.q_single)
        self.assertTrue(single.is_correct)
        self.assertIsNone(single.graded_by)

    def test_queue_lists_only_ungraded_shorts(self):
        """FR-27: faculty sees the short answer; students forbidden; scoped."""
        attempt_id = self._submitted_attempt()

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get('/api/grading/answers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = self._results(response)
        self.assertEqual(len(items), 1)
        self.assertIn('model_answer', items[0])
        self.assertNotIn('is_correct', items[0])

        self.client.force_authenticate(user=self.student)
        response = self.client.get('/api/grading/answers/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.other_faculty)
        response = self.client.get('/api/grading/answers/')
        self.assertEqual(self._results(response), [])

        # exam_id filter
        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/grading/answers/?exam_id={self.exam.id + 999}')
        self.assertEqual(self._results(response), [])

    def test_grade_assigns_marks_and_recomputes(self):
        """FR-27: valid marks saved with grader + feedback; attempt total updated."""
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '1.50', 'grading_feedback': 'Missing chlorophyll detail',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        answer.refresh_from_db()
        self.assertEqual(answer.marks_awarded, Decimal('1.50'))
        self.assertEqual(answer.grading_feedback, 'Missing chlorophyll detail')
        self.assertEqual(answer.graded_by, self.faculty)
        self.assertEqual(Attempt.objects.get(id=attempt_id).score, Decimal('3.50'))

        # Queue drains after grading
        response = self.client.get('/api/grading/answers/')
        self.assertEqual(self._results(response), [])

    def test_grade_rejects_out_of_range(self):
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '5.00',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '-1.00',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_queue_ungraded_only_accepts_boolean_strings(self):
        """Regression: clients sending ungraded_only=true must get the filtered queue."""
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        for param in ('1', 'true', 'True'):
            response = self.client.get(f'/api/grading/answers/?ungraded_only={param}')
            self.assertEqual(len(self._results(response)), 1)

        self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '1.50',
        }, format='json')

        for param in ('1', 'true'):
            response = self.client.get(f'/api/grading/answers/?ungraded_only={param}')
            self.assertEqual(self._results(response), [])

        for param in ('0', 'false'):
            response = self.client.get(f'/api/grading/answers/?ungraded_only={param}')
            self.assertEqual(len(self._results(response)), 1)

    def test_grade_can_correct_already_graded_answer(self):
        """Regression: re-grading a graded answer overwrites instead of 404."""
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '1.50',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '2.00', 'grading_feedback': 'On re-read: full marks',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        answer.refresh_from_db()
        self.assertEqual(answer.marks_awarded, Decimal('2.00'))
        self.assertEqual(Attempt.objects.get(id=attempt_id).score, Decimal('4.00'))

    def test_student_cannot_grade(self):
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.student)
        response = self.client.post(f'/api/grading/answers/{answer.id}/grade/', {
            'marks_awarded': '2.00',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_publish_unpublish_gates_student_score(self):
        """FR-28: publish opens the gate verified end-to-end."""
        attempt_id = self._submitted_attempt()

        self.client.force_authenticate(user=self.student)
        response = self.client.post(f'/api/grading/exams/{self.exam.id}/publish/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/exams/{self.exam.id}/publish/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.exam.refresh_from_db()
        self.assertTrue(self.exam.results_published)

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/attempts/{attempt_id}/')
        self.assertIn('score', response.data)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/exams/{self.exam.id}/unpublish/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_export_csv(self):
        """FR-29: CSV export with score + integrity columns."""
        self._submitted_attempt()

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/grading/exams/{self.exam.id}/export/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('text/csv', response['Content-Type'])
        content = response.content.decode()
        self.assertIn('student_username', content)
        self.assertIn('integrity_score', content)
        self.assertIn('student1', content)

        response = self.client.get(f'/api/grading/exams/{self.exam.id}/export/?filetype=pdf')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertTrue(response.content.startswith(b'%PDF'))

        response = self.client.get(f'/api/grading/exams/{self.exam.id}/export/?filetype=xlsx')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/grading/exams/{self.exam.id}/export/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_suggest_disabled_by_default(self):
        """Stretch goal stays off unless explicitly enabled; never writes."""
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/answers/{answer.id}/suggest/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error']['code'], 'assist_unavailable')

    @override_settings(AI_ASSIST_GRADING_ENABLED=True)
    def test_suggest_returns_readonly_hint_when_enabled(self):
        attempt_id = self._submitted_attempt()
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question=self.q_short)

        self.client.force_authenticate(user=self.faculty)
        response = self.client.post(f'/api/grading/answers/{answer.id}/suggest/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['assist_only'])
        self.assertGreaterEqual(response.data['suggested_marks'], 0)
        self.assertLessEqual(response.data['suggested_marks'], 2.0)
        self.assertIn('matched_keywords', response.data)

        answer.refresh_from_db()
        self.assertIsNone(answer.marks_awarded)
