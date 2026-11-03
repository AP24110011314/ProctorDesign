"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse

def health_check(request):
    """Health check endpoint to verify backend is running (Phase 0)"""
    return JsonResponse({
        'status': 'healthy',
        'service': 'ProctoX - Backend',
        'version': '1.0.0'
    })

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health_check, name='health_check'),
    # App URLs
    path('api/auth/', include('authentication.urls')),
    path('api/admin/', include('exams.admin_urls')),
    path('api/', include('exams.urls')),
    path('api/grading/', include('grading.urls')),
    path('api/proctoring/', include('proctoring.urls')),
    path('api/system/', include('system.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Custom JSON error handlers for API routes (per external pinger & API reliability)
handler400 = 'system.views.api_bad_request_handler'
handler403 = 'system.views.api_permission_denied_handler'
handler404 = 'system.views.api_not_found_handler'
handler500 = 'system.views.api_server_error_handler'
