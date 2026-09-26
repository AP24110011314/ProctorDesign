from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .attempt_views import AttemptViewSet

router = DefaultRouter()
router.register(r'courses', views.CourseViewSet)
router.register(r'questions', views.QuestionViewSet)
router.register(r'exams', views.ExamViewSet, basename='exam')
router.register(r'attempts', AttemptViewSet, basename='attempt')

urlpatterns = [
    path('', include(router.urls)),
]
