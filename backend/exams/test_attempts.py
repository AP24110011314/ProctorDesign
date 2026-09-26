from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from django.utils import timezone
from datetime import timedelta
from .models import Course, Exam, Question, QuestionOption, Attempt, AttemptQuestion, AttemptAnswer
from .attempt_views import generate_randomized_questions

User = get_user_model()


class ExamTakingFlowTests(TestCase):
    """
    Test suite for exam-taking flow (SRS.md FR-13 to FR-19, NFR-14)
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

        # Create course and questions
        self.course = Course.objects.create(
            code='CS101',
            name='Programming',
            faculty=self.faculty
        )

        self.question1 = Question.objects.create(
            course=self.course,
            type='mcq_single',
            text='What is 2 + 2?',
            difficulty='easy',
            marks=1.0,
            created_by=self.faculty
        )
        QuestionOption.objects.create(question=self.question1, text='3', is_correct=False, order=0)
        QuestionOption.objects.create(question=self.question1, text='4', is_correct=True, order=1)

        self.question2 = Question.objects.create(
            course=self.course,
            type='mcq_single',
            text='What is 3 + 3?',
            difficulty='easy',
            marks=1.0,
            created_by=self.faculty
        )
        QuestionOption.objects.create(question=self.question2, text='5', is_correct=False, order=0)
        QuestionOption.objects.create(question=self.question2, text='6', is_correct=True, order=1)

        # Create exam
        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course,
            title='Test Exam',
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=2),
            duration_minutes=60,
            question_count=2,
            marks_per_question=1.0,
            is_published=True,
            created_by=self.faculty
        )

        # Link questions to exam
        from .models import ExamQuestion
        ExamQuestion.objects.create(exam=self.exam, question=self.question1, order=0)
        ExamQuestion.objects.create(exam=self.exam, question=self.question2, order=1)

    def test_student_can_start_exam(self):
        """Test FR-13: Student can start an exam"""
        self.client.force_authenticate(user=self.student)

        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('id', response.data)
        self.assertEqual(response.data['status'], 'in_progress')

    def test_attempt_has_server_authoritative_timer(self):
        """Test NFR-14: Server computes end_time (source of truth for timer)"""
        self.client.force_authenticate(user=self.student)

        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Check timer endpoint
        response = self.client.get(f'/api/attempts/{attempt_id}/check_time/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('remaining_seconds', response.data)
        self.assertIn('server_time', response.data)

        # Verify end_time is server-computed (within 1 second tolerance for timing differences)
        attempt = Attempt.objects.get(id=attempt_id)
        expected_end_time = attempt.started_at + timedelta(minutes=self.exam.duration_minutes)
        time_diff = abs((attempt.end_time - expected_end_time).total_seconds())
        self.assertLess(time_diff, 1.0)  # Within 1 second

    def test_randomized_questions_are_deterministic(self):
        """Test FR-10: Same student gets same question set on refresh (deterministic seeding)"""
        self.client.force_authenticate(user=self.student)

        # Start exam
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Get attempt details twice
        response1 = self.client.get(f'/api/attempts/{attempt_id}/')
        response2 = self.client.get(f'/api/attempts/{attempt_id}/')

        # Question order should be identical
        questions1 = response1.data['questions']
        questions2 = response2.data['questions']

        self.assertEqual(len(questions1), len(questions2))
        for q1, q2 in zip(questions1, questions2):
            self.assertEqual(q1['question_id'], q2['question_id'])
            self.assertEqual(q1['order'], q2['order'])

    def test_autosave_answer(self):
        """Test FR-16: Answers autosave every 15 seconds and on change"""
        self.client.force_authenticate(user=self.student)

        # Start exam
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Save answer
        correct_option = self.question1.options.filter(is_correct=True).first()
        response = self.client.post(
            f'/api/attempts/{attempt_id}/save_answer/',
            {
                'question_id': self.question1.id,
                'selected_option_ids': [correct_option.id],
                'is_visited': True
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify answer was saved
        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question_id=self.question1.id)
        self.assertEqual(answer.selected_option_ids, [correct_option.id])
        self.assertTrue(answer.is_visited)

    def test_mark_for_review(self):
        """Test FR-17: Student can mark question for review"""
        self.client.force_authenticate(user=self.student)

        # Start exam
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Mark question for review
        response = self.client.post(
            f'/api/attempts/{attempt_id}/save_answer/',
            {
                'question_id': self.question1.id,
                'is_marked_for_review': True
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        answer = AttemptAnswer.objects.get(attempt_id=attempt_id, question_id=self.question1.id)
        self.assertTrue(answer.is_marked_for_review)

    def test_submit_exam(self):
        """Test FR-18: Student can submit exam manually"""
        self.client.force_authenticate(user=self.student)

        # Start exam
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Submit
        response = self.client.post(f'/api/attempts/{attempt_id}/submit/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        attempt = Attempt.objects.get(id=attempt_id)
        self.assertEqual(attempt.status, Attempt.Status.SUBMITTED)
        self.assertIsNotNone(attempt.submitted_at)

    def test_cannot_start_unpublished_exam(self):
        """Test FR-12: Students cannot start unpublished exams"""
        self.exam.is_published = False
        self.exam.save()

        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_start_exam_outside_time_window(self):
        """Test FR-12: Students cannot start exam outside time window"""
        # Set exam to be in the past
        self.exam.start_time = timezone.now() - timedelta(days=2)
        self.exam.end_time = timezone.now() - timedelta(days=1)
        self.exam.save()

        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_correct_answers_not_exposed_to_student(self):
        """Test NFR-6: Correct answers never exposed to students"""
        self.client.force_authenticate(user=self.student)

        # Start exam
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Get attempt details
        response = self.client.get(f'/api/attempts/{attempt_id}/')
        questions = response.data['questions']

        # Check that options don't include is_correct field
        for question in questions:
            if question['options']:
                for option in question['options']:
                    self.assertNotIn('is_correct', option)

    def test_student_cannot_update_attempt_directly(self):
        """FR-4: PUT on attempts is faculty/admin only (use save_answer/submit)"""
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        response = self.client.put(
            f'/api/attempts/{attempt_id}/',
            {'status': 'submitted'},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_cannot_patch_attempt_exam(self):
        """FR-4: PATCH cannot re-point an attempt at a different exam"""
        other_exam = Exam.objects.create(
            course=self.course,
            title='Other Exam',
            start_time=timezone.now() - timedelta(hours=1),
            end_time=timezone.now() + timedelta(hours=2),
            duration_minutes=60,
            question_count=2,
            marks_per_question=1.0,
            is_published=True,
            created_by=self.faculty
        )
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        response = self.client.patch(
            f'/api/attempts/{attempt_id}/',
            {'exam': other_exam.id},
            format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Attempt.objects.get(id=attempt_id).exam_id, self.exam.id)

    def test_student_cannot_delete_attempt(self):
        """FR-4: DELETE on attempts is faculty/admin only (blocks delete-and-retake)"""
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        response = self.client.delete(f'/api/attempts/{attempt_id}/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Attempt.objects.filter(id=attempt_id).exists())

    def test_score_hidden_until_results_published(self):
        """FR-28: students see no score until results are published"""
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']

        # Score the attempt directly (grading pipeline lands in Phase 6)
        attempt = Attempt.objects.get(id=attempt_id)
        attempt.score = 8.0
        attempt.save()

        # Unpublished: no score key for the student
        response = self.client.get(f'/api/attempts/{attempt_id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('score', response.data)

        # Published: score visible
        self.exam.results_published = True
        self.exam.save()
        response = self.client.get(f'/api/attempts/{attempt_id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('score', response.data)

    def test_faculty_always_sees_score(self):
        """FR-28 gate applies to students only, not faculty reviewers"""
        self.client.force_authenticate(user=self.student)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        attempt_id = response.data['id']
        attempt = Attempt.objects.get(id=attempt_id)
        attempt.score = 8.0
        attempt.save()

        self.client.force_authenticate(user=self.faculty)
        response = self.client.get(f'/api/attempts/{attempt_id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('score', response.data)


class RandomizationTests(TestCase):
    """
    Test suite for deterministic per-student randomization (SRS.md FR-10).
    Uses a pool of 5 questions with question_count=3 so selection, order,
    and determinism are all observable (a pool equal to the count would
    make these tests vacuous).
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
        self.student_a = User.objects.create_user(
            username='studentA',
            email='studentA@example.edu',
            password='StudentPass123!',
            role='student'
        )
        self.student_b = User.objects.create_user(
            username='studentB',
            email='studentB@example.edu',
            password='StudentPass123!',
            role='student'
        )

        self.course = Course.objects.create(
            code='CS101',
            name='Programming',
            faculty=self.faculty
        )

        from .models import ExamQuestion
        self.pool_ids = []
        for i in range(5):
            q = Question.objects.create(
                course=self.course,
                type='mcq_single',
                text=f'Question {i}?',
                difficulty='easy',
                marks=1.0,
                created_by=self.faculty
            )
            QuestionOption.objects.create(question=q, text='Wrong', is_correct=False, order=0)
            QuestionOption.objects.create(question=q, text='Right', is_correct=True, order=1)
            self.pool_ids.append(q.id)

        now = timezone.now()
        self.exam = Exam.objects.create(
            course=self.course,
            title='Randomized Exam',
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=2),
            duration_minutes=60,
            question_count=3,
            marks_per_question=1.0,
            shuffle_questions=True,
            shuffle_options=True,
            is_published=True,
            created_by=self.faculty
        )
        for order, qid in enumerate(self.pool_ids):
            ExamQuestion.objects.create(exam=self.exam, question_id=qid, order=order)

    def _signature(self, randomized):
        """Comparable snapshot: question order + option order per question."""
        return [
            (rq['question'].id, tuple(rq['shuffled_option_order']))
            for rq in randomized
        ]

    def test_question_count_honored_on_start(self):
        """FR-9/FR-10: attempt draws exactly question_count from the pool"""
        self.client.force_authenticate(user=self.student_a)
        response = self.client.post('/api/attempts/start_exam/', {'exam_id': self.exam.id})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data['questions']), 3)

        attempt_id = response.data['id']
        self.assertEqual(AttemptQuestion.objects.filter(attempt_id=attempt_id).count(), 3)
        self.assertEqual(AttemptAnswer.objects.filter(attempt_id=attempt_id).count(), 3)

    def test_regeneration_is_deterministic(self):
        """FR-10: same (student_id, exam_id) regenerates the identical set"""
        first = self._signature(generate_randomized_questions(self.student_a.id, self.exam))
        second = self._signature(generate_randomized_questions(self.student_a.id, self.exam))
        self.assertEqual(first, second)
        self.assertEqual(len(first), 3)

    def test_different_students_get_different_sets(self):
        """FR-10: different students get different question/order sets"""
        sig_a = self._signature(generate_randomized_questions(self.student_a.id, self.exam))
        sig_b = self._signature(generate_randomized_questions(self.student_b.id, self.exam))
        # 5P3 = 60 possible ordered draws; identical seeds colliding is the bug
        self.assertNotEqual(sig_a, sig_b)

    def test_small_pool_returns_everything(self):
        """FR-10: pool smaller than question_count returns the whole pool"""
        self.exam.question_count = 10
        self.exam.save()
        randomized = generate_randomized_questions(self.student_a.id, self.exam)
        self.assertEqual(len(randomized), 5)

    def test_no_shuffle_keeps_pool_order(self):
        """Shuffle off: deterministic head of pool order, still capped at count"""
        self.exam.shuffle_questions = False
        self.exam.shuffle_options = False
        self.exam.save()
        randomized = generate_randomized_questions(self.student_a.id, self.exam)
        self.assertEqual(
            [rq['question'].id for rq in randomized],
            self.pool_ids[:3]
        )
