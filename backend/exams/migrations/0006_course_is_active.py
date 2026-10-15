from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('exams', '0005_attempt_void_reason_attempt_voided_at_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='course',
            name='is_active',
            field=models.BooleanField(
                default=True,
                help_text='Deactivated courses stay referenced by old exams/attempts/results but cannot be selected for new exams or questions',
            ),
        ),
    ]
