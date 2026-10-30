"""
Seed demo accounts and initial test data for ProctoX.
Creates/updates:
1. Admin user: admin@proctox.edu / AdminPass123!
2. Faculty user: faculty@proctox.edu / FacultyPass123!
3. Student user: student@proctox.edu / StudentPass123!
Also ensures sample courses and exams are available for demonstration.
"""
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone


class Command(BaseCommand):
    help = 'Seeds demo users and initial courses/exams for local testing and demonstration'

    def handle(self, *args, **options):
        User = get_user_model()
        from exams.models import Course, Question, QuestionOption, Exam, ExamQuestion

        # 1. Admin Account
        admin_email = 'admin@proctox.edu'
        admin_pass = 'AdminPass123!'
        admin_user = User.objects.filter(email__iexact=admin_email).first()
        if not admin_user:
            admin_user = User.objects.create_superuser(
                username='admin',
                email=admin_email,
                password=admin_pass,
                role=User.Role.ADMIN,
                first_name='System',
                last_name='Administrator',
            )
            self.stdout.write(self.style.SUCCESS(f'Created Admin user: {admin_email}'))
        else:
            admin_user.role = User.Role.ADMIN
            admin_user.is_superuser = True
            admin_user.is_staff = True
            admin_user.set_password(admin_pass)
            admin_user.save()
            self.stdout.write(self.style.SUCCESS(f'Updated Admin user: {admin_email}'))

        # 2. Faculty Account
        faculty_email = 'faculty@proctox.edu'
        faculty_pass = 'FacultyPass123!'
        faculty_user = User.objects.filter(email__iexact=faculty_email).first()
        if not faculty_user:
            faculty_user = User.objects.create_user(
                username='faculty',
                email=faculty_email,
                password=faculty_pass,
                role=User.Role.FACULTY,
                first_name='Dr. Alan',
                last_name='Turing',
            )
            self.stdout.write(self.style.SUCCESS(f'Created Faculty user: {faculty_email}'))
        else:
            faculty_user.role = User.Role.FACULTY
            faculty_user.set_password(faculty_pass)
            faculty_user.save()
            self.stdout.write(self.style.SUCCESS(f'Updated Faculty user: {faculty_email}'))

        # 3. Student Account
        student_email = 'student@proctox.edu'
        student_pass = 'StudentPass123!'
        student_user = User.objects.filter(email__iexact=student_email).first()
        if not student_user:
            student_user = User.objects.create_user(
                username='student',
                email=student_email,
                password=student_pass,
                role=User.Role.STUDENT,
                first_name='Alex',
                last_name='Taylor',
            )
            self.stdout.write(self.style.SUCCESS(f'Created Student user: {student_email}'))
        else:
            student_user.role = User.Role.STUDENT
            student_user.set_password(student_pass)
            student_user.save()
            self.stdout.write(self.style.SUCCESS(f'Updated Student user: {student_email}'))

        # 4. Seed sample courses
        course1, created = Course.objects.get_or_create(
            code='CS101',
            defaults={
                'name': 'Data Structures & Algorithms',
                'description': 'Foundational computer science topics: arrays, trees, graphs, sorting, and complexity.',
                'faculty': faculty_user,
                'faculty_name': 'Dr. Alan Turing',
                'is_active': True,
            }
        )
        if not created and not course1.faculty:
            course1.faculty = faculty_user
            course1.faculty_name = 'Dr. Alan Turing'
            course1.save()

        course2, _ = Course.objects.get_or_create(
            code='CS202',
            defaults={
                'name': 'Cloud & Distributed Systems',
                'description': 'Microservices, RESTful design, horizontal scaling, and web security.',
                'faculty': faculty_user,
                'faculty_name': 'Dr. Alan Turing',
                'is_active': True,
            }
        )

        # 5. Seed sample questions
        q1, created_q1 = Question.objects.get_or_create(
            course=course1,
            text='What is the worst-case time complexity of quicksort with standard partitioning?',
            defaults={
                'type': Question.QuestionType.MCQ_SINGLE,
                'difficulty': Question.Difficulty.MEDIUM,
                'topic': 'Sorting & Algorithms',
                'marks': 2.0,
                'created_by': faculty_user,
            }
        )
        if created_q1:
            QuestionOption.objects.create(question=q1, text='O(n log n)', is_correct=False, order=1)
            QuestionOption.objects.create(question=q1, text='O(n^2)', is_correct=True, order=2)
            QuestionOption.objects.create(question=q1, text='O(n)', is_correct=False, order=3)
            QuestionOption.objects.create(question=q1, text='O(log n)', is_correct=False, order=4)

        q2, created_q2 = Question.objects.get_or_create(
            course=course1,
            text='Which of the following data structures maintain elements in sorted order?',
            defaults={
                'type': Question.QuestionType.MCQ_MULTI,
                'difficulty': Question.Difficulty.HARD,
                'topic': 'Trees & Heaps',
                'marks': 3.0,
                'created_by': faculty_user,
            }
        )
        if created_q2:
            QuestionOption.objects.create(question=q2, text='Red-Black Tree', is_correct=True, order=1)
            QuestionOption.objects.create(question=q2, text='AVL Tree', is_correct=True, order=2)
            QuestionOption.objects.create(question=q2, text='Unsorted Array', is_correct=False, order=3)
            QuestionOption.objects.create(question=q2, text='Hash Table', is_correct=False, order=4)

        q3, _ = Question.objects.get_or_create(
            course=course1,
            text='Explain the primary difference between a process and a thread in modern operating systems.',
            defaults={
                'type': Question.QuestionType.SHORT_ANSWER,
                'difficulty': Question.Difficulty.EASY,
                'topic': 'Operating Systems',
                'marks': 5.0,
                'model_answer': 'Processes have separate virtual memory address spaces and isolated resources, whereas threads share the same address space and open file descriptors of their parent process.',
                'created_by': faculty_user,
            }
        )

        # 6. Seed sample exam
        now = timezone.now()
        exam, created_exam = Exam.objects.get_or_create(
            course=course1,
            title='CS101 Midterm Examination',
            defaults={
                'start_time': now - timedelta(hours=1),
                'end_time': now + timedelta(days=7),
                'duration_minutes': 60,
                'question_count': 3,
                'marks_per_question': 3.33,
                'is_published': True,
                'results_published': False,
                'proctoring_mode': Exam.ProctoringMode.BASIC,
                'created_by': faculty_user,
            }
        )
        if created_exam or not exam.exam_questions.exists():
            for idx, q in enumerate([q1, q2, q3], start=1):
                ExamQuestion.objects.get_or_create(exam=exam, question=q, defaults={'order': idx})

        self.stdout.write(self.style.SUCCESS('\n==========================================='))
        self.stdout.write(self.style.SUCCESS('ProctoX Demo Accounts Successfully Seeded!'))
        self.stdout.write(self.style.SUCCESS('==========================================='))
        self.stdout.write(f'Admin:   {admin_email}   | {admin_pass}  (Role: admin)')
        self.stdout.write(f'Faculty: {faculty_email} | {faculty_pass} (Role: faculty)')
        self.stdout.write(f'Student: {student_email} | {student_pass} (Role: student)')
        self.stdout.write(self.style.SUCCESS('===========================================\n'))

