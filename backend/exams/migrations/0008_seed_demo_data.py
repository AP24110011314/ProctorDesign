"""
Data migration to automatically seed demo accounts and initial course data.
Ensures that any environment running migrations (including production/hosted backends)
has the three documented demo accounts ready:
- admin / admin@proctox.edu / AdminPass123!
- faculty / faculty@proctox.edu / FacultyPass123!
- student / student@proctox.edu / StudentPass123!
"""

from django.db import migrations
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from datetime import timedelta
import sys


def seed_demo_data(apps, schema_editor):
    # During test execution, tests manage their own fixture data (e.g. creating CS101)
    if 'test' in sys.argv or any('test' in arg for arg in sys.argv):
        return

    User = apps.get_model('authentication', 'User')
    Course = apps.get_model('exams', 'Course')
    Question = apps.get_model('exams', 'Question')
    QuestionOption = apps.get_model('exams', 'QuestionOption')
    Exam = apps.get_model('exams', 'Exam')
    ExamQuestion = apps.get_model('exams', 'ExamQuestion')

    # 1. Admin Account
    admin_email = 'admin@proctox.edu'
    admin_user = User.objects.filter(email__iexact=admin_email).first() or User.objects.filter(username__iexact='admin').first()
    if not admin_user:
        admin_user = User.objects.create(
            username='admin',
            email=admin_email,
            password=make_password('AdminPass123!'),
            role='admin',
            is_superuser=True,
            is_staff=True,
            first_name='System',
            last_name='Administrator',
            phone='+1-555-0100',
        )
    else:
        admin_user.username = 'admin'
        admin_user.email = admin_email
        admin_user.role = 'admin'
        admin_user.is_superuser = True
        admin_user.is_staff = True
        admin_user.password = make_password('AdminPass123!')
        admin_user.save()

    # 2. Faculty Account
    faculty_email = 'faculty@proctox.edu'
    faculty_user = User.objects.filter(email__iexact=faculty_email).first() or User.objects.filter(username__iexact='faculty').first()
    if not faculty_user:
        faculty_user = User.objects.create(
            username='faculty',
            email=faculty_email,
            password=make_password('FacultyPass123!'),
            role='faculty',
            is_superuser=False,
            is_staff=False,
            first_name='Dr. Alan',
            last_name='Turing',
            phone='+1-555-0101',
        )
    else:
        faculty_user.username = 'faculty'
        faculty_user.email = faculty_email
        faculty_user.role = 'faculty'
        faculty_user.password = make_password('FacultyPass123!')
        faculty_user.save()

    # 3. Student Account
    student_email = 'student@proctox.edu'
    student_user = User.objects.filter(email__iexact=student_email).first() or User.objects.filter(username__iexact='student').first()
    if not student_user:
        student_user = User.objects.create(
            username='student',
            email=student_email,
            password=make_password('StudentPass123!'),
            role='student',
            is_superuser=False,
            is_staff=False,
            first_name='Alex',
            last_name='Taylor',
            phone='+1-555-0102',
        )
    else:
        student_user.username = 'student'
        student_user.email = student_email
        student_user.role = 'student'
        student_user.password = make_password('StudentPass123!')
        student_user.save()

    # 4. Courses assigned to faculty
    course_data = [
        ('CS101', 'Data Structures & Algorithms', 'Foundational computer science topics: arrays, trees, graphs, sorting, and complexity.'),
        ('CS202', 'Cloud & Distributed Systems', 'Microservices, RESTful design, horizontal scaling, and web security.'),
        ('CS303', 'Computer Networks & Security', 'TCP/IP protocol stack, network encryption, firewalls, and proctoring telemetry.'),
    ]

    created_courses = []
    for code, name, desc in course_data:
        course, created = Course.objects.get_or_create(
            code=code,
            defaults={
                'name': name,
                'description': desc,
                'faculty': faculty_user,
                'faculty_name': 'Dr. Alan Turing',
                'is_active': True,
            }
        )
        if not created:
            course.faculty = faculty_user
            course.faculty_name = 'Dr. Alan Turing'
            course.is_active = True
            course.save()
        created_courses.append(course)

    # 5. Seed sample question and exam
    if created_courses:
        cs101 = created_courses[0]
        q, _ = Question.objects.get_or_create(
            course=cs101,
            text='What is the worst-case time complexity of quicksort with standard partitioning?',
            defaults={
                'type': 'mcq_single',
                'difficulty': 'medium',
                'topic': 'Algorithms',
                'marks': 2.0,
                'created_by': faculty_user,
            }
        )
        if not QuestionOption.objects.filter(question=q).exists():
            QuestionOption.objects.create(question=q, text='O(n log n)', is_correct=False, order=1)
            QuestionOption.objects.create(question=q, text='O(n^2)', is_correct=True, order=2)
            QuestionOption.objects.create(question=q, text='O(log n)', is_correct=False, order=3)
            QuestionOption.objects.create(question=q, text='O(n)', is_correct=False, order=4)

        now = timezone.now()
        exam, _ = Exam.objects.get_or_create(
            course=cs101,
            title='CS101 Midterm Examination',
            defaults={
                'start_time': now - timedelta(hours=1),
                'end_time': now + timedelta(days=7),
                'duration_minutes': 60,
                'question_count': 1,
                'marks_per_question': 2.0,
                'proctoring_mode': 'strict',
                'is_published': True,
                'created_by': faculty_user,
            }
        )
        ExamQuestion.objects.get_or_create(exam=exam, question=q, defaults={'order': 1})


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0007_course_faculty_name'),
        ('authentication', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_demo_data, noop),
    ]

