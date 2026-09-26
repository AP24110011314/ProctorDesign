from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from . import views

urlpatterns = [
    # Authentication endpoints (SRS.md FR-1, FR-3)
    path('register/', views.register_view, name='register'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),

    # JWT token refresh (SRS.md FR-3)
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # User profile
    path('profile/', views.profile_view, name='profile'),
    path('profile/update/', views.update_profile_view, name='update_profile'),
]
