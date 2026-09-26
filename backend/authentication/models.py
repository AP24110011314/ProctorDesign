from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Custom User model extending Django's AbstractUser
    Implements SRS.md FR-1: Support for Student, Faculty, Admin roles
    """

    class Role(models.TextChoices):
        STUDENT = 'student', 'Student'
        FACULTY = 'faculty', 'Faculty'
        ADMIN = 'admin', 'Admin'

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.STUDENT,
        help_text="User role for RBAC (SRS.md FR-4)"
    )

    reference_photo_url = models.URLField(
        max_length=500,
        blank=True,
        null=True,
        help_text="Reference photo for proctoring face match (SRS.md FR-14)"
    )

    # Additional fields beyond AbstractUser defaults
    phone = models.CharField(max_length=15, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        indexes = [
            models.Index(fields=['role']),
            models.Index(fields=['email']),
        ]

    def __str__(self):
        return f"{self.get_full_name()} ({self.role})"

    def is_student(self):
        return self.role == self.Role.STUDENT

    def is_faculty(self):
        return self.role == self.Role.FACULTY

    def is_admin(self):
        return self.role == self.Role.ADMIN or self.is_superuser
