"""
Celery configuration
"""
import os
from celery import Celery
from celery.schedules import crontab

# Set default Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('config')

# Load config from Django settings
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps
app.autodiscover_tasks()

# Celery Beat schedule for periodic tasks
app.conf.beat_schedule = {
    'auto-submit-expired-attempts': {
        'task': 'exams.tasks.auto_submit_expired_attempts',
        'schedule': 60.0,  # Run every 60 seconds (per ARCHITECTURE.md §3.5)
    },
}

@app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
