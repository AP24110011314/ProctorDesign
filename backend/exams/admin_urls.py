from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_courses import AdminCourseViewSet, AdminFacultyOptionsView

router = DefaultRouter()
router.register(r'courses', AdminCourseViewSet, basename='admin-course')

urlpatterns = [
    path('', include(router.urls)),
    path('faculty/', AdminFacultyOptionsView.as_view(), name='admin-faculty-options'),
]
