from django.db import migrations, models


def copy_faculty_names(apps, schema_editor):
    Course = apps.get_model('exams', 'Course')
    touched = []
    for course in Course.objects.select_related('faculty').all():
        user = course.faculty
        if user is None:
            continue
        full = f"{(user.first_name or '').strip()} {(user.last_name or '').strip()}".strip()
        course.faculty_name = full or user.username
        touched.append(course)
    if touched:
        Course.objects.bulk_update(touched, ['faculty_name'])


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0006_course_is_active'),
    ]

    operations = [
        migrations.AddField(
            model_name='course',
            name='faculty_name',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Faculty in-charge name as typed by the admin; may be any name, not necessarily a registered account',
                max_length=200,
            ),
        ),
        migrations.AlterField(
            model_name='course',
            name='faculty',
            field=models.ForeignKey(
                blank=True,
                help_text='Linked faculty login (set automatically when the typed in-charge name matches an active faculty account)',
                limit_choices_to={'role': 'faculty'},
                null=True,
                on_delete=models.SET_NULL,
                related_name='courses',
                to='authentication.user',
            ),
        ),
        migrations.RunPython(copy_faculty_names, migrations.RunPython.noop),
    ]
