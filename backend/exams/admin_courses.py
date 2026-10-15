from django.db.models import Q
from rest_framework import mixins, serializers, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import User
from authentication.permissions import require_role
from system.models import AuditLog, log_action
from .models import Course


def resolve_faculty_user(name):
    """Link a typed in-charge name to a faculty login account.

    Returns the active faculty user when the name uniquely matches one
    (email first, then username, then full name, all case-insensitive);
    otherwise None — the name is then kept as a plain label.
    """
    text = (name or '').strip()
    if not text:
        return None
    base = User.objects.filter(role=User.Role.FACULTY, is_active=True)
    user = base.filter(email__iexact=text).first()
    if user is not None:
        return user
    user = base.filter(username__iexact=text).first()
    if user is not None:
        return user
    lowered = text.lower()
    matches = [
        u for u in base
        if f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip().lower() == lowered
    ]
    if len(matches) == 1:
        return matches[0]
    return None


class AdminCourseSerializer(serializers.ModelSerializer):
    """Admin manage-courses serializer (create/edit/deactivate, never delete).

    Assigned faculty is free text: any name is accepted and stored in
    ``faculty_name``. When the typed name matches an active faculty login,
    the ``faculty`` link is set automatically so that faculty member gets
    the course in their dropdowns; otherwise the name stays a label.
    """
    faculty = serializers.PrimaryKeyRelatedField(read_only=True)
    linked_faculty = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            'id', 'code', 'name', 'description', 'faculty_name', 'faculty',
            'linked_faculty', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'faculty', 'created_at', 'updated_at']

    def get_linked_faculty(self, obj):
        if obj.faculty_id is None:
            return None
        user = obj.faculty
        return {
            'id': user.id,
            'display_name': user.get_full_name() or user.username,
            'email': user.email,
        }

    def validate_code(self, value):
        code = (value or '').strip()
        if not code:
            raise serializers.ValidationError('Course code is required.')
        qs = Course.objects.filter(code__iexact=code)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('A course with this code already exists.')
        return code

    def validate_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('Course name is required.')
        return name

    def validate_faculty_name(self, value):
        name = (value or '').strip()
        if not name:
            raise serializers.ValidationError('Faculty in-charge name is required.')
        return name

    def create(self, validated_data):
        course = Course(**validated_data)
        course.faculty = resolve_faculty_user(course.faculty_name)
        course.save()
        return course

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        instance.faculty = resolve_faculty_user(instance.faculty_name)
        instance.save(update_fields=['faculty', 'updated_at'])
        return instance


class AdminCourseViewSet(
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """
    Admin-only course management (no destroy: courses stay referenced by
    exams, questions, and attempts; use is_active instead).

    GET    /api/admin/courses/       list (?q=, ?is_active=, paginated)
    POST   /api/admin/courses/       create
    GET    /api/admin/courses/{id}/  detail
    PATCH  /api/admin/courses/{id}/  edit (PUT also accepted)
    """
    queryset = Course.objects.select_related('faculty').all()
    serializer_class = AdminCourseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset().order_by('code')
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            v = is_active.strip().lower()
            if v in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif v in ('false', '0'):
                qs = qs.filter(is_active=False)
        return qs

    @require_role(User.Role.ADMIN)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @require_role(User.Role.ADMIN)
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)

    def perform_create(self, serializer):
        course = serializer.save()
        log_action(
            self.request.user, AuditLog.Action.COURSE_CREATE, course,
            {'code': course.code, 'name': course.name},
        )

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        course = serializer.save()
        if was_active and not course.is_active:
            action, details = AuditLog.Action.COURSE_DEACTIVATE, {'code': course.code}
        elif not was_active and course.is_active:
            action, details = AuditLog.Action.COURSE_REACTIVATE, {'code': course.code}
        else:
            action, details = AuditLog.Action.COURSE_UPDATE, {'code': course.code}
        log_action(self.request.user, action, course, details)


class AdminFacultyOptionsView(APIView):
    """
    Admin-only dropdown source: active faculty users.
    GET /api/admin/faculty/
    """
    permission_classes = [IsAuthenticated]

    @require_role(User.Role.ADMIN)
    def get(self, request):
        faculty = User.objects.filter(
            role=User.Role.FACULTY, is_active=True
        ).order_by('first_name', 'last_name', 'username')
        return Response([
            {
                'id': u.id,
                'username': u.username,
                'email': u.email,
                'display_name': u.get_full_name() or u.username,
            }
            for u in faculty
        ])
