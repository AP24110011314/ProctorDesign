from django.urls import include, path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'answers', views.ManualGradingViewSet, basename='grading-answer')
router.register(r'exams', views.ResultsViewSet, basename='grading-exam')

urlpatterns = [
    path('', include(router.urls)),
]
