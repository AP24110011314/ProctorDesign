from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet, AutoSubmitSweepView, OverviewView

router = DefaultRouter()
router.register(r'audit-log', AuditLogViewSet, basename='audit-log')

urlpatterns = [
    path('', include(router.urls)),
    path('overview/', OverviewView.as_view(), name='system-overview'),
    path('sweep/auto-submit/', AutoSubmitSweepView.as_view(), name='sweep-auto-submit'),
]
